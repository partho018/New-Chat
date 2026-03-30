import webpush from "web-push";

let vapidPublicKey: string;
let vapidPrivateKey: string;

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
  vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
} else {
  const keys = webpush.generateVAPIDKeys();
  vapidPublicKey = keys.publicKey;
  vapidPrivateKey = keys.privateKey;
  console.log("=== Generated VAPID Keys (add to env for persistence) ===");
  console.log("VAPID_PUBLIC_KEY=" + vapidPublicKey);
  console.log("VAPID_PRIVATE_KEY=" + vapidPrivateKey);
  console.log("=========================================================");
}

webpush.setVapidDetails(
  "mailto:prome@app.com",
  vapidPublicKey,
  vapidPrivateKey
);

export { webpush, vapidPublicKey };

export async function sendPushNotification(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: { title: string; body: string; icon?: string; tag?: string; url?: string; type?: "message" | "call" }
) {
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
      },
      JSON.stringify(payload)
    );
  } catch (err: any) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      return "expired";
    }
    throw err;
  }
}
