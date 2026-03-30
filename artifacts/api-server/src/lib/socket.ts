import { Server as SocketIOServer, Socket } from "socket.io";
import { db } from "@workspace/db";
import { userStatusTable, messagesTable, messageSeenTable, messageDeliveredTable, conversationParticipantsTable, pushSubscriptionsTable, expoPushTokensTable } from "@workspace/db";
import { eq, and, lte, inArray } from "drizzle-orm";
import { getSessionFromCookie, getUserById } from "./auth";
import { logger } from "./logger";
import { sendPushNotification } from "./push";
import { sendFcmNotifications, filterFcmTokens } from "./fcm";

const userSocketMap = new Map<string, string>(); // userId -> socketId

// Track active calls: key = `${callerId}:${calleeId}`, value = call metadata
interface ActiveCall {
  callerId: string;
  calleeId: string;
  callType: string;
  conversationId: number | null;
  startedAt: number;       // Date.now() when call-offer was sent
  answeredAt: number | null; // Date.now() when accepted
}
const activeCallsMap = new Map<string, ActiveCall>();

function callKey(a: string, b: string) {
  return [a, b].sort().join(":");
}

export function setupSocketIO(io: SocketIOServer) {
  io.use(async (socket, next) => {
    try {
      // Support Bearer token from mobile clients
      const authToken = socket.handshake.auth?.token as string | undefined;
      if (authToken) {
        const { getSession } = await import("./auth");
        const session = await getSession(authToken);
        if (!session?.user?.id) {
          return next(new Error("Unauthorized"));
        }
        (socket as any).userId = session.user.id;
        return next();
      }
      // Fallback to cookie auth
      const cookieHeader = socket.handshake.headers.cookie || "";
      const userId = await getSessionFromCookie(cookieHeader);
      if (!userId) {
        return next(new Error("Unauthorized"));
      }
      (socket as any).userId = userId;
      next();
    } catch (err) {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", async (socket: Socket) => {
    const userId = (socket as any).userId as string;
    logger.info({ userId, socketId: socket.id }, "User connected");

    userSocketMap.set(userId, socket.id);
    socket.join(`user:${userId}`);

    // Set user online (do NOT overwrite lastSeen on connect)
    await db
      .insert(userStatusTable)
      .values({ userId, isOnline: true })
      .onConflictDoUpdate({
        target: userStatusTable.userId,
        set: { isOnline: true },
      });

    // Notify others about online status
    socket.broadcast.emit("user-status", { userId, isOnline: true });

    // Join user to all their conversations
    const participations = await db
      .select()
      .from(conversationParticipantsTable)
      .where(eq(conversationParticipantsTable.userId, userId));

    const convIds = participations.map(p => p.conversationId);
    for (const p of participations) {
      socket.join(`conversation:${p.conversationId}`);
    }

    // Mark unread messages (from others) in all conversations as delivered
    if (convIds.length > 0) {
      try {
        const undeliveredMsgs = await db
          .select({ id: messagesTable.id, conversationId: messagesTable.conversationId, senderId: messagesTable.senderId })
          .from(messagesTable)
          .where(and(inArray(messagesTable.conversationId, convIds)));

        const msgIds = undeliveredMsgs.filter(m => m.senderId !== userId).map(m => m.id);
        if (msgIds.length > 0) {
          const alreadyDelivered = await db.select({ messageId: messageDeliveredTable.messageId })
            .from(messageDeliveredTable)
            .where(and(eq(messageDeliveredTable.userId, userId), inArray(messageDeliveredTable.messageId, msgIds)));
          const alreadyDeliveredIds = new Set(alreadyDelivered.map(r => r.messageId));
          const toInsert = msgIds.filter(id => !alreadyDeliveredIds.has(id)).map(id => ({ messageId: id, userId }));
          if (toInsert.length > 0) {
            await db.insert(messageDeliveredTable).values(toInsert).onConflictDoNothing();
            // Emit delivery status per-message to conversation room
            for (const msg of undeliveredMsgs.filter(m => toInsert.some(t => t.messageId === m.id))) {
              const deliveredRecords = await db.select({ userId: messageDeliveredTable.userId })
                .from(messageDeliveredTable).where(eq(messageDeliveredTable.messageId, msg.id));
              io.to(`conversation:${msg.conversationId}`).emit("message-delivered", {
                messageId: msg.id,
                deliveredTo: deliveredRecords.map(r => r.userId),
              });
            }
          }
        }
      } catch (err) {
        logger.error("Delivery tracking error:", err);
      }
    }

    socket.on("join-conversation", async (conversationId: number) => {
      socket.join(`conversation:${conversationId}`);
    });

    socket.on("typing-start", async ({ conversationId }: { conversationId: number }) => {
      socket.to(`conversation:${conversationId}`).emit("typing", {
        userId,
        conversationId,
        isTyping: true,
      });
    });

    socket.on("typing-stop", async ({ conversationId }: { conversationId: number }) => {
      socket.to(`conversation:${conversationId}`).emit("typing", {
        userId,
        conversationId,
        isTyping: false,
      });
    });

    socket.on("mark-seen", async ({ conversationId, messageId }: { conversationId: number; messageId: number }) => {
      try {
        // Mark ALL messages in this conversation up to messageId as seen (from other senders)
        const allMsgs = await db
          .select({ id: messagesTable.id })
          .from(messagesTable)
          .where(
            and(
              eq(messagesTable.conversationId, conversationId),
              lte(messagesTable.id, messageId)
            )
          );

        const msgIds = allMsgs.map(m => m.id);

        if (msgIds.length > 0) {
          // Get already-seen message IDs for this user
          const alreadySeen = await db
            .select({ messageId: messageSeenTable.messageId })
            .from(messageSeenTable)
            .where(and(eq(messageSeenTable.userId, userId), inArray(messageSeenTable.messageId, msgIds)));

          const alreadySeenIds = new Set(alreadySeen.map(r => r.messageId));
          const toInsert = msgIds.filter(id => !alreadySeenIds.has(id)).map(id => ({ messageId: id, userId }));

          if (toInsert.length > 0) {
            await db.insert(messageSeenTable).values(toInsert);
          }
        }

        // Get seenBy for the specific messageId (for UI update)
        const seenRecords = await db
          .select()
          .from(messageSeenTable)
          .where(eq(messageSeenTable.messageId, messageId));

        const seenBy = seenRecords.map((r) => r.userId);

        io.to(`conversation:${conversationId}`).emit("message-seen", {
          messageId,
          conversationId,
          seenBy,
        });
      } catch (err) {
        logger.error({ err }, "Error marking message seen");
      }
    });

    // Ephemeral media — not stored in DB, just relayed in real-time
    socket.on("send-ephemeral-media", async ({
      conversationId,
      dataUrl,
      mediaType,
      fileName,
    }: {
      conversationId: number;
      dataUrl: string;
      mediaType: "image" | "video" | "voice";
      fileName?: string;
    }) => {
      try {
        // Verify sender is a participant
        const participation = await db
          .select()
          .from(conversationParticipantsTable)
          .where(
            and(
              eq(conversationParticipantsTable.conversationId, conversationId),
              eq(conversationParticipantsTable.userId, userId),
            ),
          )
          .limit(1);

        if (!participation.length) return;

        const user = await getUserById(userId);

        // Relay to others in the room (NOT to sender — sender adds it locally)
        socket.to(`conversation:${conversationId}`).emit("ephemeral-media", {
          tempId: `${userId}-${Date.now()}`,
          senderId: userId,
          senderName: user?.firstName || user?.username || user?.email || "Unknown",
          conversationId,
          dataUrl,
          mediaType,
          fileName,
          createdAt: new Date().toISOString(),
        });
      } catch (err) {
        logger.error({ err }, "Error relaying ephemeral media");
      }
    });

    // Call signaling
    socket.on("call-offer", async ({ targetUserId, peerId, callType, conversationId }: { targetUserId: string; peerId: string; callType: string; conversationId?: number }) => {
      const targetSocketId = userSocketMap.get(targetUserId);
      const caller = await getUserById(userId);

      const userStatus = await db
        .select()
        .from(userStatusTable)
        .where(eq(userStatusTable.userId, userId));
      const callerIsOnline = userStatus.length > 0 ? userStatus[0].isOnline : false;

      const callerDisplayName = userStatus[0]?.displayName;
      const callerName = callerDisplayName
        || (caller?.firstName ? `${caller.firstName} ${caller.lastName || ""}`.trim() : null)
        || caller?.username
        || caller?.email
        || "Unknown";

      // Track this call
      const key = callKey(userId, targetUserId);
      activeCallsMap.set(key, {
        callerId: userId,
        calleeId: targetUserId,
        callType: callType || "audio",
        conversationId: conversationId ?? null,
        startedAt: Date.now(),
        answeredAt: null,
      });

      if (targetSocketId) {
        io.to(`user:${targetUserId}`).emit("incoming-call", {
          callerId: userId,
          callerName,
          callerAvatar: caller?.profileImageUrl,
          peerId,
          callType,
          callerIsOnline,
          conversationId,
        });
      } else {
        // Target is offline — send push notification
        try {
          const subscriptions = await db
            .select()
            .from(pushSubscriptionsTable)
            .where(eq(pushSubscriptionsTable.userId, targetUserId));

          const callIcon = callType === "video" ? "🎥" : "📞";
          await Promise.allSettled(
            subscriptions.map(sub =>
              sendPushNotification(
                { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
                {
                  title: `${callIcon} Incoming ${callType} call`,
                  body: `${callerName} is calling you`,
                  icon: caller?.profileImageUrl || "/icon.webp",
                  tag: `call-${userId}`,
                  url: "/",
                  type: "call" as const,
                }
              )
            )
          );

          // FCM call notification for native Android (full-screen incoming call UI)
          const fcmRows = await db
            .select()
            .from(expoPushTokensTable)
            .where(eq(expoPushTokensTable.userId, targetUserId));
          const fcmTokens = filterFcmTokens(fcmRows);
          if (fcmTokens.length > 0) {
            await sendFcmNotifications(fcmTokens, {
              title: `${callIcon} Incoming ${callType} call`,
              body: `${callerName} is calling you`,
              isCallNotification: true,
              priority: "high",
              data: {
                type: "call",
                callType: callType || "audio",
                callerId: userId,
                callerName,
                callerAvatar: caller?.profileImageUrl || "",
                peerId,
                conversationId: conversationId != null ? String(conversationId) : "",
              },
            });
          }
        } catch (err) {
          logger.error({ err }, "Failed to send call push notification");
        }
      }
    });

    socket.on("call-answer", async ({ callerId, accepted, peerId }: { callerId: string; accepted: boolean; peerId: string }) => {
      io.to(`user:${callerId}`).emit("call-answer", { callerId: userId, accepted, peerId });

      // Mark call as answered
      if (accepted) {
        const key = callKey(callerId, userId);
        const call = activeCallsMap.get(key);
        if (call) {
          call.answeredAt = Date.now();
          activeCallsMap.set(key, call);
        }
      }
    });

    socket.on("call-end", async ({ userId: targetUserId }: { userId: string }) => {
      io.to(`user:${targetUserId}`).emit("call-end", { userId });

      // Save call record to DB
      const key = callKey(userId, targetUserId);
      const call = activeCallsMap.get(key);
      if (call && call.conversationId) {
        activeCallsMap.delete(key);
        const endedAt = Date.now();
        const durationSecs = call.answeredAt
          ? Math.round((endedAt - call.answeredAt) / 1000)
          : 0;
        const status = call.answeredAt ? "completed" : "missed";
        try {
          const [savedMsg] = await db.insert(messagesTable).values({
            conversationId: call.conversationId,
            senderId: call.callerId,
            messageType: "call",
            content: JSON.stringify({ callType: call.callType, status, calleeId: call.calleeId }),
            duration: durationSecs > 0 ? durationSecs : null,
          }).returning();
          // Emit the call message to the conversation room so both users see it
          if (savedMsg) {
            io.to(`conversation:${call.conversationId}`).emit("new-message", {
              ...savedMsg,
              createdAt: savedMsg.createdAt.toISOString(),
              sender: { id: call.callerId },
              messageType: "call",
            });
          }
        } catch (err) {
          logger.error({ err }, "Failed to save call record");
        }
      } else {
        // Remove from map even if not saved
        activeCallsMap.delete(key);
      }
    });

    // WebRTC signaling relay
    socket.on("webrtc-offer", ({ targetUserId, sdp }: { targetUserId: string; sdp: any }) => {
      io.to(`user:${targetUserId}`).emit("webrtc-offer", { fromUserId: userId, sdp });
    });

    socket.on("webrtc-answer", ({ targetUserId, sdp }: { targetUserId: string; sdp: any }) => {
      io.to(`user:${targetUserId}`).emit("webrtc-answer", { fromUserId: userId, sdp });
    });

    socket.on("webrtc-ice-candidate", ({ targetUserId, candidate }: { targetUserId: string; candidate: any }) => {
      io.to(`user:${targetUserId}`).emit("webrtc-ice-candidate", { fromUserId: userId, candidate });
    });

    // Screen share signaling relay
    socket.on("screen-share", ({ targetUserId, isSharing }: { targetUserId: string; isSharing: boolean }) => {
      io.to(`user:${targetUserId}`).emit("screen-share", { fromUserId: userId, isSharing });
    });

    socket.on("screen-share-offer", ({ targetUserId, sdp }: { targetUserId: string; sdp: any }) => {
      io.to(`user:${targetUserId}`).emit("screen-share-offer", { fromUserId: userId, sdp });
    });

    socket.on("screen-share-answer", ({ targetUserId, sdp }: { targetUserId: string; sdp: any }) => {
      io.to(`user:${targetUserId}`).emit("screen-share-answer", { fromUserId: userId, sdp });
    });

    socket.on("disconnect", async () => {
      logger.info({ userId, socketId: socket.id }, "User disconnected");
      userSocketMap.delete(userId);

      const now = new Date();
      await db
        .update(userStatusTable)
        .set({ isOnline: false, lastSeen: now })
        .where(eq(userStatusTable.userId, userId));

      socket.broadcast.emit("user-status", { userId, isOnline: false, lastSeen: now.toISOString() });
    });
  });
}

export function emitNewMessage(io: SocketIOServer, conversationId: number, message: any) {
  io.to(`conversation:${conversationId}`).emit("new-message", message);
}
