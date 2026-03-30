import React, { useEffect, useCallback, useState, useMemo } from "react";
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, TextInput, RefreshControl, Image, Alert, Pressable,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  getConversations, getUsers, createConversation, deleteConversation,
  ConversationWithDetails, User, APP_BASE, getToken,
} from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { io, Socket } from "socket.io-client";
import { useThemeColors } from "@/lib/theme";
import { useNotifications } from "@/contexts/NotificationContext";

let socket: Socket | null = null;

function formatTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "";
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
  if (days === 1) return "Yesterday";
  if (days < 7) return date.toLocaleDateString("en-US", { weekday: "short" });
  return date.toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

function Avatar({ name, url, size = 48, isOnline }: { name: string; url?: string | null; size?: number; isOnline?: boolean }) {
  const COLORS = useThemeColors();
  const initials = name ? name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2) : "?";
  const palette = [COLORS.primary, "#3b82f6", "#8b5cf6", "#ef4444", "#f59e0b"];
  const colorIndex = name.charCodeAt(0) % palette.length;
  const avatarUrl = url && !url.startsWith("http") ? `${APP_BASE}${url}` : url;

  return (
    <View style={{ width: size, height: size }}>
      {avatarUrl ? (
        <Image source={{ uri: avatarUrl }} style={{ width: size, height: size, borderRadius: size / 2 }} />
      ) : (
        <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: palette[colorIndex], alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: "#fff", fontSize: size * 0.38, fontFamily: "Inter_600SemiBold" }}>{initials}</Text>
        </View>
      )}
      {isOnline && (
        <View style={{ position: "absolute", bottom: 0, right: 0, width: size * 0.28, height: size * 0.28, borderRadius: size * 0.14, backgroundColor: COLORS.primary, borderWidth: 2, borderColor: COLORS.bg }} />
      )}
    </View>
  );
}

function LastMsgPreview({ msg, currentUserId }: { msg: ConversationWithDetails["lastMessage"]; currentUserId: string }) {
  const COLORS = useThemeColors();
  if (!msg) return <Text style={{ fontSize: 14, color: COLORS.muted, fontFamily: "Inter_400Regular", flex: 1, marginRight: 8 }}>No messages yet</Text>;
  const prefix = msg.senderId === currentUserId ? "You: " : "";
  let content = "";
  if (msg.isDeleted) content = "Message was deleted";
  else if (msg.messageType === "image") content = "📷 Photo";
  else if (msg.messageType === "video") content = "🎥 Video";
  else if (msg.messageType === "voice") content = "🎤 Voice message";
  else if (msg.messageType === "call") content = "📞 Call";
  else content = msg.content || "";
  return (
    <Text style={{ fontSize: 14, color: COLORS.muted, fontFamily: msg.isDeleted ? undefined : "Inter_400Regular", fontStyle: msg.isDeleted ? "italic" : "normal", flex: 1, marginRight: 8 }} numberOfLines={1}>
      {prefix}{content}
    </Text>
  );
}

