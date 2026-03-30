import React, { createContext, useContext, useEffect, useRef } from "react";
import * as Notifications from "expo-notifications";
import { Platform, Vibration } from "react-native";
import { Audio } from "expo-av";
import { router } from "expo-router";
import { registerForPushNotifications } from "@/lib/notifications";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    priority: Notifications.AndroidNotificationPriority.MAX,
  }),
});

interface NotificationContextValue {
  playRingtone: () => void;
  stopRingtone: () => void;
  vibrateMessage: () => void;
  vibrateCall: () => void;
  scheduleLocalNotification: (opts: {
    title: string;
    body: string;
    data?: Record<string, unknown>;
    isCall?: boolean;
  }) => Promise<void>;
}

const NotificationContext = createContext<NotificationContextValue>({
  playRingtone: () => {},
  stopRingtone: () => {},
  vibrateMessage: () => {},
  vibrateCall: () => {},
  scheduleLocalNotification: async () => {},
});

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const ringtoneRef = useRef<Audio.Sound | null>(null);
  const ringtoneLoopRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setupChannels();
    setupAudio();
    registerForPushNotifications().catch(() => {});

    const responseSub = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data as any;
      if (data?.conversationId) {
        router.push(`/chat/${data.conversationId}`);
      }
    });

    return () => {
      responseSub.remove();
      _stopRingtone();
    };
  }, []);

  async function setupChannels() {
    if (Platform.OS !== "android") return;
    try {
      await Notifications.setNotificationChannelAsync("messages", {
        name: "Messages",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 200, 100, 200],
        lightColor: "#10b981",
        sound: "default",
        enableVibrate: true,
      });
      await Notifications.setNotificationChannelAsync("calls", {
        name: "Incoming Calls",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 600, 300, 600, 300, 600],
        lightColor: "#10b981",
        sound: "default",
        enableVibrate: true,
        bypassDnd: true,
        showBadge: true,
      });
    } catch {}
  }

  async function setupAudio() {
    try {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: false,
        allowsRecordingIOS: false,
      });
    } catch {}
  }

  async function _stopRingtone() {
    if (ringtoneLoopRef.current) {
      clearInterval(ringtoneLoopRef.current);
      ringtoneLoopRef.current = null;
    }
    Vibration.cancel();
    if (ringtoneRef.current) {
      try {
        await ringtoneRef.current.stopAsync();
        await ringtoneRef.current.unloadAsync();
      } catch {}
      ringtoneRef.current = null;
    }
  }

  const playRingtone = () => {
    _stopRingtone();
    // Repeating vibration pattern for ringtone (ring ring pattern)
    Vibration.vibrate([0, 700, 400, 700, 400, 700, 1000], true);
  };

  const stopRingtone = () => {
    _stopRingtone();
  };

  const vibrateMessage = () => {
    Vibration.vibrate([0, 150, 50, 150]);
  };

  const vibrateCall = () => {
    Vibration.vibrate([0, 700, 400, 700, 400, 700, 1000], true);
  };

  const scheduleLocalNotification = async ({
    title,
    body,
    data = {},
    isCall = false,
  }: {
    title: string;
    body: string;
    data?: Record<string, unknown>;
    isCall?: boolean;
  }) => {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          data,
          sound: "default",
          priority: isCall
            ? Notifications.AndroidNotificationPriority.MAX
            : Notifications.AndroidNotificationPriority.HIGH,
          ...(Platform.OS === "android" && {
            channelId: isCall ? "calls" : "messages",
          }),
          badge: 1,
        },
        trigger: null,
      });
    } catch {}
  };

  return (
    <NotificationContext.Provider
      value={{
        playRingtone,
        stopRingtone,
        vibrateMessage,
        vibrateCall,
        scheduleLocalNotification,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  return useContext(NotificationContext);
}
