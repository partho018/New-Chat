import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { registerExpoPushToken, registerFcmToken, getToken } from "./api";

export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    console.log("Push notifications require a physical device");
    return null;
  }

  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== "granted") {
      console.log("Push notification permission denied");
      return null;
    }

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("messages", {
        name: "Messages",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#10b981",
        sound: "default",
      });
      await Notifications.setNotificationChannelAsync("calls", {
        name: "Calls",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 500, 250, 500],
        lightColor: "#3b82f6",
        sound: "default",
      });
    }

    // Try native FCM token first (works in development builds, not Expo Go)
    try {
      const fcmTokenData = await Notifications.getDevicePushTokenAsync();
      if (fcmTokenData?.data && Platform.OS === "android") {
        const authToken = await getToken();
        if (authToken) {
          await registerFcmToken(fcmTokenData.data, "android").catch(() => {});
        }
        console.log("FCM token registered");
        return fcmTokenData.data;
      }
    } catch (fcmErr) {
      console.log("FCM token unavailable, using Expo token:", fcmErr);
    }

    // Fallback: Expo push token (works in Expo Go)
    const projectId =
      Constants?.expoConfig?.extra?.eas?.projectId ??
      Constants?.easConfig?.projectId;

    const tokenData = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );

    const token = tokenData.data;
    await registerExpoPushToken(token);
    return token;
  } catch (err) {
    console.log("Push notifications not available in this environment:", err);
    return null;
  }
}

export function setupNotificationHandler() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}
