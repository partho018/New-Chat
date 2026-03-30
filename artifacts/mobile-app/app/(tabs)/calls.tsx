import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { getCalls, CallEntry, APP_BASE } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useThemeColors } from "@/lib/theme";
import { useCall } from "@/contexts/CallContext";

function formatCallTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "";
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
  if (days === 1) return "Yesterday";
  if (days < 7) return date.toLocaleDateString("en-US", { weekday: "long" });
  return date.toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

function formatDuration(s: number | null): string {
  if (!s || s === 0) return "";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec > 0 ? `${sec}s` : ""}`.trim() : `${sec}s`;
}

function CallItem({
  entry,
  currentUserId,
  onCallBack,
}: {
  entry: CallEntry;
  currentUserId: string;
  onCallBack: (entry: CallEntry) => void;
}) {
  const COLORS = useThemeColors();
  const isMine = entry.callerId === currentUserId;
  const isMissed = !entry.answeredAt;
  const callType = entry.callType || "audio";

  // The "other" person: if I made the call → other is callee; if I received → other is caller
  const other = isMine ? entry.callee : entry.caller;
  const name = other?.displayName || other?.username || "Unknown";
  const rawAvatar = other?.avatarUrl;
  const avatarUrl = rawAvatar
    ? rawAvatar.startsWith("http") ? rawAvatar : `${APP_BASE}${rawAvatar}`
    : null;

  const initials = name ? name.trim().split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2) : "?";

  let dirLabel = "";
  let dirColor = COLORS.muted;
  let dirIcon: any = "arrow-up-outline";

  if (isMine) {
    dirLabel = isMissed ? "Cancelled" : "Outgoing";
    dirIcon = "arrow-up-outline";
    dirColor = isMissed ? COLORS.danger : COLORS.muted;
  } else {
    dirLabel = isMissed ? "Missed" : "Incoming";
    dirIcon = "arrow-down-outline";
    dirColor = isMissed ? COLORS.danger : COLORS.muted;
  }

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 20,
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: COLORS.border,
      }}
    >
      {/* Avatar */}
      <View
        style={{
          width: 52,
          height: 52,
          borderRadius: 26,
          overflow: "hidden",
          backgroundColor: COLORS.card,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {avatarUrl ? (
          <Image source={{ uri: avatarUrl }} style={{ width: 52, height: 52 }} />
        ) : (
          <Text style={{ fontSize: 20, color: "#fff", fontFamily: "Inter_600SemiBold" }}>
            {initials}
          </Text>
        )}
      </View>

      {/* Info */}
      <View style={{ flex: 1, marginLeft: 14 }}>
        <Text
          style={{
            fontSize: 16,
            color: isMissed && !isMine ? COLORS.danger : COLORS.text,
            fontFamily: "Inter_600SemiBold",
            marginBottom: 4,
          }}
        >
          {name}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
          <Ionicons name={dirIcon} size={13} color={dirColor} />
          <Text style={{ fontSize: 13, color: dirColor, fontFamily: "Inter_400Regular" }}>
            {dirLabel}
          </Text>
          {callType === "video" && (
            <>
              <Text style={{ color: COLORS.border }}> · </Text>
              <Ionicons name="videocam-outline" size={13} color={COLORS.muted} />
              <Text style={{ fontSize: 13, color: COLORS.muted, fontFamily: "Inter_400Regular" }}>Video</Text>
            </>
          )}
          {!isMissed && entry.duration ? (
            <>
              <Text style={{ color: COLORS.border }}> · </Text>
              <Text style={{ fontSize: 13, color: COLORS.muted, fontFamily: "Inter_400Regular" }}>
                {formatDuration(entry.duration)}
              </Text>
            </>
          ) : null}
        </View>
      </View>

      {/* Time + Call-back button */}
      <View style={{ alignItems: "flex-end", gap: 8 }}>
        <Text style={{ fontSize: 12, color: COLORS.muted, fontFamily: "Inter_400Regular" }}>
          {formatCallTime(entry.createdAt)}
        </Text>
        <TouchableOpacity
          style={{
            padding: 6,
            backgroundColor: `${COLORS.primary}18`,
            borderRadius: 20,
          }}
          onPress={() => onCallBack(entry)}
        >
          <Ionicons
            name={callType === "video" ? "videocam-outline" : "call-outline"}
            size={18}
            color={COLORS.primary}
          />
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function CallsScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const COLORS = useThemeColors();
  const { startCall } = useCall();

  const [calls, setCalls] = useState<CallEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);

  const loadCalls = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const data = await getCalls();
      setCalls(Array.isArray(data) ? data : []);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Reload when tab is focused
  useFocusEffect(
    useCallback(() => {
      loadCalls();
    }, [loadCalls])
  );

  const handleCallBack = useCallback((entry: CallEntry) => {
    // Find the other person
    const isMine = entry.callerId === user?.id;
    const otherId = isMine ? entry.calleeId : entry.callerId;
    const conversationId = entry.conversationId;

    if (!otherId || !conversationId) return;

    // Navigate to the chat screen and start the call
    router.push(`/chat/${conversationId}`);
    setTimeout(() => {
      startCall(otherId, (entry.callType as "audio" | "video") || "audio", conversationId);
    }, 500);
  }, [user?.id, startCall]);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg, paddingTop: insets.top }}>
      {/* Header */}
      <View
        style={{
          paddingHorizontal: 20,
          paddingVertical: 16,
          borderBottomWidth: 1,
          borderBottomColor: COLORS.border,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Text style={{ fontSize: 24, fontFamily: "Inter_700Bold", color: COLORS.text }}>
          Calls
        </Text>
        <TouchableOpacity onPress={() => loadCalls(true)} style={{ padding: 4 }}>
          <Ionicons name="refresh-outline" size={22} color={COLORS.muted} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color={COLORS.primary} style={{ flex: 1 }} />
      ) : error ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 40 }}>
          <Ionicons name="wifi-outline" size={64} color={COLORS.border} />
          <Text style={{ fontSize: 18, color: COLORS.text, fontFamily: "Inter_600SemiBold", marginTop: 16, marginBottom: 8 }}>
            Could not load calls
          </Text>
          <TouchableOpacity
            style={{ paddingHorizontal: 24, paddingVertical: 10, backgroundColor: COLORS.primary, borderRadius: 20, marginTop: 8 }}
            onPress={() => loadCalls()}
          >
            <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold" }}>Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : calls.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 40 }}>
          <View
            style={{
              width: 80,
              height: 80,
              borderRadius: 40,
              backgroundColor: `${COLORS.primary}15`,
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 16,
            }}
          >
            <Ionicons name="call-outline" size={40} color={`${COLORS.primary}60`} />
          </View>
          <Text style={{ fontSize: 18, color: COLORS.text, fontFamily: "Inter_600SemiBold", marginBottom: 8 }}>
            No calls yet
          </Text>
          <Text style={{ fontSize: 14, color: COLORS.muted, textAlign: "center", fontFamily: "Inter_400Regular" }}>
            Start a call from any conversation
          </Text>
        </View>
      ) : (
        <FlatList
          data={calls}
          keyExtractor={item => String(item.id)}
          renderItem={({ item }) => (
            <CallItem
              entry={item}
              currentUserId={user?.id || ""}
              onCallBack={handleCallBack}
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => loadCalls(true)}
              tintColor={COLORS.primary}
              colors={[COLORS.primary]}
            />
          }
          contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}
