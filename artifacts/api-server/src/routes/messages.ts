import { Router, type IRouter } from "express";
import { Server as SocketIOServer } from "socket.io";
import { db, usersTable, userStatusTable, messagesTable, messageSeenTable, messageDeliveredTable, messageReactionsTable, conversationParticipantsTable, pushSubscriptionsTable, expoPushTokensTable } from "@workspace/db";
import { eq, and, inArray, desc, lt, ilike } from "drizzle-orm";
import { sendPushNotification } from "../lib/push";
import { sendExpoPushNotifications } from "./expo-push";
import { sendFcmNotifications, filterFcmTokens } from "../lib/fcm";

const router: IRouter = Router();

let ioInstance: SocketIOServer | null = null;

export function setIO(io: SocketIOServer) {
  ioInstance = io;
}

function formatUser(user: any, status: any) {
  return {
    id: user.id,
    username: user.email,
    displayName: status?.displayName || (user.firstName ? `${user.firstName} ${user.lastName || ""}`.trim() : null),
    avatarUrl: status?.avatarUrl || user.profileImageUrl,
    isOnline: status?.isOnline ?? false,
    lastSeen: status?.lastSeen?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

router.get("/conversations/:conversationId/messages", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const rawId = Array.isArray(req.params.conversationId) ? req.params.conversationId[0] : req.params.conversationId;
  const conversationId = parseInt(rawId, 10);
  const limit = parseInt(String(req.query.limit || "50"), 10);
  const before = req.query.before ? parseInt(String(req.query.before), 10) : undefined;

  let query = db
    .select()
    .from(messagesTable)
    .where(
      before
        ? and(eq(messagesTable.conversationId, conversationId), lt(messagesTable.id, before))
        : eq(messagesTable.conversationId, conversationId)
    )
    .orderBy(desc(messagesTable.createdAt))
    .limit(limit);

  const msgs = await query;

  const senderIds = [...new Set(msgs.map((m) => m.senderId))];
  const senders = senderIds.length
    ? await db.select().from(usersTable).where(inArray(usersTable.id, senderIds))
    : [];
  const statuses = senderIds.length
    ? await db.select().from(userStatusTable).where(inArray(userStatusTable.userId, senderIds))
    : [];
  const senderMap = new Map(senders.map((s) => [s.id, s]));
  const statusMap = new Map(statuses.map((s) => [s.userId, s]));

  const msgIds = msgs.map((m) => m.id);
  const seenRecords = msgIds.length
    ? await db.select().from(messageSeenTable).where(inArray(messageSeenTable.messageId, msgIds))
    : [];

  const seenMap = new Map<number, string[]>();
  for (const r of seenRecords) {
    if (!seenMap.has(r.messageId)) seenMap.set(r.messageId, []);
    seenMap.get(r.messageId)!.push(r.userId);
  }

  const deliveredRecords = msgIds.length
    ? await db.select().from(messageDeliveredTable).where(inArray(messageDeliveredTable.messageId, msgIds))
    : [];
  const deliveredMap = new Map<number, string[]>();
  for (const r of deliveredRecords) {
    if (!deliveredMap.has(r.messageId)) deliveredMap.set(r.messageId, []);
    deliveredMap.get(r.messageId)!.push(r.userId);
  }

  // Fetch reactions for these messages
  const reactionRecords = msgIds.length
    ? await db.select().from(messageReactionsTable).where(inArray(messageReactionsTable.messageId, msgIds))
    : [];

  const reactionsMap = new Map<number, { emoji: string; userId: string }[]>();
  for (const r of reactionRecords) {
    if (!reactionsMap.has(r.messageId)) reactionsMap.set(r.messageId, []);
    reactionsMap.get(r.messageId)!.push({ emoji: r.emoji, userId: r.userId });
  }

  // Fetch quoted messages for replies
  const replyToIds = msgs.map(m => m.replyToId).filter((id): id is number => id != null);
  const quotedMsgs = replyToIds.length
    ? await db.select().from(messagesTable).where(inArray(messagesTable.id, replyToIds))
    : [];
  const quotedMap = new Map(quotedMsgs.map(m => [m.id, m]));

  const result = msgs.reverse().map((msg) => {
    const sender = senderMap.get(msg.senderId);
    const quoted = msg.replyToId ? quotedMap.get(msg.replyToId) : null;
    const quotedSender = quoted ? senderMap.get(quoted.senderId) : null;
    return {
      id: msg.id,
      conversationId: msg.conversationId,
      senderId: msg.senderId,
      content: msg.content,
      messageType: msg.messageType,
      fileUrl: msg.fileUrl,
      fileName: msg.fileName,
      fileSize: msg.fileSize,
      duration: msg.duration,
      replyToId: msg.replyToId,
      replyTo: quoted ? {
        id: quoted.id,
        content: quoted.content,
        messageType: quoted.messageType,
        senderId: quoted.senderId,
        senderName: quotedSender
          ? formatUser(quotedSender, statusMap.get(quotedSender.id))?.displayName || quotedSender.email
          : "Unknown",
      } : null,
      seenBy: seenMap.get(msg.id) || [],
      deliveredTo: deliveredMap.get(msg.id) || [],
      reactions: reactionsMap.get(msg.id) || [],
      createdAt: msg.createdAt.toISOString(),
      sender: sender ? formatUser(sender, statusMap.get(sender.id)) : null,
    };
  });

  res.json(result);
});

router.post("/conversations/:conversationId/messages", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const rawId = Array.isArray(req.params.conversationId) ? req.params.conversationId[0] : req.params.conversationId;
  const conversationId = parseInt(rawId, 10);
  const userId = req.user.id;
  const { content, messageType = "text", fileUrl, fileName, fileSize, duration, replyToId } = req.body;

  // Insert message + fetch sender in parallel
  const [[msg], [sender], [status]] = await Promise.all([
    db.insert(messagesTable).values({
      conversationId,
      senderId: userId,
      content: content ?? null,
      messageType,
      fileUrl: fileUrl ?? null,
      fileName: fileName ?? null,
      fileSize: fileSize ?? null,
      duration: duration ?? null,
      replyToId: replyToId ?? null,
    }).returning(),
    db.select().from(usersTable).where(eq(usersTable.id, userId)),
    db.select().from(userStatusTable).where(eq(userStatusTable.userId, userId)),
  ]);

  // Fetch quoted message if this is a reply (parallel with nothing, but isolated)
  let replyTo = null;
  if (replyToId) {
    const [quotedMsg] = await db.select().from(messagesTable).where(eq(messagesTable.id, replyToId));
    if (quotedMsg) {
      const [[quotedSenderUser], [quotedSenderStatus]] = await Promise.all([
        db.select().from(usersTable).where(eq(usersTable.id, quotedMsg.senderId)),
        db.select().from(userStatusTable).where(eq(userStatusTable.userId, quotedMsg.senderId)),
      ]);
      replyTo = {
        id: quotedMsg.id,
        content: quotedMsg.content,
        messageType: quotedMsg.messageType,
        senderId: quotedMsg.senderId,
        senderName: quotedSenderUser
          ? formatUser(quotedSenderUser, quotedSenderStatus)?.displayName || quotedSenderUser.email
          : "Unknown",
      };
    }
  }

  const formattedMsg = {
    id: msg.id,
    conversationId: msg.conversationId,
    senderId: msg.senderId,
    content: msg.content,
    messageType: msg.messageType,
    fileUrl: msg.fileUrl,
    fileName: msg.fileName,
    fileSize: msg.fileSize,
    duration: msg.duration,
    replyToId: msg.replyToId,
    replyTo,
    seenBy: [],
    deliveredTo: [],
    reactions: [],
    createdAt: msg.createdAt.toISOString(),
    sender: sender ? formatUser(sender, status) : null,
  };

  // Emit socket immediately
  if (ioInstance) {
    ioInstance.to(`conversation:${conversationId}`).emit("new-message", formattedMsg);
  }

  // ✅ Respond immediately — don't wait for push notifications
  res.status(201).json(formattedMsg);

  // Fire-and-forget push notifications in background
  (async () => {
    try {
      const participants = await db
        .select()
        .from(conversationParticipantsTable)
        .where(eq(conversationParticipantsTable.conversationId, conversationId));

      const otherParticipantIds = participants.map(p => p.userId).filter(id => id !== userId);
      if (!otherParticipantIds.length) return;

      const statuses = await db
        .select()
        .from(userStatusTable)
        .where(inArray(userStatusTable.userId, otherParticipantIds));

      const onlineIds = new Set(statuses.filter(s => s.isOnline).map(s => s.userId));
      const targetIds = otherParticipantIds.filter(id => !onlineIds.has(id));
      if (!targetIds.length) return;

      const subscriptions = await db
        .select()
        .from(pushSubscriptionsTable)
        .where(inArray(pushSubscriptionsTable.userId, targetIds));

      if (!subscriptions.length) return;

      const senderName = formattedMsg.sender?.displayName || formattedMsg.sender?.username || "Someone";
      let body = "";
      if (formattedMsg.messageType === "text" && formattedMsg.content) {
        body = formattedMsg.content.length > 80 ? formattedMsg.content.substring(0, 80) + "…" : formattedMsg.content;
      } else if (formattedMsg.messageType === "image") { body = "📷 Sent a photo"; }
      else if (formattedMsg.messageType === "video") { body = "🎥 Sent a video"; }
      else if (formattedMsg.messageType === "voice") { body = "🎤 Sent a voice message"; }
      else { body = "New message"; }

      await Promise.allSettled(
        subscriptions.map(sub =>
          sendPushNotification(
            { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
            { title: `Private — ${senderName}`, body, icon: formattedMsg.sender?.avatarUrl || "/icon.webp", tag: `msg-${conversationId}`, url: "/" }
          )
        )
      );

      // Expo push notifications for React Native / Expo users
      await sendExpoPushNotifications(targetIds, {
        title: `Private — ${senderName}`,
        body,
        data: { conversationId, messageId: formattedMsg.id },
      });

      // FCM push notifications for native Android users
      const fcmRows = await db
        .select()
        .from(expoPushTokensTable)
        .where(inArray(expoPushTokensTable.userId, targetIds));
      const fcmTokens = filterFcmTokens(fcmRows);
      if (fcmTokens.length > 0) {
        await sendFcmNotifications(fcmTokens, {
          title: `Private — ${senderName}`,
          body,
          data: {
            type: "message",
            conversationId: String(conversationId),
            messageId: String(formattedMsg.id),
          },
        });
      }
    } catch (pushErr) {
      console.error("Push notification error:", pushErr);
    }
  })();
});

router.post("/conversations/:conversationId/messages/:messageId/seen", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const rawConvoId = Array.isArray(req.params.conversationId) ? req.params.conversationId[0] : req.params.conversationId;
  const rawMsgId = Array.isArray(req.params.messageId) ? req.params.messageId[0] : req.params.messageId;
  const conversationId = parseInt(rawConvoId, 10);
  const messageId = parseInt(rawMsgId, 10);
  const userId = req.user.id;

  const existing = await db
    .select()
    .from(messageSeenTable)
    .where(and(eq(messageSeenTable.messageId, messageId), eq(messageSeenTable.userId, userId)));

  if (existing.length === 0) {
    await db.insert(messageSeenTable).values({ messageId, userId });
  }

  const seenRecords = await db
    .select()
    .from(messageSeenTable)
    .where(eq(messageSeenTable.messageId, messageId));

  const seenBy = seenRecords.map((r) => r.userId);

  if (ioInstance) {
    ioInstance.to(`conversation:${conversationId}`).emit("message-seen", { messageId, seenBy });
  }

  res.json({ success: true });
});

