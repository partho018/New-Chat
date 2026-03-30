import { Router } from "express";
import { db } from "@workspace/db";
import { pushSubscriptionsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { vapidPublicKey } from "../lib/push";

const router = Router();

// Get VAPID public key (no auth required)
router.get("/api/push/vapid-public-key", (_req, res) => {
  res.json({ publicKey: vapidPublicKey });
});

// Subscribe to push notifications
router.post("/api/push/subscribe", async (req: any, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const userId = req.user.id as string;
  const { endpoint, keys } = req.body;

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    res.status(400).json({ error: "Invalid subscription" });
    return;
  }

  try {
    await db
      .insert(pushSubscriptionsTable)
      .values({
        userId,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
      })
      .onConflictDoUpdate({
        target: pushSubscriptionsTable.endpoint,
        set: {
          userId,
          p256dh: keys.p256dh,
          auth: keys.auth,
        },
      });

    res.json({ success: true });
  } catch (err) {
    console.error("Push subscribe error:", err);
    res.status(500).json({ error: "Failed to save subscription" });
  }
});

// Unsubscribe from push notifications
router.delete("/api/push/unsubscribe", async (req: any, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const userId = req.user.id as string;
  const { endpoint } = req.body;

  if (!endpoint) {
    res.status(400).json({ error: "Endpoint required" });
    return;
  }

  try {
    await db
      .delete(pushSubscriptionsTable)
      .where(
        and(
          eq(pushSubscriptionsTable.userId, userId),
          eq(pushSubscriptionsTable.endpoint, endpoint)
        )
      );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to remove subscription" });
  }
});

export default router;