function ConversationItem({ item, currentUserId, onPress, onDelete }: { item: ConversationWithDetails; currentUserId: string; onPress: () => void; onDelete: () => void }) {
  const COLORS = useThemeColors();
  const other = item.participants.find(p => p.id !== currentUserId);
  const name = item.isGroup ? item.name || "Group" : other?.displayName || other?.username || "Unknown";
  const lastMsg = item.lastMessage;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onDelete}
      delayLongPress={600}
      style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: COLORS.border }, pressed && { backgroundColor: COLORS.card }]}
    >
      <Avatar name={name} url={other?.avatarUrl} isOnline={other?.isOnline} />
      <View style={{ flex: 1, marginLeft: 14 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <Text style={{ fontSize: 16, color: COLORS.text, fontFamily: "Inter_600SemiBold", flex: 1, marginRight: 8 }} numberOfLines={1}>{name}</Text>
          {lastMsg && <Text style={{ fontSize: 12, color: COLORS.muted, fontFamily: "Inter_400Regular" }}>{formatTime(lastMsg.createdAt)}</Text>}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <LastMsgPreview msg={lastMsg} currentUserId={currentUserId} />
          {item.unreadCount > 0 && (
            <View style={{ backgroundColor: COLORS.primary, borderRadius: 10, minWidth: 20, height: 20, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 }}>
              <Text style={{ color: "#fff", fontSize: 11, fontFamily: "Inter_600SemiBold" }}>{item.unreadCount > 99 ? "99+" : item.unreadCount}</Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

function NewChatModal({ onClose }: { onClose: () => void }) {
  const COLORS = useThemeColors();
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();
  const { data: users = [], isLoading } = useQuery({ queryKey: ["/api/users"], queryFn: getUsers });
  const { user: currentUser } = useAuth();

  const filtered = users.filter(u =>
    u.id !== currentUser?.id &&
    (u.displayName?.toLowerCase().includes(search.toLowerCase()) || u.username?.toLowerCase().includes(search.toLowerCase()))
  );

  const handleSelect = async (user: User) => {
    try {
      const conv = await createConversation(user.id);
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      onClose();
      router.push({ pathname: "/chat/[id]", params: { id: conv.id, name: user.displayName || user.username, isOnline: user.isOnline ? "true" : "false", avatar: user.avatarUrl || "" } });
    } catch (err: any) {
      Alert.alert("Error", err.message);
    }
  };

  return (
    <View style={{ flex: 1, padding: 20, backgroundColor: COLORS.bg }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <Text style={{ fontSize: 20, color: COLORS.text, fontFamily: "Inter_700Bold" }}>New Chat</Text>
        <TouchableOpacity onPress={onClose}>
          <Ionicons name="close" size={24} color={COLORS.muted} />
        </TouchableOpacity>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: COLORS.card, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: COLORS.border, marginBottom: 16 }}>
        <Ionicons name="search" size={16} color={COLORS.muted} style={{ marginRight: 8 }} />
        <TextInput
          style={{ flex: 1, fontSize: 15, color: COLORS.text, fontFamily: "Inter_400Regular" }}
          placeholder="Search users..."
          placeholderTextColor={COLORS.muted}
          value={search}
          onChangeText={setSearch}
          autoFocus
        />
      </View>
      {isLoading ? (
        <ActivityIndicator color={COLORS.primary} style={{ marginTop: 20 }} />
      ) : filtered.length === 0 ? (
        <Text style={{ color: COLORS.muted, textAlign: "center", marginTop: 40, fontFamily: "Inter_400Regular" }}>No users found</Text>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={u => u.id}
          renderItem={({ item }) => (
            <TouchableOpacity style={{ flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border }} onPress={() => handleSelect(item)}>
              <Avatar name={item.displayName || item.username} url={item.avatarUrl} isOnline={item.isOnline} size={42} />
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text style={{ fontSize: 15, color: COLORS.text, fontFamily: "Inter_500Medium" }}>{item.displayName || item.username}</Text>
                <Text style={{ fontSize: 12, color: COLORS.muted, fontFamily: "Inter_400Regular" }}>@{item.username}</Text>
              </View>
              {item.isOnline && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.primary }} />}
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

export default function ConversationsScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const COLORS = useThemeColors();
  const { scheduleLocalNotification, vibrateMessage } = useNotifications();
  const [showNewChat, setShowNewChat] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [showSearch, setShowSearch] = useState(false);

  const { data: conversations = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["/api/conversations"],
    queryFn: getConversations,
    refetchInterval: 30_000,
  });

  useFocusEffect(
    useCallback(() => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
    }, [queryClient])
  );

  useEffect(() => {
    let mounted = true;
    async function connect() {
      const token = await getToken();
      if (!token || !mounted) return;
      socket = io(`https://${process.env.EXPO_PUBLIC_DOMAIN || "localhost:8080"}`, {
        path: "/api/socket.io",
        auth: { token },
        transports: ["websocket"],
      });

      socket.on("new-message", (msg: any) => {
        queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });

        // Show local notification if message is from someone else
        if (!mounted) return;
        if (msg?.sender?.id && msg.sender.id !== user?.id) {
          const senderName = msg.sender?.displayName || msg.sender?.username || "Someone";
          let body = "New message";
          if (msg.messageType === "text" && msg.content) {
            body = msg.content.length > 60 ? msg.content.substring(0, 60) + "…" : msg.content;
          } else if (msg.messageType === "image") body = "📷 Sent a photo";
          else if (msg.messageType === "video") body = "🎥 Sent a video";
          else if (msg.messageType === "voice") body = "🎤 Sent a voice message";

          vibrateMessage();
          scheduleLocalNotification({
            title: senderName,
            body,
            data: { conversationId: msg.conversationId },
          });
        }
      });

      socket.on("message-deleted", () => { queryClient.invalidateQueries({ queryKey: ["/api/conversations"] }); });
    }
    connect();
    return () => { mounted = false; socket?.disconnect(); socket = null; };
  }, [queryClient, user?.id, scheduleLocalNotification, vibrateMessage]);

  const sorted = useMemo(() => [...conversations].sort((a, b) => {
    const aTime = a.lastMessage?.createdAt || a.createdAt;
    const bTime = b.lastMessage?.createdAt || b.createdAt;
    return new Date(bTime).getTime() - new Date(aTime).getTime();
  }), [conversations]);

  const filtered = useMemo(() => searchText
    ? sorted.filter(c => {
      const other = c.participants.find(p => p.id !== user?.id);
      const name = c.isGroup ? c.name : other?.displayName || other?.username || "";
      return name?.toLowerCase().includes(searchText.toLowerCase());
    })
    : sorted, [sorted, searchText, user?.id]);

  const totalUnread = conversations.reduce((acc, c) => acc + (c.unreadCount || 0), 0);

  const handleDeleteConversation = (conv: ConversationWithDetails) => {
    const other = conv.participants.find(p => p.id !== user?.id);
    const name = conv.isGroup ? conv.name || "Group" : other?.displayName || other?.username || "Chat";
    Alert.alert("Delete Conversation", `Delete your conversation with "${name}"? This cannot be undone.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try {
          await deleteConversation(conv.id);
          queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
        } catch {
          Alert.alert("Error", "Could not delete conversation");
        }
      }},
    ]);
  };

  const navigateToChat = (item: ConversationWithDetails) => {
    const other = item.participants.find(p => p.id !== user?.id);
    router.push({
      pathname: "/chat/[id]",
      params: {
        id: item.id,
        name: item.isGroup ? item.name || "Group" : other?.displayName || other?.username || "Chat",
        isOnline: other?.isOnline ? "true" : "false",
        avatar: other?.avatarUrl || "",
        otherId: other?.id || "",
      },
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg, paddingTop: insets.top }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: COLORS.border }}>
        {showSearch ? (
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center", backgroundColor: COLORS.card, borderRadius: 12, paddingHorizontal: 12, gap: 8, borderWidth: 1, borderColor: COLORS.border }}>
            <Ionicons name="search" size={16} color={COLORS.muted} />
            <TextInput
              style={{ flex: 1, fontSize: 15, color: COLORS.text, fontFamily: "Inter_400Regular", paddingVertical: 10 }}
              placeholder="Search conversations..."
              placeholderTextColor={COLORS.muted}
              value={searchText}
              onChangeText={setSearchText}
              autoFocus
            />
            <TouchableOpacity onPress={() => { setShowSearch(false); setSearchText(""); }}>
              <Ionicons name="close" size={20} color={COLORS.muted} />
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <Text style={{ fontSize: 24, fontFamily: "Inter_700Bold", color: COLORS.text }}>
              Private {totalUnread > 0 && <Text style={{ fontSize: 18, color: COLORS.primary }}>({totalUnread})</Text>}
            </Text>
            <View style={{ flexDirection: "row", gap: 4 }}>
              <TouchableOpacity style={{ padding: 8 }} onPress={() => setShowSearch(true)}>
                <Ionicons name="search-outline" size={20} color={COLORS.muted} />
              </TouchableOpacity>
              <TouchableOpacity style={{ padding: 8 }} onPress={() => setShowNewChat(true)}>
                <Ionicons name="create-outline" size={22} color={COLORS.primary} />
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>

      {showNewChat ? (
        <NewChatModal onClose={() => setShowNewChat(false)} />
      ) : isLoading ? (
        <ActivityIndicator color={COLORS.primary} style={{ flex: 1 }} />
      ) : filtered.length === 0 && !searchText ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 40 }}>
          <Ionicons name="chatbubbles-outline" size={64} color={COLORS.border} />
          <Text style={{ fontSize: 20, color: COLORS.text, fontFamily: "Inter_600SemiBold", marginTop: 16 }}>No chats yet</Text>
          <Text style={{ fontSize: 14, color: COLORS.muted, textAlign: "center", marginTop: 8, fontFamily: "Inter_400Regular" }}>Tap the compose icon to start a new conversation</Text>
        </View>
      ) : filtered.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 40 }}>
          <Text style={{ fontSize: 20, color: COLORS.text, fontFamily: "Inter_600SemiBold" }}>No results</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => String(item.id)}
          renderItem={({ item }) => (
            <ConversationItem
              item={item}
              currentUserId={user?.id || ""}
              onPress={() => navigateToChat(item)}
              onDelete={() => handleDeleteConversation(item)}
            />
          )}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={COLORS.primary} />}
          contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}