// DELETE a message (sender only)
router.delete("/conversations/:conversationId/messages/:messageId", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const conversationId = parseInt(Array.isArray(req.params.conversationId) ? req.params.conversationId[0] : req.params.conversationId, 10);
  const messageId = parseInt(Array.isArray(req.params.messageId) ? req.params.messageId[0] : req.params.messageId, 10);
  const userId = req.user.id;

  const [msg] = await db.select().from(messagesTable).where(eq(messagesTable.id, messageId));
  if (!msg) { res.status(404).json({ error: "Not found" }); return; }
  if (msg.senderId !== userId) { res.status(403).json({ error: "Not your message" }); return; }

  // Mark as deleted instead of hard delete — keeps placeholder visible for both users
  await db.update(messagesTable)
    .set({ isDeleted: true, content: null, fileUrl: null, fileName: null })
    .where(eq(messagesTable.id, messageId));

  if (ioInstance) {
    ioInstance.to(`conversation:${conversationId}`).emit("message-deleted", { messageId, conversationId });
  }

  res.json({ success: true });
});

// EDIT a message (sender only, text messages only)
router.patch("/conversations/:conversationId/messages/:messageId", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const conversationId = parseInt(Array.isArray(req.params.conversationId) ? req.params.conversationId[0] : req.params.conversationId, 10);
  const messageId = parseInt(Array.isArray(req.params.messageId) ? req.params.messageId[0] : req.params.messageId, 10);
  const userId = req.user.id;
  const { content } = req.body;

  if (!content?.trim()) { res.status(400).json({ error: "content required" }); return; }

  const [msg] = await db.select().from(messagesTable).where(eq(messagesTable.id, messageId));
  if (!msg) { res.status(404).json({ error: "Not found" }); return; }
  if (msg.senderId !== userId) { res.status(403).json({ error: "Not your message" }); return; }
  if (msg.messageType !== "text") { res.status(400).json({ error: "Only text messages can be edited" }); return; }

  const [updated] = await db
    .update(messagesTable)
    .set({ content: content.trim() })
    .where(eq(messagesTable.id, messageId))
    .returning();

  if (ioInstance) {
    ioInstance.to(`conversation:${conversationId}`).emit("message-edited", { messageId, conversationId, content: updated.content });
  }

  res.json({ success: true, content: updated.content });
});

