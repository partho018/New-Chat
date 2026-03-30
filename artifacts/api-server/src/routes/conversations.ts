import { Router, type IRouter } from "express";
import { db, usersTable, userStatusTable, conversationsTable, conversationParticipantsTable, messagesTable, messageSeenTable } from "@workspace/db";
import { eq, and, inArray, desc, sql } from "drizzle-orm";

const router: IRouter = Router();

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

function formatMessage(msg: any, seenByUserIds: string[], sender?: any, senderStatus?: any) {
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
    isDeleted: msg.isDeleted ?? false,
    edited: msg.edited ?? false,
    replyToId: msg.replyToId ?? null,
    reactions: [],
    seenBy: seenByUserIds,
    createdAt: msg.createdAt instanceof Date ? msg.createdAt.toISOString() : msg.createdAt,
    sender: sender ? formatUser(sender, senderStatus) : null,
  };
}

// Single-conversation detail (used by POST and GET /:id — still N+1 safe for single item)
async function getConversationWithDetails(conversationId: number, currentUserId: string) {
  const [[convo], participants] = await Promise.all([
    db.select().from(conversationsTable).where(eq(conversationsTable.id, conversationId)),
    db.select().from(conversationParticipantsTable).where(eq(conversationParticipantsTable.conversationId, conversationId)),
  ]);
  if (!convo) return null;

  const userIds = participants.map((p) => p.userId);
  const [users, statuses] = await Promise.all([
    userIds.length ? db.select().from(usersTable).where(inArray(usersTable.id, userIds)) : Promise.resolve([]),
    userIds.length ? db.select().from(userStatusTable).where(inArray(userStatusTable.userId, userIds)) : Promise.resolve([]),
  ]);
  const statusMap = new Map(statuses.map((s) => [s.userId, s]));
  const userMap   = new Map(users.map((u) => [u.id, u]));

  // Last message + unread count in parallel
  const [lastMsgRows, unreadRows] = await Promise.all([
    db.select().from(messagesTable)
      .where(eq(messagesTable.conversationId, conversationId))
      .orderBy(desc(messagesTable.createdAt))
      .limit(1),
    db.execute(sql`
      SELECT COUNT(*)::int AS cnt
      FROM ${messagesTable}
      WHERE ${messagesTable.conversationId} = ${conversationId}
        AND ${messagesTable.senderId} != ${currentUserId}
        AND ${messagesTable.id} NOT IN (
          SELECT ${messageSeenTable.messageId}
          FROM ${messageSeenTable}
          WHERE ${messageSeenTable.userId} = ${currentUserId}
        )
    `),
  ]);

  let lastMessage = null;
  if (lastMsgRows.length) {
    const lastMsg = lastMsgRows[0];
    const seenRows = await db.select().from(messageSeenTable).where(eq(messageSeenTable.messageId, lastMsg.id));
    const sender = userMap.get(lastMsg.senderId);
    lastMessage = formatMessage(lastMsg, seenRows.map((s) => s.userId), sender, statusMap.get(lastMsg.senderId));
  }

  const unreadCount = (unreadRows.rows[0] as any)?.cnt ?? 0;

  return {
    id: convo.id,
    isGroup: convo.isGroup,
    name: convo.name,
    createdAt: convo.createdAt.toISOString(),
    participants: users.map((u) => formatUser(u, statusMap.get(u.id))),
    lastMessage,
    unreadCount,
  };
}

