/**
 * Firebase Cloud Messaging (FCM) push notification sender for native Android.
 *
 * Requires the FIREBASE_SERVICE_ACCOUNT environment variable to be set with
 * the Firebase Admin SDK service account JSON (from Firebase Console →
 * Project Settings → Service Accounts → Generate New Private Key).
 *
 * If the variable is not set, FCM sends are silently skipped (app still works
 * via web-push for browsers and Expo push for Expo builds).
 */

import admin from "firebase-admin";

let initialized = false;

function getApp(): admin.app.App | null {
  if (initialized) return admin.apps[0] ?? null;

  const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!sa) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[FCM] FIREBASE_SERVICE_ACCOUNT not set — FCM push disabled");
    }
    initialized = true;
    return null;
  }

  try {
    const serviceAccount = JSON.parse(sa) as admin.ServiceAccount;
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    initialized = true;
    console.log("[FCM] Firebase Admin SDK initialized ✓");
    return admin.apps[0] ?? null;
  } catch (err) {
    console.error("[FCM] Failed to initialize Firebase Admin SDK:", err);
    initialized = true;
    return null;
  }
}

export interface FcmPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  priority?: "high" | "normal";
  /** For call notifications — shows a full-screen incoming call UI on Android */
  isCallNotification?: boolean;
}

/**
 * Send FCM push to one or more native Android FCM tokens.
 * Expo tokens (ExponentPushToken[…]) are silently skipped — use sendExpoPushNotifications() for those.
 */
export async function sendFcmNotifications(
  tokens: string[],
  payload: FcmPayload
): Promise<void> {
  // Filter to native FCM tokens only
  const fcmTokens = tokens.filter(t => !t.startsWith("ExponentPushToken["));
  if (fcmTokens.length === 0) return;

  const app = getApp();
  if (!app) return; // FCM not configured

  const messaging = admin.messaging(app);
  const { title, body, data = {}, priority = "high", isCallNotification = false } = payload;

  const results = await Promise.allSettled(
    fcmTokens.map(token =>
      messaging.send({
        token,
        notification: { title, body },
        data,
        android: {
          priority: priority === "high" ? "high" : "normal",
          notification: {
            channelId: isCallNotification ? "call_channel" : "chat_messages",
            priority: isCallNotification ? "max" : "high",
            defaultSound: true,
            defaultVibrateTimings: true,
          },
          ...(isCallNotification && {
            directBootOk: true,
          }),
        },
      })
    )
  );

  const failed = results.filter(r => r.status === "rejected");
  if (failed.length > 0) {
    console.warn(`[FCM] ${failed.length}/${fcmTokens.length} notifications failed`);
  }
}

/**
 * Retrieve all FCM tokens for a list of userIds from the token store.
 * Filters out Expo tokens — returns only native FCM tokens.
 */
export function filterFcmTokens(rows: { token: string }[]): string[] {
  return rows.map(r => r.token).filter(t => !t.startsWith("ExponentPushToken["));
}