router.post("/conversations/:conversationId/messages/:messageId/reactions", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const rawConvoId = Array.isArray(req.params.conversationId) ? req.params.conversationId[0] : req.params.conversationId;
  const rawMsgId = Array.isArray(req.params.messageId) ? req.params.messageId[0] : req.params.messageId;
  const conversationId = parseInt(rawConvoId, 10);
  const messageId = parseInt(rawMsgId, 10);
  const userId = req.user.id;
  const { emoji } = req.body;

  if (!emoji) {
    res.status(400).json({ error: "emoji required" });
    return;
  }

  // Check if user already has this exact emoji reaction
  const existing = await db
    .select()
    .from(messageReactionsTable)
    .where(and(
      eq(messageReactionsTable.messageId, messageId),
      eq(messageReactionsTable.userId, userId),
      eq(messageReactionsTable.emoji, emoji)
    ));

  if (existing.length > 0) {
    // Toggle off: remove this reaction
    await db
      .delete(messageReactionsTable)
      .where(and(
        eq(messageReactionsTable.messageId, messageId),
        eq(messageReactionsTable.userId, userId),
        eq(messageReactionsTable.emoji, emoji)
      ));
  } else {
    // Remove any previous reaction from this user on this message, then add new one
    await db
      .delete(messageReactionsTable)
      .where(and(eq(messageReactionsTable.messageId, messageId), eq(messageReactionsTable.userId, userId)));
    await db.insert(messageReactionsTable).values({ messageId, userId, emoji });
  }

  // Fetch updated reactions
  const reactionRecords = await db
    .select()
    .from(messageReactionsTable)
    .where(eq(messageReactionsTable.messageId, messageId));

  const reactions = reactionRecords.map(r => ({ emoji: r.emoji, userId: r.userId }));

  // Emit real-time update
  if (ioInstance) {
    ioInstance.to(`conversation:${conversationId}`).emit("reaction-update", { messageId, reactions });
  }

  res.json({ reactions });
});

