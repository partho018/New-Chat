import { Router } from "express";
import { db } from "@workspace/db";
import { expoPushTokensTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";

const router = Router();

/**
 * Register a native Android FCM token.
 * Accepts both /register-fcm and /fcm-token paths for compatibility.
 */
async function handleFcmTokenRegister(req: any, res: any): Promise<void> {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const userId = req.user.id as string;
  const { token } = req.body;
  if (!token || typeof token !== "string" || token.length < 10) {
    res.status(400).json({ error: "Invalid FCM token" });
    return;
  }
  try {
    await db
      .insert(expoPushTokensTable)
      .values({ userId, token })
      .onConflictDoUpdate({ target: expoPushTokensTable.token, set: { userId } });
    res.json({ success: true });
  } catch (err) {
    console.error("FCM token register error:", err);
    res.status(500).json({ error: "Failed to save token" });
  }
}

router.post("/api/push/register-fcm", handleFcmTokenRegister);
router.post("/api/push/fcm-token", handleFcmTokenRegister);

/**
 * Unregister a native Android FCM token (on logout or token refresh).
 */
router.delete("/api/push/register-fcm", async (req: any, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.user.id as string;
  const { token } = req.body;
  if (!token) { res.status(400).json({ error: "Token required" }); return; }
  try {
    await db.delete(expoPushTokensTable)
      .where(and(eq(expoPushTokensTable.userId, userId), eq(expoPushTokensTable.token, token)));
    res.json({ success: true });
  } catch { res.status(500).json({ error: "Failed" }); }
});

router.post("/api/push/expo-token", async (req: any, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const userId = req.user.id as string;
  const { token } = req.body;

  if (!token || !token.startsWith("ExponentPushToken[")) {
    res.status(400).json({ error: "Invalid Expo push token" });
    return;
  }

  try {
    await db
      .insert(expoPushTokensTable)
      .values({ userId, token })
      .onConflictDoUpdate({
        target: expoPushTokensTable.token,
        set: { userId },
      });

    res.json({ success: true });
  } catch (err) {
    console.error("Expo push token error:", err);
    res.status(500).json({ error: "Failed to save token" });
  }
});

router.delete("/api/push/expo-token", async (req: any, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const userId = req.user.id as string;
  const { token } = req.body;

  if (!token) {
    res.status(400).json({ error: "Token required" });
    return;
  }

  try {
    await db
      .delete(expoPushTokensTable)
      .where(and(eq(expoPushTokensTable.userId, userId), eq(expoPushTokensTable.token, token)));

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to remove token" });
  }
});

export default router;

export async function sendExpoPushNotifications(
  userIds: string[],
  payload: { title: string; body: string; data?: Record<string, unknown> }
) {
  if (userIds.length === 0) return;

  try {
    const tokenRows = await db
      .select()
      .from(expoPushTokensTable)
      .where(
        userIds.length === 1
          ? eq(expoPushTokensTable.userId, userIds[0])
          : inArray(expoPushTokensTable.userId, userIds)
      );

    if (tokenRows.length === 0) return;

    const messages = tokenRows.map((row) => ({
      to: row.token,
      sound: "default" as const,
      title: payload.title,
      body: payload.body,
      data: payload.data || {},
    }));

    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
      },
      body: JSON.stringify(messages),
    });

    if (!response.ok) {
      console.error("Expo push send failed:", await response.text());
    }
  } catch (err) {
    console.error("Failed to send Expo push notifications:", err);
  }
}