// ✅ OPTIMIZED: GET /conversations — batch all DB work, no N+1
router.get("/conversations", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const userId = req.user.id;

  // Step 1: Get all conversations for this user
  const participations = await db
    .select()
    .from(conversationParticipantsTable)
    .where(eq(conversationParticipantsTable.userId, userId));

  if (!participations.length) { res.json([]); return; }

  const convIds = participations.map((p) => p.conversationId);

  // Step 2: Batch fetch everything in parallel — only 5 queries total regardless of conversation count
  const [conversations, allParticipants, lastMsgRows, seenByMe, unreadRows] = await Promise.all([
    // All conversation records
    db.select().from(conversationsTable).where(inArray(conversationsTable.id, convIds)),

    // All participants across all conversations
    db.select().from(conversationParticipantsTable).where(inArray(conversationParticipantsTable.conversationId, convIds)),

    // Last message per conversation using SQL window function
    db.execute(sql`
      SELECT DISTINCT ON (${messagesTable.conversationId})
        ${messagesTable.id},
        ${messagesTable.conversationId},
        ${messagesTable.senderId},
        ${messagesTable.content},
        ${messagesTable.messageType},
        ${messagesTable.fileUrl},
        ${messagesTable.fileName},
        ${messagesTable.fileSize},
        ${messagesTable.duration},
        ${messagesTable.isDeleted},
        ${messagesTable.createdAt}
      FROM ${messagesTable}
      WHERE ${messagesTable.conversationId} = ANY(${sql`ARRAY[${sql.join(convIds.map(id => sql`${id}`), sql`, `)}]::int[]`})
      ORDER BY ${messagesTable.conversationId}, ${messagesTable.createdAt} DESC
    `),

    // Seen records for current user (for unread count)
    db.select({ messageId: messageSeenTable.messageId })
      .from(messageSeenTable)
      .where(eq(messageSeenTable.userId, userId)),

    // Unread count per conversation using SQL
    db.execute(sql`
      SELECT
        m.conversation_id,
        COUNT(*)::int AS cnt
      FROM messages m
      WHERE m.conversation_id = ANY(${sql`ARRAY[${sql.join(convIds.map(id => sql`${id}`), sql`, `)}]::int[]`})
        AND m.sender_id != ${userId}
        AND m.id NOT IN (
          SELECT message_id FROM message_seen WHERE user_id = ${userId}
        )
      GROUP BY m.conversation_id
    `),
  ]);

  // Step 3: Batch fetch all users + statuses (one query each)
  const allUserIds = [...new Set(allParticipants.map((p) => p.userId))];
  const [allUsers, allStatuses] = await Promise.all([
    allUserIds.length ? db.select().from(usersTable).where(inArray(usersTable.id, allUserIds)) : Promise.resolve([]),
    allUserIds.length ? db.select().from(userStatusTable).where(inArray(userStatusTable.userId, allUserIds)) : Promise.resolve([]),
  ]);

  // Step 4: Build maps for O(1) lookups
  const convoMap     = new Map(conversations.map((c) => [c.id, c]));
  const userMap      = new Map(allUsers.map((u) => [u.id, u]));
  const statusMap    = new Map(allStatuses.map((s) => [s.userId, s]));
  const seenMsgIds   = new Set(seenByMe.map((s) => s.messageId));
  const unreadMap    = new Map((unreadRows.rows as any[]).map((r) => [r.conversation_id, r.cnt]));

  // Participants grouped by conversation
  const participantsByConvo = new Map<number, string[]>();
  for (const p of allParticipants) {
    if (!participantsByConvo.has(p.conversationId)) participantsByConvo.set(p.conversationId, []);
    participantsByConvo.get(p.conversationId)!.push(p.userId);
  }

  // Last messages by conversation (with seen status)
  const lastMsgMap = new Map<number, any>();
  for (const row of lastMsgRows.rows as any[]) {
    lastMsgMap.set(row.conversation_id, row);
  }

  // Fetch seen records for last messages
  const lastMsgIds = [...lastMsgMap.values()].map((m) => m.id).filter(Boolean);
  const lastMsgSeenRecords = lastMsgIds.length
    ? await db.select().from(messageSeenTable).where(inArray(messageSeenTable.messageId, lastMsgIds))
    : [];
  const lastMsgSeenMap = new Map<number, string[]>();
  for (const r of lastMsgSeenRecords) {
    if (!lastMsgSeenMap.has(r.messageId)) lastMsgSeenMap.set(r.messageId, []);
    lastMsgSeenMap.get(r.messageId)!.push(r.userId);
  }

  // Step 5: Assemble result
  const result = convIds.map((cid) => {
    const convo = convoMap.get(cid);
    if (!convo) return null;

    const pIds = participantsByConvo.get(cid) || [];
    const pUsers = pIds.map((uid) => {
      const u = userMap.get(uid);
      return u ? formatUser(u, statusMap.get(uid)) : null;
    }).filter(Boolean);

    const lastMsgRow = lastMsgMap.get(cid);
    let lastMessage = null;
    if (lastMsgRow) {
      const sender = userMap.get(lastMsgRow.sender_id);
      const seenBy = lastMsgSeenMap.get(lastMsgRow.id) || [];
      lastMessage = {
        id: lastMsgRow.id,
        conversationId: lastMsgRow.conversation_id,
        senderId: lastMsgRow.sender_id,
        content: lastMsgRow.content,
        messageType: lastMsgRow.message_type,
        fileUrl: lastMsgRow.file_url,
        fileName: lastMsgRow.file_name,
        fileSize: lastMsgRow.file_size,
        duration: lastMsgRow.duration,
        isDeleted: lastMsgRow.is_deleted ?? false,
        edited: lastMsgRow.edited ?? false,
        replyToId: lastMsgRow.reply_to_id ?? null,
        reactions: [],
        seenBy,
        createdAt: lastMsgRow.created_at instanceof Date ? lastMsgRow.created_at.toISOString() : lastMsgRow.created_at,
        sender: sender ? formatUser(sender, statusMap.get(lastMsgRow.sender_id)) : null,
      };
    }

    return {
      id: convo.id,
      isGroup: convo.isGroup,
      name: convo.name,
      createdAt: convo.createdAt.toISOString(),
      participants: pUsers,
      lastMessage,
      unreadCount: unreadMap.get(cid) ?? 0,
    };
  }).filter(Boolean);

  // Sort by last message time, newest first
  result.sort((a: any, b: any) => {
    const ta = a.lastMessage?.createdAt ?? a.createdAt;
    const tb = b.lastMessage?.createdAt ?? b.createdAt;
    return tb > ta ? 1 : -1;
  });

  res.json(result);
});