// GET /calls — all call messages for the current user across all conversations
router.get("/calls", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const userId = req.user.id;

  const myConvIds = await db
    .select({ conversationId: conversationParticipantsTable.conversationId })
    .from(conversationParticipantsTable)
    .where(eq(conversationParticipantsTable.userId, userId));

  if (!myConvIds.length) {
    res.json([]);
    return;
  }

  const convIds = myConvIds.map(r => r.conversationId);

  // Get call messages
  const rawCalls = await db
    .select({
      id: messagesTable.id,
      conversationId: messagesTable.conversationId,
      senderId: messagesTable.senderId,
      content: messagesTable.content,
      duration: messagesTable.duration,
      createdAt: messagesTable.createdAt,
    })
    .from(messagesTable)
    .where(and(eq(messagesTable.messageType, "call"), inArray(messagesTable.conversationId, convIds)))
    .orderBy(desc(messagesTable.createdAt))
    .limit(100);

  if (!rawCalls.length) {
    res.json([]);
    return;
  }

  // Get all unique user IDs involved in these calls
  const allUserIds = new Set<string>();
  const calleeIdMap = new Map<number, string>(); // callId -> calleeId

  for (const call of rawCalls) {
    allUserIds.add(call.senderId);
    // Parse calleeId from content JSON
    try {
      const parsed = JSON.parse(call.content || "{}");
      if (parsed.calleeId) {
        allUserIds.add(parsed.calleeId);
        calleeIdMap.set(call.id, parsed.calleeId);
      }
    } catch {}
  }

  // Fetch all involved users at once
  const userIds = Array.from(allUserIds);
  const usersData = userIds.length > 0 ? await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      profileImageUrl: usersTable.profileImageUrl,
      displayName: userStatusTable.displayName,
      avatarUrl: userStatusTable.avatarUrl,
      isOnline: userStatusTable.isOnline,
      lastSeen: userStatusTable.lastSeen,
    })
    .from(usersTable)
    .leftJoin(userStatusTable, eq(usersTable.id, userStatusTable.userId))
    .where(inArray(usersTable.id, userIds)) : [];

  const userMap = new Map(usersData.map(u => [u.id, u]));

  function buildUser(uid: string | null) {
    if (!uid) return null;
    const u = userMap.get(uid);
    if (!u) return null;
    return {
      id: uid,
      username: u.email,
      displayName: u.displayName || (u.firstName ? `${u.firstName} ${u.lastName || ""}`.trim() : null) || u.email,
      avatarUrl: u.avatarUrl || u.profileImageUrl,
      isOnline: u.isOnline ?? false,
      lastSeen: u.lastSeen?.toISOString() ?? null,
    };
  }

  const calls = rawCalls.map(call => {
    let callType = "audio";
    let status = "missed";
    let calleeId = calleeIdMap.get(call.id) ?? null;
    try {
      const parsed = JSON.parse(call.content || "{}");
      callType = parsed.callType || "audio";
      status = parsed.status || "missed";
      if (parsed.calleeId) calleeId = parsed.calleeId;
    } catch {}

    const answered = status === "completed";

    return {
      id: call.id,
      conversationId: call.conversationId,
      senderId: call.senderId,
      duration: call.duration,
      createdAt: call.createdAt.toISOString(),
      callerId: call.senderId,
      calleeId,
      callType,
      answeredAt: answered ? call.createdAt.toISOString() : null,
      caller: buildUser(call.senderId),
      callee: buildUser(calleeId),
    };
  });

  res.json(calls);
});

// GET /conversations/:id/messages/search?q= — full-text search in conversation
router.get("/conversations/:conversationId/messages/search", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const conversationId = parseInt(req.params.conversationId, 10);
  const query = (req.query.q as string || "").trim();

  if (!query) { res.json([]); return; }

  const msgs = await db
    .select()
    .from(messagesTable)
    .where(and(
      eq(messagesTable.conversationId, conversationId),
      ilike(messagesTable.content, `%${query}%`)
    ))
    .orderBy(desc(messagesTable.createdAt))
    .limit(50);

  const senderIds = [...new Set(msgs.map(m => m.senderId))];
  const senders = senderIds.length ? await db.select().from(usersTable).where(inArray(usersTable.id, senderIds)) : [];
  const statuses = senderIds.length ? await db.select().from(userStatusTable).where(inArray(userStatusTable.userId, senderIds)) : [];
  const senderMap = new Map(senders.map(s => [s.id, s]));
  const statusMap = new Map(statuses.map(s => [s.userId, s]));

  res.json(msgs.map(m => {
    const user = senderMap.get(m.senderId);
    const status = statusMap.get(m.senderId);
    return {
      id: m.id,
      conversationId: m.conversationId,
      senderId: m.senderId,
      messageType: m.messageType || "text",
      content: m.content,
      mediaUrl: m.fileUrl,
      createdAt: m.createdAt.toISOString(),
      isDeleted: m.isDeleted || false,
      sender: user ? {
        id: user.id,
        displayName: status?.displayName || (user.firstName ? `${user.firstName} ${user.lastName || ""}`.trim() : null) || user.email,
        avatarUrl: status?.avatarUrl || user.profileImageUrl,
      } : null,
      seenBy: [],
      deliveredTo: [],
      reactions: [],
    };
  }));
});

// GET /conversations/:id/media — all image/video messages in a conversation
router.get("/conversations/:conversationId/media", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const conversationId = parseInt(req.params.conversationId, 10);

  const msgs = await db
    .select()
    .from(messagesTable)
    .where(
      and(
        eq(messagesTable.conversationId, conversationId),
        inArray(messagesTable.messageType, ["image", "video"])
      )
    )
    .orderBy(desc(messagesTable.createdAt));

  const result = msgs.map(m => ({
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    messageType: m.messageType,
    mediaUrl: m.fileUrl,
    createdAt: m.createdAt.toISOString(),
    seenBy: [],
    deliveredTo: [],
    reactions: [],
  }));

  res.json(result);
});

export default router;