router.post("/conversations", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const userId = req.user.id;
  const { participantIds, isGroup = false, name } = req.body;

  if (!participantIds || !Array.isArray(participantIds)) {
    res.status(400).json({ error: "participantIds is required" });
    return;
  }

  const allParticipants = [...new Set([userId, ...participantIds])];

  // For 1:1, check if conversation already exists
  if (!isGroup && allParticipants.length === 2) {
    const existingParticipations = await db
      .select()
      .from(conversationParticipantsTable)
      .where(eq(conversationParticipantsTable.userId, userId));

    for (const p of existingParticipations) {
      const otherParticipants = await db
        .select()
        .from(conversationParticipantsTable)
        .where(eq(conversationParticipantsTable.conversationId, p.conversationId));

      const otherConvo = await db.select().from(conversationsTable).where(eq(conversationsTable.id, p.conversationId));

      if (otherParticipants.length === 2 && !otherConvo[0]?.isGroup) {
        const hasOtherUser = otherParticipants.some((op) => op.userId === participantIds[0]);
        if (hasOtherUser) {
          const existing = await getConversationWithDetails(p.conversationId, userId);
          res.status(201).json(existing);
          return;
        }
      }
    }
  }

  const [convo] = await db
    .insert(conversationsTable)
    .values({ isGroup, name: name ?? null })
    .returning();

  await db.insert(conversationParticipantsTable).values(
    allParticipants.map((uid) => ({ conversationId: convo.id, userId: uid }))
  );

  const result = await getConversationWithDetails(convo.id, userId);
  res.status(201).json(result);
});

router.get("/conversations/:conversationId", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const rawId = Array.isArray(req.params.conversationId) ? req.params.conversationId[0] : req.params.conversationId;
  const conversationId = parseInt(rawId, 10);

  const result = await getConversationWithDetails(conversationId, req.user.id);
  if (!result) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  res.json(result);
});

// DELETE /conversations/:conversationId — remove user from conversation (delete from their side)
router.delete("/conversations/:conversationId", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const conversationId = parseInt(req.params.conversationId, 10);
  const userId = req.user!.id;

  // Verify user is a participant
  const [participant] = await db.select().from(conversationParticipantsTable)
    .where(and(
      eq(conversationParticipantsTable.conversationId, conversationId),
      eq(conversationParticipantsTable.userId, userId)
    ));

  if (!participant) { res.status(404).json({ error: "Conversation not found" }); return; }

  // Remove user from conversation
  await db.delete(conversationParticipantsTable)
    .where(and(
      eq(conversationParticipantsTable.conversationId, conversationId),
      eq(conversationParticipantsTable.userId, userId)
    ));

  // If no participants left, delete the conversation and messages entirely
  const remaining = await db.select().from(conversationParticipantsTable)
    .where(eq(conversationParticipantsTable.conversationId, conversationId));

  if (remaining.length === 0) {
    await db.delete(messagesTable).where(eq(messagesTable.conversationId, conversationId));
    await db.delete(conversationsTable).where(eq(conversationsTable.id, conversationId));
  }

  res.json({ ok: true });
});

export default router;
