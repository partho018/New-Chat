import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Modal,
  Image,
  Pressable,
  Alert,
  ScrollView,
  Animated,
  Easing,
} from "react-native";
import { MediaViewer } from "@/components/MediaViewer";
import {
  enqueueMessage,
  getQueue,
  removeFromQueue,
  subscribeToAppState,
  checkIsOnline,
} from "@/lib/offline";
import { getScreenShareStream } from "@/lib/webrtc";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { io, Socket } from "socket.io-client";
import * as ImagePicker from "expo-image-picker";
import { Audio, Video, ResizeMode } from "expo-av";
import * as Clipboard from "expo-clipboard";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Dimensions } from "react-native";
import {
  getMessages,
  sendMessage,
  editMessage,
  deleteMessageForEveryone,
  toggleReaction,
  uploadFile,
  sendMediaMessage,
  sendVoiceMessage,
  Message,
  getToken,
  APP_BASE,
} from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { getNickname, setNickname, removeNickname } from "@/lib/nickname";
import { useThemeColors } from "@/lib/theme";
import { useNotifications } from "@/contexts/NotificationContext";
import { useCall } from "@/contexts/CallContext";
import { isWebRTCAvailable } from "@/lib/webrtc";

// Safely import RTCView (not available in Expo Go)
let RTCView: any = null;
try {
  RTCView = require("react-native-webrtc").RTCView;
} catch {}

let chatSocket: Socket | null = null;

const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏", "🔥", "👏"];
function formatMsgTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
}

function formatRecordTime(secs: number): string {
  const m = Math.floor(secs / 60).toString().padStart(2, "0");
  const s = (secs % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function formatDuration(secs: number): string {
  if (!secs || secs === 0) return "";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s > 0 ? `${s}s` : ""}`.trim();
}

function AvatarCircle({ name, url, size = 36 }: { name: string; url?: string | null; size?: number }) {
  const initials = name ? name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2) : "?";
  const colors = ["#10b981", "#3b82f6", "#8b5cf6", "#ef4444", "#f59e0b"];
  const colorIdx = name.charCodeAt(0) % colors.length;
  if (url) return <Image source={{ uri: url }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors[colorIdx], alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: "#fff", fontSize: size * 0.38, fontFamily: "Inter_600SemiBold" }}>{initials}</Text>
    </View>
  );
}

function VoicePlayer({ url, knownDuration = 0 }: { url: string; knownDuration?: number }) {
  const COLORS = useThemeColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const soundRef = useRef<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(knownDuration);

  useEffect(() => {
    return () => { soundRef.current?.unloadAsync().catch(() => {}); };
  }, []);

  const togglePlay = async () => {
    try {
      if (!soundRef.current) {
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
        const { sound } = await Audio.Sound.createAsync(
          { uri: url },
          { shouldPlay: true },
          (status) => {
            if (!status.isLoaded) return;
            const dur = (status.durationMillis || 0) / 1000;
            if (dur > 0) setTotalDuration(dur);
            const cur = (status.positionMillis || 0) / 1000;
            setCurrentTime(cur);
            setProgress(dur > 0 ? (cur / dur) * 100 : 0);
            if (status.didJustFinish) {
              setIsPlaying(false);
              setProgress(0);
              setCurrentTime(0);
              soundRef.current?.unloadAsync().catch(() => {});
              soundRef.current = null;
            }
          }
        );
        soundRef.current = sound;
        setIsPlaying(true);
      } else if (isPlaying) {
        await soundRef.current.pauseAsync();
        setIsPlaying(false);
      } else {
        await soundRef.current.playAsync();
        setIsPlaying(true);
      }
    } catch (e) { console.error("VoicePlayer error", e); }
  };

  const fmtTime = (s: number) => {
    if (!s || !isFinite(s)) return "0:00";
    return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}`;
  };

  return (
    <View style={styles.voicePlayer}>
      <TouchableOpacity onPress={togglePlay} style={styles.voicePlayBtn}>
        <Ionicons name={isPlaying ? "pause" : "play"} size={18} color={COLORS.primary} />
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <View style={styles.voiceTrack}>
          <View style={[styles.voiceProgress, { width: `${progress}%` }]} />
        </View>
        <Text style={styles.voiceTime}>{isPlaying ? fmtTime(currentTime) : fmtTime(totalDuration)}</Text>
      </View>
    </View>
  );
}

function MessageContent({ msg, isOwn, onMediaPress }: { msg: Message; isOwn: boolean; onMediaPress?: (url: string, type: "image" | "video") => void }) {
  const COLORS = useThemeColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  if (msg.isDeleted) {
    return (
      <Text style={[styles.bubbleText, { fontStyle: "italic", opacity: 0.6 }]}>
        🚫 {isOwn ? "You deleted this message" : "This message was deleted"}
      </Text>
    );
  }
  if (msg.messageType === "image" && msg.fileUrl) {
    return (
      <View>
        <TouchableOpacity activeOpacity={0.85} onPress={() => onMediaPress?.(msg.fileUrl!, "image")}>
          <Image source={{ uri: msg.fileUrl }} style={styles.msgImage} resizeMode="cover" />
          <View style={styles.mediaPlayOverlay}>
            <Ionicons name="expand-outline" size={22} color="#fff" />
          </View>
        </TouchableOpacity>
        {msg.content ? <Text style={[styles.bubbleText, { marginTop: 4 }]}>{msg.content}</Text> : null}
      </View>
    );
  }
  if (msg.messageType === "video" && msg.fileUrl) {
    return (
      <TouchableOpacity activeOpacity={0.85} onPress={() => onMediaPress?.(msg.fileUrl!, "video")} style={styles.videoPlaceholder}>
        <View style={styles.videoThumb}>
          <Ionicons name="play-circle" size={48} color="#fff" />
        </View>
        {msg.content ? <Text style={[styles.bubbleText, { marginTop: 4, textAlign: "center" }]}>{msg.content}</Text> : null}
      </TouchableOpacity>
    );
  }
  if (msg.messageType === "voice") {
    const audioUrl = msg.content?.startsWith("data:") ? msg.content : msg.fileUrl;
    if (audioUrl) return <VoicePlayer url={audioUrl} knownDuration={msg.duration ?? 0} />;
  }
  if (msg.messageType === "call") {
    let callType = "audio", status = "completed";
    try { const p = JSON.parse(msg.content || "{}"); callType = p.callType || "audio"; status = p.status || "completed"; } catch {}
    const isMissed = status === "missed";
    const label = isMissed ? (isOwn ? "No answer" : callType === "video" ? "Missed video call" : "Missed call")
      : isOwn ? (callType === "video" ? "Outgoing video call" : "Outgoing call")
      : (callType === "video" ? "Incoming video call" : "Incoming call");
    return (
      <View style={styles.callRow}>
        <View style={[styles.callIcon, { backgroundColor: isMissed ? "#ef444420" : "#10b98120" }]}>
          <Ionicons name={callType === "video" ? "videocam" : (isMissed ? "call" : "call")} size={16} color={isMissed ? COLORS.danger : COLORS.primary} />
        </View>
        <View>
          <Text style={[styles.bubbleText, { color: isMissed ? COLORS.danger : COLORS.text }]}>{label}</Text>
          {!isMissed && msg.duration ? <Text style={[styles.bubbleText, { fontSize: 11, opacity: 0.6 }]}>{formatDuration(msg.duration)}</Text> : null}
        </View>
      </View>
    );
  }
  return <Text style={styles.bubbleText}>{msg.content || ""}</Text>;
}

function MessageBubble({
  msg,
  isOwn,
  showSender,
  currentUserId,
  onLongPress,
  onMediaPress,
}: {
  msg: Message;
  isOwn: boolean;
  showSender: boolean;
  currentUserId: string;
  onLongPress: (msg: Message) => void;
  onMediaPress: (url: string, type: "image" | "video") => void;
}) {
  const COLORS = useThemeColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const groupedReactions = (msg.reactions || []).reduce<Record<string, number>>((acc, r) => {
    acc[r.emoji] = (acc[r.emoji] || 0) + 1;
    return acc;
  }, {});

  return (
    <View style={[styles.bubbleWrapper, isOwn ? styles.bubbleWrapperOwn : styles.bubbleWrapperOther]}>
      {!isOwn && showSender && (
        <Text style={styles.senderName}>{msg.sender?.displayName || msg.sender?.username || "?"}</Text>
      )}
      <Pressable
        onLongPress={() => onLongPress(msg)}
        delayLongPress={450}
        style={({ pressed }) => [
          styles.bubble,
          isOwn ? styles.bubbleOwn : styles.bubbleOther,
          pressed && { opacity: 0.85 },
        ]}
      >
        {msg.replyTo && !msg.isDeleted && (
          <View style={styles.replyBox}>
            <Text style={styles.replyName}>{msg.replyTo.sender?.displayName || msg.replyTo.sender?.username || "?"}</Text>
            <Text style={styles.replyContent} numberOfLines={1}>
              {msg.replyTo.isDeleted ? "Message was deleted"
                : msg.replyTo.messageType === "image" ? "📷 Photo"
                : msg.replyTo.messageType === "video" ? "🎥 Video"
                : msg.replyTo.messageType === "voice" ? "🎤 Voice"
                : msg.replyTo.content || ""}
            </Text>
          </View>
        )}
        <MessageContent msg={msg} isOwn={isOwn} onMediaPress={onMediaPress} />
        <View style={styles.bubbleMeta}>
          {msg.edited && !msg.isDeleted && <Text style={[styles.bubbleTime, { fontStyle: "italic", marginRight: 4 }]}>edited</Text>}
          <Text style={styles.bubbleTime}>{formatMsgTime(msg.createdAt)}</Text>
          {isOwn && !msg.isDeleted && (() => {
            const isSeen = msg.seenBy && msg.seenBy.filter((id: string) => id !== currentUserId).length > 0;
            const isDelivered = msg.deliveredTo && msg.deliveredTo.filter((id: string) => id !== currentUserId).length > 0;
            return (
              <Ionicons
                name={isSeen || isDelivered ? "checkmark-done" : "checkmark"}
                size={14}
                color={isSeen ? "#ffffff" : isDelivered ? "#9ca3af" : "#6b7280"}
                style={{ marginLeft: 3 }}
              />
            );
          })()}
        </View>
      </Pressable>
      {Object.keys(groupedReactions).length > 0 && (
        <View style={[styles.reactionsRow, isOwn ? styles.reactionsRowOwn : styles.reactionsRowOther]}>
          {Object.entries(groupedReactions).map(([emoji, count]) => (
            <View key={emoji} style={styles.reactionBadge}>
              <Text style={styles.reactionEmoji}>{emoji}</Text>
              {count > 1 && <Text style={styles.reactionCount}>{count}</Text>}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

export default function ChatScreen() {
  const { id, name, avatar, isOnline, otherId } = useLocalSearchParams<{ id: string; name: string; avatar?: string; isOnline?: string; otherId?: string }>();
  const conversationId = parseInt(id, 10);
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const COLORS = useThemeColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { vibrateMessage, scheduleLocalNotification } = useNotifications();
  const {
    globalCallState,
    incomingCallData,
    activeConversationId: callActiveConvId,
    activeCallType: callType,
    isMuted,
    isSpeaker,
    callTimer: callSeconds,
    answerCall: globalAnswerCall,
    endCall: globalEndCall,
    startCall: globalStartCall,
    toggleMute,
    toggleSpeaker,
    callSocket,
    localStream,
    remoteStream,
    isCallMinimized,
    minimizeCall,
    expandCall,
    replaceCallVideoTrack,
  } = useCall();

  const callState: null | "calling" | "incoming" | "connected" =
    callActiveConvId === conversationId || (globalCallState === "incoming" && incomingCallData?.conversationId === conversationId)
      ? (globalCallState as any) : null;
  const [nickname, setNicknameState] = useState<string | null>(null);
  const [showNicknameModal, setShowNicknameModal] = useState(false);
  const [nicknameInput, setNicknameInput] = useState("");

  useEffect(() => {
    if (!user?.id || !otherId) return;
    getNickname(user.id, otherId).then(n => setNicknameState(n)).catch(() => {});
  }, [user?.id, otherId]);

  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);

  const [inputText, setInputText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [localMessages, setLocalMessages] = useState<Message[]>([]);
  const [deletedForMe, setDeletedForMe] = useState<number[]>([]);
  const [fullscreenMedia, setFullscreenMedia] = useState<{ url: string; type: "image" | "video" } | null>(null);
  const handleMediaPress = useCallback((url: string, type: "image" | "video") => setFullscreenMedia({ url, type }), []);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Context menu state
  const [selectedMsg, setSelectedMsg] = useState<Message | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [showDeleteSub, setShowDeleteSub] = useState(false);

  // Reply / Edit
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [editingMsg, setEditingMsg] = useState<{ id: number; content: string } | null>(null);

  // Attach menu
  const [showAttach, setShowAttach] = useState(false);
  const [mediaPreview, setMediaPreview] = useState<{ uri: string; type: "image" | "video"; name: string } | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  // Voice recording
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordTimeRef = useRef(0);

  // Search state
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef<TextInput>(null);

  // Offline state
  const [isOffline, setIsOffline] = useState(false);
  const offlineCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Screen share state
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [showMoreCallMenu, setShowMoreCallMenu] = useState(false);
  const screenShareStreamRef = useRef<any>(null);

  // Camera state (local only)
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isFrontCamera, setIsFrontCamera] = useState(true);
  const [cameraFacing, setCameraFacing] = useState<"front" | "back">("front");
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const switchCamera = useCallback(() => {
    if (localStream) {
      localStream.getVideoTracks().forEach((track: any) => {
        if (track._switchCamera) track._switchCamera();
      });
      setIsFrontCamera(prev => !prev);
    }
  }, [localStream]);
  const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

  useEffect(() => {
    if (callState === "connected") {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.08, duration: 800, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        ])
      ).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }
  }, [callState]);

  const { data: fetchedMessages = [], isLoading } = useQuery({
    queryKey: ["/api/messages", conversationId],
    queryFn: () => getMessages(conversationId),
    staleTime: 10_000,
  });

  const prevFetchedIdsRef = useRef<string>("");
  useEffect(() => {
    const ids = fetchedMessages.map((m) => m.id).join(",");
    if (ids !== prevFetchedIdsRef.current) {
      prevFetchedIdsRef.current = ids;
      setLocalMessages(fetchedMessages);
    }
  });

  useEffect(() => {
    let mounted = true;
    async function connect() {
      const token = await getToken();
      if (!token || !mounted) return;
      chatSocket = io(APP_BASE, {
        path: "/api/socket.io",
        auth: { token },
        transports: ["websocket"],
      });
      chatSocket.emit("join-conversation", conversationId);

      chatSocket.on("new-message", (msg: Message) => {
        setLocalMessages((prev) => {
          if (prev.find((m) => m.id === msg.id)) return prev;
          return [msg, ...prev];
        });
        queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
        if (msg.senderId !== user?.id) {
          chatSocket?.emit("mark-seen", { conversationId, messageId: msg.id });
          // Skip notification for call record messages (they're handled separately)
          if (msg.messageType === "call") return;
          // Vibrate and show notification for incoming messages
          vibrateMessage();
          const senderName = msg.sender?.displayName || msg.sender?.username || "Someone";
          let body = "New message";
          if (msg.messageType === "text" && msg.content) {
            body = msg.content.length > 60 ? msg.content.substring(0, 60) + "…" : msg.content;
          } else if (msg.messageType === "image") body = "📷 Photo";
          else if (msg.messageType === "video") body = "🎥 Video";
          else if (msg.messageType === "voice") body = "🎤 Voice message";
          scheduleLocalNotification({
            title: `Private — ${senderName}`,
            body,
            data: { conversationId },
            isCall: false,
          });
        }
      });

      chatSocket.on("typing", ({ userId, isTyping: typing }: { userId: string; isTyping: boolean }) => {
        if (userId === user?.id) return;
        setTypingUsers((prev) =>
          typing ? [...new Set([...prev, userId])] : prev.filter((u) => u !== userId)
        );
      });

      chatSocket.on("message-seen", ({ messageId, seenBy }: { messageId: number; seenBy: string[] }) => {
        setLocalMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, seenBy } : m))
        );
      });

      chatSocket.on("message-delivered", ({ messageId, deliveredTo }: { messageId: number; deliveredTo: string[] }) => {
        setLocalMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, deliveredTo } : m))
        );
      });

      chatSocket.on("message-deleted", ({ messageId }: { messageId: number }) => {
        setLocalMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, isDeleted: true, content: null } : m))
        );
      });

      chatSocket.on("message-edited", ({ messageId, content }: { messageId: number; content: string }) => {
        setLocalMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, content, edited: true } : m))
        );
      });

      chatSocket.on("reaction-update", ({ messageId, reactions }: { messageId: number; reactions: { emoji: string; userId: string }[] }) => {
        setLocalMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, reactions } : m))
        );
      });


    }
    connect();
    return () => {
      mounted = false;
      chatSocket?.disconnect();
      chatSocket = null;
    };
  }, [conversationId]);

  // Mark all messages as seen whenever messages load/change
  const latestMsgIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (localMessages.length === 0) return;
    const latestId = Math.max(...localMessages.map(m => m.id));
    if (latestId === latestMsgIdRef.current) return;
    latestMsgIdRef.current = latestId;
    if (chatSocket?.connected) {
      chatSocket.emit("mark-seen", { conversationId, messageId: latestId });
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
    } else {
      // Retry after socket connects
      const timer = setTimeout(() => {
        if (chatSocket?.connected) {
          chatSocket.emit("mark-seen", { conversationId, messageId: latestId });
          queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
        }
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [localMessages, conversationId]);

  const visibleMessages = localMessages.filter(m => !deletedForMe.includes(m.id));
  const sorted = [...visibleMessages].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  // Must be defined BEFORE sortedDisplayed (which references it)
  const displayedMessages = useMemo(() => {
    const visible = localMessages.filter((m) => !deletedForMe.includes(m.id));
    if (!searchMode || !searchQuery.trim()) return visible;
    const q = searchQuery.toLowerCase();
    return visible.filter(
      (m) => m.content?.toLowerCase().includes(q) && m.messageType === "text"
    );
  }, [localMessages, deletedForMe, searchMode, searchQuery]);

  const sortedDisplayed = searchMode && searchQuery.trim()
    ? [...displayedMessages].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    : sorted;

  const handleTyping = useCallback((text: string) => {
    setInputText(text);
    if (!isTyping) {
      setIsTyping(true);
      chatSocket?.emit("typing-start", { conversationId });
    }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      setIsTyping(false);
      chatSocket?.emit("typing-stop", { conversationId });
    }, 2000);
  }, [isTyping, conversationId]);

  const handleSend = useCallback(async () => {
    // Edit mode
    if (editingMsg) {
      const trimmed = inputText.trim();
      if (!trimmed || trimmed === editingMsg.content) { cancelEdit(); return; }
      try {
        setIsSending(true);
        const updated = await editMessage(conversationId, editingMsg.id, trimmed);
        setLocalMessages(prev => prev.map(m => m.id === editingMsg.id ? { ...m, content: trimmed, edited: true } : m));
        cancelEdit();
      } catch (e) { console.error("Edit failed", e); }
      finally { setIsSending(false); }
      return;
    }

    // Media send
    if (mediaPreview) {
      try {
        setIsSending(true);
        setUploadProgress(10);
        const ext = mediaPreview.name.split(".").pop() || (mediaPreview.type === "image" ? "jpg" : "mp4");
        const mime = mediaPreview.type === "image" ? `image/${ext}` : `video/${ext}`;
        const uploaded = await uploadFile(mediaPreview.uri, mediaPreview.name, mime);
        setUploadProgress(90);
        const fileUrl = uploaded.url.startsWith("http") ? uploaded.url : `${APP_BASE}${uploaded.url}`;
        await sendMediaMessage(conversationId, fileUrl, uploaded.fileName, uploaded.fileSize, mediaPreview.type, inputText.trim() || undefined, replyingTo?.id);
        setUploadProgress(null);
        setMediaPreview(null);
        setInputText("");
        setReplyingTo(null);
      } catch (e) { console.error("Media send failed", e); setUploadProgress(null); }
      finally { setIsSending(false); }
      return;
    }

    // Text send
    const text = inputText.trim();
    if (!text || isSending) return;
    setInputText("");
    setIsSending(true);
    chatSocket?.emit("typing-stop", { conversationId });
    const repId = replyingTo?.id;
    setReplyingTo(null);
    try {
      if (isOffline) {
        // Queue message for later
        await enqueueMessage({
          id: `queued_${Date.now()}`,
          conversationId,
          content: text,
          replyToId: repId,
          timestamp: Date.now(),
        });
        Alert.alert(
          "Saved offline",
          "You're offline. Message will be sent when you reconnect.",
          [{ text: "OK" }]
        );
      } else {
        await sendMessage(conversationId, text, repId);
      }
    } catch (err) {
      console.error("Send error:", err);
      // Try queuing if send fails
      await enqueueMessage({
        id: `queued_${Date.now()}`,
        conversationId,
        content: text,
        replyToId: repId,
        timestamp: Date.now(),
      }).catch(() => {});
      setInputText(text);
    } finally { setIsSending(false); }
  }, [inputText, isSending, conversationId, editingMsg, mediaPreview, replyingTo, isOffline]);

  // Long press context menu
  const openMenu = (msg: Message) => {
    setSelectedMsg(msg);
    setShowDeleteSub(false);
    setShowMenu(true);
  };

  const closeMenu = () => { setShowMenu(false); setSelectedMsg(null); setShowDeleteSub(false); };

  const handleReply = () => {
    if (!selectedMsg) return;
    setReplyingTo(selectedMsg);
    setEditingMsg(null);
    closeMenu();
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const handleCopy = async () => {
    if (selectedMsg?.content) Clipboard.setStringAsync(selectedMsg.content).catch(() => {});
    closeMenu();
  };

  const handleEdit = () => {
    if (!selectedMsg?.content) return;
    setEditingMsg({ id: selectedMsg.id, content: selectedMsg.content });
    setInputText(selectedMsg.content);
    setReplyingTo(null);
    closeMenu();
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const cancelEdit = () => { setEditingMsg(null); setInputText(""); };

  // ─── Call handlers (delegate to global CallContext) ───
  const startCall = async (type: "audio" | "video") => {
    if (!otherId) { Alert.alert("Cannot call", "No target user."); return; }
    if (type === "video" && !cameraPermission?.granted) {
      const res = await requestCameraPermission();
      if (!res.granted) {
        Alert.alert("Camera Permission", "Camera access is needed for video calls.");
        return;
      }
    }
    setIsCameraOn(type === "video");
    setCameraFacing("front");
    globalStartCall(otherId, type, conversationId);
  };

  const answerCall = (accepted: boolean) => globalAnswerCall(accepted);

  const endCall = () => globalEndCall(incomingCallData?.callerId ?? otherId ?? undefined);

  const fmtCallTime = (s: number) => {
    const m = Math.floor(s / 60).toString().padStart(2, "0");
    const sec = (s % 60).toString().padStart(2, "0");
    return `${m}:${sec}`;
  };

  const handleDeleteForMe = () => {
    if (!selectedMsg) return;
    setDeletedForMe(prev => [...prev, selectedMsg.id]);
    closeMenu();
  };

  const handleDeleteForEveryone = async () => {
    if (!selectedMsg) return;
    closeMenu();
    try {
      await deleteMessageForEveryone(conversationId, selectedMsg.id);
    } catch (e) { console.error("Delete failed", e); Alert.alert("Error", "Could not delete message"); }
  };

  const handleReaction = async (emoji: string) => {
    if (!selectedMsg) return;
    closeMenu();
    try {
      await toggleReaction(conversationId, selectedMsg.id, emoji);
    } catch (e) { console.error("Reaction failed", e); }
  };

  // Image/video picker
  const pickImage = async () => {
    setShowAttach(false);
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") { Alert.alert("Permission needed", "Please allow media access"); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      const name = asset.fileName || `photo_${Date.now()}.jpg`;
      setMediaPreview({ uri: asset.uri, type: "image", name });
    }
  };

  const pickVideo = async () => {
    setShowAttach(false);
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") { Alert.alert("Permission needed", "Please allow media access"); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      const name = asset.fileName || `video_${Date.now()}.mp4`;
      setMediaPreview({ uri: asset.uri, type: "video", name });
    }
  };

  const takePhoto = async () => {
    setShowAttach(false);
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") { Alert.alert("Permission needed", "Please allow camera access"); return; }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      const name = asset.fileName || `photo_${Date.now()}.jpg`;
      setMediaPreview({ uri: asset.uri, type: "image", name });
    }
  };

  // Voice recording
  const startRecording = async () => {
    if (editingMsg) return;
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== "granted") { Alert.alert("Permission needed", "Please allow microphone access"); return; }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = recording;
      recordTimeRef.current = 0;
      setRecordingTime(0);
      setIsRecording(true);
      recordTimerRef.current = setInterval(() => {
        recordTimeRef.current += 1;
        setRecordingTime(recordTimeRef.current);
      }, 1000);
    } catch (e) { console.error("Recording start failed", e); }
  };

  const stopRecording = async () => {
    if (recordTimerRef.current) { clearInterval(recordTimerRef.current); recordTimerRef.current = null; }
    setIsRecording(false);
    const dur = recordTimeRef.current;
    setRecordingTime(0);
    if (!recordingRef.current) return;
    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;
      if (uri && dur >= 1) {
        setIsSending(true);
        try {
          const uploaded = await uploadFile(uri, `voice_${Date.now()}.m4a`, "audio/m4a");
          const fileUrl = uploaded.url.startsWith("http") ? uploaded.url : `${APP_BASE}${uploaded.url}`;
          await sendVoiceMessage(conversationId, fileUrl, dur);
        } catch (e) { console.error("Voice send failed", e); }
        finally { setIsSending(false); }
      }
    } catch (e) { console.error("Stop recording failed", e); recordingRef.current = null; }
  };

  const cancelRecording = async () => {
    if (recordTimerRef.current) { clearInterval(recordTimerRef.current); recordTimerRef.current = null; }
    setIsRecording(false);
    setRecordingTime(0);
    if (recordingRef.current) {
      try { await recordingRef.current.stopAndUnloadAsync(); } catch {}
      recordingRef.current = null;
    }
  };

  // Offline detection + retry queued messages
  useEffect(() => {
    let mounted = true;
    const checkConn = async () => {
      const online = await checkIsOnline(APP_BASE);
      if (!mounted) return;
      setIsOffline(!online);
      if (online) {
        const queue = await getQueue();
        const forThisChat = queue.filter((q) => q.conversationId === conversationId);
        for (const qm of forThisChat) {
          try {
            await sendMessage(conversationId, qm.content, qm.replyToId);
            await removeFromQueue(qm.id);
          } catch {}
        }
      }
    };
    checkConn();
    offlineCheckRef.current = setInterval(checkConn, 8000);
    const unsubAppState = subscribeToAppState(checkConn);
    return () => {
      mounted = false;
      if (offlineCheckRef.current) clearInterval(offlineCheckRef.current);
      unsubAppState();
    };
  }, [conversationId]);

  // Restore camera track in the peer connection after screen share stops
  const restoreCameraAfterScreenShare = useCallback(() => {
    if (localStream) {
      const camTrack = localStream.getVideoTracks()[0];
      if (camTrack) replaceCallVideoTrack(camTrack);
    }
    if (screenShareStreamRef.current) {
      screenShareStreamRef.current.getTracks().forEach((t: any) => t.stop());
      screenShareStreamRef.current = null;
    }
    setIsScreenSharing(false);
  }, [localStream, replaceCallVideoTrack]);

  // Screen share toggle
  const toggleScreenShare = async () => {
    if (!isWebRTCAvailable) {
      Alert.alert("Not supported", "Screen sharing is not available on this device.");
      return;
    }
    if (isScreenSharing) {
      restoreCameraAfterScreenShare();
      return;
    }
    try {
      const screenStream = await getScreenShareStream();
      screenShareStreamRef.current = screenStream;
      const videoTrack = screenStream.getVideoTracks()[0];
      replaceCallVideoTrack(videoTrack);
      setIsScreenSharing(true);
      // When system stops screen share (e.g. user dismisses), restore camera
      videoTrack.onended = () => restoreCameraAfterScreenShare();
    } catch (e: any) {
      Alert.alert("Screen Share Failed", e?.message || "Could not start screen sharing.");
    }
  };

  const isOwn = (msg: Message) => msg.senderId === user?.id;
  const hasContent = inputText.trim() || mediaPreview;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Offline Banner */}
      {isOffline && (
        <View style={{ backgroundColor: "#ef4444", paddingVertical: 4, alignItems: "center" }}>
          <Text style={{ color: "#fff", fontSize: 12, fontFamily: "Inter_500Medium" }}>
            📵 Offline — messages will be queued
          </Text>
        </View>
      )}

      {/* Header */}
      <View style={styles.header}>
        {searchMode ? (
          <>
            <TouchableOpacity style={styles.backBtn} onPress={() => { setSearchMode(false); setSearchQuery(""); }}>
              <Ionicons name="arrow-back" size={22} color="#ffffff" />
            </TouchableOpacity>
            <TextInput
              ref={searchRef}
              style={{
                flex: 1,
                color: "#fff",
                fontSize: 16,
                fontFamily: "Inter_400Regular",
                paddingVertical: 6,
                paddingHorizontal: 10,
                backgroundColor: "rgba(255,255,255,0.1)",
                borderRadius: 10,
                marginRight: 8,
              }}
              placeholder="Search messages..."
              placeholderTextColor="rgba(255,255,255,0.5)"
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoFocus
            />
            {searchQuery.length > 0 && (
              <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 12, fontFamily: "Inter_400Regular", marginRight: 8 }}>
                {displayedMessages.length} found
              </Text>
            )}
          </>
        ) : (
          <>
            <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
              <Ionicons name="arrow-back" size={22} color="#ffffff" />
            </TouchableOpacity>
            <View style={styles.headerInfo}>
              <Text style={styles.headerName} numberOfLines={1}>{nickname || name || "Chat"}</Text>
              {nickname && <Text style={[styles.typingIndicator, { color: "#60a5fa" }]}>{name}</Text>}
              {!nickname && typingUsers.length > 0 ? (
                <Text style={styles.typingIndicator}>typing...</Text>
              ) : !nickname && isOnline === "true" ? (
                <Text style={styles.onlineStatus}>online</Text>
              ) : null}
            </View>
            <TouchableOpacity style={styles.headerAction} onPress={() => { setSearchMode(true); setTimeout(() => searchRef.current?.focus(), 100); }}>
              <Ionicons name="search-outline" size={20} color={COLORS.muted} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.headerAction} onPress={() => startCall("audio")}>
              <Ionicons name="call-outline" size={22} color={COLORS.primary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.headerAction} onPress={() => startCall("video")}>
              <Ionicons name="videocam-outline" size={22} color={COLORS.primary} />
            </TouchableOpacity>
            {otherId ? (
              <TouchableOpacity style={styles.headerAction} onPress={() => {
                setNicknameInput(nickname || "");
                setShowNicknameModal(true);
              }}>
                <Ionicons name="ellipsis-vertical" size={20} color={COLORS.muted} />
              </TouchableOpacity>
            ) : null}
          </>
        )}
      </View>

      {/* Nickname Modal */}
      {showNicknameModal && (
        <Modal visible transparent animationType="fade">
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", padding: 24 }}>
            <View style={{ backgroundColor: "#111118", borderRadius: 20, padding: 24, borderWidth: 1, borderColor: "#1f1f2e" }}>
              <Text style={{ color: "#fff", fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 4 }}>Set Nickname</Text>
              <Text style={{ color: "#6b7280", fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 16 }}>
                Nicknames are only visible to you
              </Text>
              <TextInput
                style={{
                  backgroundColor: "#1a1a2e", borderRadius: 12, padding: 14,
                  fontSize: 16, color: "#fff", borderWidth: 1, borderColor: "#2d2d3f",
                  marginBottom: 16, fontFamily: "Inter_400Regular",
                }}
                value={nicknameInput}
                onChangeText={setNicknameInput}
                placeholder={`Nickname for ${name}`}
                placeholderTextColor="#4b5563"
                maxLength={50}
                autoFocus
              />
              <View style={{ flexDirection: "row", gap: 8 }}>
                {nickname && (
                  <TouchableOpacity
                    style={{ flex: 1, padding: 12, borderRadius: 12, backgroundColor: "#ef444420", borderWidth: 1, borderColor: "#ef444440", alignItems: "center" }}
                    onPress={async () => {
                      if (!user?.id || !otherId) return;
                      await removeNickname(user.id, otherId);
                      setNicknameState(null);
                      setShowNicknameModal(false);
                    }}
                  >
                    <Text style={{ color: "#ef4444", fontFamily: "Inter_600SemiBold" }}>Remove</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={{ flex: 1, padding: 12, borderRadius: 12, backgroundColor: "#2d2d3f", alignItems: "center" }}
                  onPress={() => setShowNicknameModal(false)}
                >
                  <Text style={{ color: "#9ca3af", fontFamily: "Inter_500Medium" }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ flex: 1, padding: 12, borderRadius: 12, backgroundColor: "#10b981", alignItems: "center" }}
                  onPress={async () => {
                    if (!user?.id || !otherId) return;
                    const trimmed = nicknameInput.trim();
                    if (trimmed) {
                      await setNickname(user.id, otherId, trimmed);
                      setNicknameState(trimmed);
                    } else {
                      await removeNickname(user.id, otherId);
                      setNicknameState(null);
                    }
                    setShowNicknameModal(false);
                  }}
                >
                  <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold" }}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "padding"}
        keyboardVerticalOffset={Platform.OS === "ios" ? insets.top + 56 : 0}
      >
        {isLoading ? (
          <ActivityIndicator color={COLORS.primary} style={{ flex: 1 }} />
        ) : (
          <FlatList
            ref={flatListRef}
            data={sortedDisplayed}
            keyExtractor={(item) => String(item.id)}
            inverted
            renderItem={({ item, index }) => {
              const own = isOwn(item);
              const prevMsg = sortedDisplayed[index + 1];
              const showSender = !own && prevMsg?.senderId !== item.senderId;
              return (
                <MessageBubble
                  msg={item}
                  isOwn={own}
                  showSender={showSender}
                  currentUserId={user?.id || ""}
                  onLongPress={openMenu}
                  onMediaPress={handleMediaPress}
                />
              );
            }}
            contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8 }}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.emptyChat}>
                <Text style={styles.emptyChatText}>Send the first message! 👋</Text>
              </View>
            }
          />
        )}

        {/* Input area */}
        <View style={[styles.inputArea, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          {/* Reply banner */}
          {replyingTo && !editingMsg && (
            <View style={styles.replyBanner}>
              <View style={styles.replyBannerContent}>
                <Ionicons name="return-down-back" size={14} color={COLORS.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.replyBannerName}>{replyingTo.sender?.displayName || replyingTo.sender?.username}</Text>
                  <Text style={styles.replyBannerText} numberOfLines={1}>
                    {replyingTo.messageType === "image" ? "📷 Photo"
                      : replyingTo.messageType === "video" ? "🎥 Video"
                      : replyingTo.messageType === "voice" ? "🎤 Voice"
                      : replyingTo.content || ""}
                  </Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setReplyingTo(null)}>
                <Ionicons name="close" size={18} color={COLORS.muted} />
              </TouchableOpacity>
            </View>
          )}

          {/* Edit banner */}
          {editingMsg && (
            <View style={[styles.replyBanner, { borderLeftColor: "#f59e0b" }]}>
              <View style={styles.replyBannerContent}>
                <Ionicons name="create-outline" size={14} color="#f59e0b" />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.replyBannerName, { color: "#f59e0b" }]}>Editing</Text>
                  <Text style={styles.replyBannerText} numberOfLines={1}>{editingMsg.content}</Text>
                </View>
              </View>
              <TouchableOpacity onPress={cancelEdit}>
                <Ionicons name="close" size={18} color={COLORS.muted} />
              </TouchableOpacity>
            </View>
          )}

          {/* Attach menu */}
          {showAttach && (
            <View style={styles.attachMenu}>
              <TouchableOpacity style={styles.attachBtn} onPress={pickImage}>
                <Ionicons name="image" size={20} color={COLORS.primary} />
                <Text style={styles.attachLabel}>Photo</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.attachBtn} onPress={pickVideo}>
                <Ionicons name="videocam" size={20} color="#3b82f6" />
                <Text style={[styles.attachLabel, { color: "#3b82f6" }]}>Video</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.attachBtn} onPress={takePhoto}>
                <Ionicons name="camera" size={20} color="#8b5cf6" />
                <Text style={[styles.attachLabel, { color: "#8b5cf6" }]}>Camera</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Media preview */}
          {mediaPreview && (
            <View style={styles.mediaPreviewBox}>
              {mediaPreview.type === "image" ? (
                <Image source={{ uri: mediaPreview.uri }} style={styles.mediaPreviewImg} />
              ) : (
                <View style={[styles.mediaPreviewImg, { backgroundColor: "#0a0a0f", alignItems: "center", justifyContent: "center" }]}>
                  <Ionicons name="videocam" size={40} color={COLORS.primary} />
                  <Text style={{ color: COLORS.muted, fontSize: 12, marginTop: 4 }}>Video selected</Text>
                </View>
              )}
              {uploadProgress !== null && (
                <View style={styles.uploadBar}>
                  <View style={[styles.uploadFill, { width: `${uploadProgress}%` as any }]} />
                </View>
              )}
              {!isSending && (
                <TouchableOpacity style={styles.mediaCancelBtn} onPress={() => setMediaPreview(null)}>
                  <Ionicons name="close" size={16} color="#fff" />
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Recording UI */}
          {isRecording ? (
            <View style={styles.recordingBar}>
              <View style={styles.recDot} />
              <Text style={styles.recTime}>{formatRecordTime(recordingTime)}</Text>
              <Text style={styles.recLabel}>Recording... slide to cancel</Text>
              <TouchableOpacity onPress={cancelRecording} style={{ marginLeft: 4 }}>
                <Ionicons name="trash-outline" size={20} color={COLORS.danger} />
              </TouchableOpacity>
              <TouchableOpacity onPress={stopRecording} style={styles.recStopBtn}>
                <Ionicons name="stop" size={18} color="#fff" />
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.inputRow}>
              {!editingMsg && (
                <TouchableOpacity
                  style={styles.inputAction}
                  onPress={() => setShowAttach(!showAttach)}
                >
                  <Ionicons name="attach" size={22} color={COLORS.muted} />
                </TouchableOpacity>
              )}
              <TextInput
                ref={inputRef}
                style={styles.textInput}
                placeholder={editingMsg ? "Edit message..." : "Message"}
                placeholderTextColor="#4b5563"
                value={inputText}
                onChangeText={handleTyping}
                multiline
                maxLength={4000}
              />
              {!hasContent && !editingMsg ? (
                <TouchableOpacity
                  style={styles.micBtn}
                  onLongPress={startRecording}
                  delayLongPress={200}
                >
                  <Ionicons name="mic" size={20} color={COLORS.muted} />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.sendBtn, ((!hasContent && !editingMsg) || isSending) && styles.sendBtnDisabled]}
                  onPress={handleSend}
                  disabled={(!hasContent && !editingMsg) || isSending}
                >
                  {isSending ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : editingMsg ? (
                    <Ionicons name="checkmark" size={18} color="#fff" />
                  ) : (
                    <Ionicons name="send" size={18} color="#fff" />
                  )}
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      </KeyboardAvoidingView>

      {/* ── Smooth Fullscreen Media Viewer (pinch-to-zoom) ── */}
      {fullscreenMedia && (
        <MediaViewer
          visible={fullscreenMedia !== null}
          url={fullscreenMedia.url}
          type={fullscreenMedia.type}
          onClose={() => setFullscreenMedia(null)}
        />
      )}

      <Modal visible={showMenu} transparent animationType="fade" onRequestClose={closeMenu}>
        <Pressable style={styles.menuOverlay} onPress={closeMenu}>
          <Pressable style={styles.menuContainer} onPress={e => e.stopPropagation()}>
            {/* Reactions */}
            <View style={styles.reactionsBar}>
              {REACTION_EMOJIS.map(emoji => {
                const myReaction = selectedMsg?.reactions?.find(r => r.userId === user?.id)?.emoji;
                return (
                  <TouchableOpacity
                    key={emoji}
                    onPress={() => handleReaction(emoji)}
                    style={[styles.reactionEmojiBtn, myReaction === emoji && styles.reactionEmojiActive]}
                  >
                    <Text style={{ fontSize: 22 }}>{emoji}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {!showDeleteSub ? (
              <View style={styles.menuCard}>
                <TouchableOpacity style={styles.menuItem} onPress={handleReply}>
                  <Ionicons name="return-down-back" size={20} color={COLORS.muted} />
                  <Text style={styles.menuItemText}>Reply</Text>
                </TouchableOpacity>
                {selectedMsg?.messageType === "text" && selectedMsg?.content && (
                  <TouchableOpacity style={[styles.menuItem, styles.menuItemBorder]} onPress={handleCopy}>
                    <Ionicons name="copy-outline" size={20} color={COLORS.muted} />
                    <Text style={styles.menuItemText}>Copy</Text>
                  </TouchableOpacity>
                )}
                {selectedMsg && isOwn(selectedMsg) && selectedMsg.messageType === "text" && !selectedMsg.isDeleted && (
                  <TouchableOpacity style={[styles.menuItem, styles.menuItemBorder]} onPress={handleEdit}>
                    <Ionicons name="create-outline" size={20} color={COLORS.muted} />
                    <Text style={styles.menuItemText}>Edit</Text>
                  </TouchableOpacity>
                )}
                {selectedMsg && isOwn(selectedMsg) && !selectedMsg.isDeleted && (
                  <TouchableOpacity style={[styles.menuItem, styles.menuItemBorder, styles.menuItemDanger]} onPress={() => setShowDeleteSub(true)}>
                    <Ionicons name="trash-outline" size={20} color={COLORS.danger} />
                    <Text style={[styles.menuItemText, { color: COLORS.danger }]}>Delete</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              <View style={styles.menuCard}>
                <View style={styles.menuSubHeader}>
                  <Text style={styles.menuSubTitle}>Delete message</Text>
                </View>
                <TouchableOpacity style={styles.menuItem} onPress={handleDeleteForMe}>
                  <Ionicons name="person-outline" size={20} color={COLORS.muted} />
                  <View>
                    <Text style={styles.menuItemText}>Delete for me</Text>
                    <Text style={styles.menuItemSub}>Only you won't see this</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.menuItem, styles.menuItemBorder, styles.menuItemDanger]} onPress={handleDeleteForEveryone}>
                  <Ionicons name="trash" size={20} color={COLORS.danger} />
                  <View>
                    <Text style={[styles.menuItemText, { color: COLORS.danger }]}>Delete for everyone</Text>
                    <Text style={[styles.menuItemSub, { color: COLORS.danger, opacity: 0.7 }]}>Removed for all members</Text>
                  </View>
                </TouchableOpacity>
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* ─── Full-Screen Call Modal (WhatsApp style) ─── */}
      <Modal visible={(callState === "calling" || callState === "connected") && !isCallMinimized} transparent={false} animationType="slide" statusBarTranslucent>
        <View style={{ flex: 1, backgroundColor: "#0d1117" }}>

          {/* ── Layer 0: Video background (absolute) ── */}
          {callType === "video" && remoteStream && RTCView ? (
            /* Connected: remote video full screen */
            <RTCView
              streamURL={remoteStream.toURL()}
              style={StyleSheet.absoluteFillObject}
              objectFit="cover"
              mirror={false}
              zOrder={0}
            />
          ) : callType === "video" && localStream && RTCView && callState === "calling" ? (
            /* Calling (ringing): own camera full screen preview */
            <RTCView
              streamURL={localStream.toURL()}
              style={StyleSheet.absoluteFillObject}
              objectFit="cover"
              mirror={isFrontCamera}
              zOrder={0}
            />
          ) : (
            /* Audio call or no stream: decorative background */
            <View style={callStyles.bg}>
              {[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24].map(i => (
                <Ionicons
                  key={i}
                  name={["chatbubble-outline","heart-outline","star-outline","gift-outline","bicycle-outline","camera-outline","musical-note-outline","flower-outline","leaf-outline","moon-outline"][i % 10] as any}
                  size={32}
                  color="rgba(255,255,255,0.045)"
                  style={{ position: "absolute", left: (i % 5) * 76 + 12, top: Math.floor(i / 5) * 120 + 80 }}
                />
              ))}
            </View>
          )}

          {/* ── Layer 1: UI overlay (flex column, always above video) ── */}
          <View style={{ ...StyleSheet.absoluteFillObject, flexDirection: "column", zIndex: 10, elevation: 10 }}>

            {/* Local video PiP — bottom-right, only when connected */}
            {callType === "video" && localStream && RTCView && callState === "connected" && (
              <View style={callStyles.localVideoPip}>
                {isCameraOn ? (
                  <RTCView
                    streamURL={localStream.toURL()}
                    style={{ flex: 1, borderRadius: 14 }}
                    objectFit="cover"
                    mirror={isFrontCamera}
                    zOrder={2}
                  />
                ) : (
                  /* Camera is off — show placeholder instead of black frame */
                  <View style={{ flex: 1, borderRadius: 14, backgroundColor: "#1a1a2e", alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="videocam-off-outline" size={22} color="rgba(255,255,255,0.5)" />
                    <Text style={{ color: "rgba(255,255,255,0.4)", fontSize: 10, marginTop: 4, fontFamily: "Inter_400Regular" }}>Cam off</Text>
                  </View>
                )}
              </View>
            )}

            {/* ── Top bar — other person's name ── */}
            <View style={callStyles.topBar}>
              {/* Minimize button */}
              <TouchableOpacity style={callStyles.topIconBtn} onPress={minimizeCall}>
                <Ionicons name="chevron-down" size={26} color="#fff" />
              </TouchableOpacity>
              <View style={{ flex: 1, alignItems: "center" }}>
                <Text style={callStyles.topName} numberOfLines={1}>
                  {nickname || name || incomingCallData?.callerName || "Calling..."}
                </Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
                  <Ionicons name="lock-closed" size={11} color="#25d366" />
                  <Text style={callStyles.topEncrypt}>End-to-end encrypted</Text>
                </View>
              </View>
              {/* Expand (no-op placeholder for symmetry) */}
              <View style={{ width: 42 }} />
            </View>

            {/* ── Center: avatar when no remote video, status text ── */}
            <View style={callStyles.centerArea}>
              {(callType === "audio" || (!remoteStream && !(callState === "calling" && callType === "video" && localStream && RTCView)) || !RTCView || !isWebRTCAvailable) && (
                <Animated.View style={[callStyles.avatarOuterRing, { transform: [{ scale: pulseAnim }] }]}>
                  <View style={callStyles.avatarMidRing}>
                    {avatar ? (
                      <Image
                        source={{ uri: decodeURIComponent(avatar) }}
                        style={{ width: 130, height: 130, borderRadius: 65 }}
                      />
                    ) : (
                      <View style={callStyles.avatarCircle}>
                        <Text style={callStyles.avatarLetter}>
                          {(nickname || name || incomingCallData?.callerName || "?")?.[0]?.toUpperCase()}
                        </Text>
                      </View>
                    )}
                  </View>
                </Animated.View>
              )}
              <Text style={callStyles.callStatusTxt}>
                {callState === "calling" ? "Ringing..." : fmtCallTime(callSeconds)}
              </Text>
              {callState === "connected" && callType === "video" && (!remoteStream || !RTCView) && (
                <Text style={{ color: "rgba(255,255,255,0.5)", fontSize: 13, marginTop: 8, fontFamily: "Inter_400Regular" }}>
                  {!isWebRTCAvailable ? "Video needs development build" : "Waiting for remote video..."}
                </Text>
              )}
            </View>

            {/* ── More menu popup (Screen Share + Camera Switch) ── */}
            {showMoreCallMenu && (
              <Pressable
                style={{ ...StyleSheet.absoluteFillObject, zIndex: 20 }}
                onPress={() => setShowMoreCallMenu(false)}
              >
                <View style={callStyles.moreMenu}>
                  {/* Screen Share */}
                  <TouchableOpacity
                    style={callStyles.moreMenuItem}
                    onPress={() => { setShowMoreCallMenu(false); toggleScreenShare(); }}
                  >
                    <View style={[callStyles.moreMenuIcon, isScreenSharing && { backgroundColor: "#10b981" }]}>
                      <Ionicons name="tv-outline" size={22} color="#fff" />
                    </View>
                    <Text style={callStyles.moreMenuLabel}>
                      {isScreenSharing ? "Stop Screen Share" : "Screen Share"}
                    </Text>
                    {isScreenSharing && (
                      <View style={{ backgroundColor: "#10b981", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }}>
                        <Text style={{ color: "#fff", fontSize: 11, fontFamily: "Inter_500Medium" }}>ON</Text>
                      </View>
                    )}
                  </TouchableOpacity>

                  {/* Switch Camera (video calls only) */}
                  {callType === "video" && (
                    <TouchableOpacity
                      style={callStyles.moreMenuItem}
                      onPress={() => { setShowMoreCallMenu(false); switchCamera(); }}
                    >
                      <View style={callStyles.moreMenuIcon}>
                        <Ionicons name="camera-reverse-outline" size={22} color="#fff" />
                      </View>
                      <Text style={callStyles.moreMenuLabel}>
                        {isFrontCamera ? "Back Camera" : "Front Camera"}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </Pressable>
            )}

            {/* ── Bottom controls (4 main + end call) ── */}
            <View style={callStyles.controlBar}>

              {/* Mute */}
              <View style={callStyles.ctrlItem}>
                <TouchableOpacity
                  style={[callStyles.ctrlCircle, isMuted && callStyles.ctrlMuted]}
                  onPress={toggleMute}
                >
                  <Ionicons name={isMuted ? "mic-off" : "mic-outline"} size={24} color="#fff" />
                </TouchableOpacity>
                <Text style={callStyles.ctrlLbl}>{isMuted ? "Unmute" : "Mute"}</Text>
              </View>

              {/* Video toggle */}
              <View style={callStyles.ctrlItem}>
                <TouchableOpacity
                  style={[callStyles.ctrlCircle, isCameraOn && callType === "video" && callStyles.ctrlActive]}
                  onPress={() => {
                    if (callType === "video" && localStream) {
                      const next = !isCameraOn;
                      setIsCameraOn(next);
                      localStream.getVideoTracks().forEach((t: any) => { t.enabled = next; });
                    }
                  }}
                >
                  <Ionicons
                    name={isCameraOn && callType === "video" ? "videocam" : "videocam-off-outline"}
                    size={24}
                    color={isCameraOn && callType === "video" ? "#000" : "#fff"}
                  />
                </TouchableOpacity>
                <Text style={callStyles.ctrlLbl}>
                  {isCameraOn && callType === "video" ? "Camera" : "Camera off"}
                </Text>
              </View>

              {/* End Call — center, bigger */}
              <View style={callStyles.ctrlItem}>
                <TouchableOpacity style={callStyles.endCircle} onPress={endCall}>
                  <Ionicons name="call" size={30} color="#fff" style={{ transform: [{ rotate: "135deg" }] }} />
                </TouchableOpacity>
                <Text style={[callStyles.ctrlLbl, { opacity: 0 }]}>·</Text>
              </View>

              {/* Speaker */}
              <View style={callStyles.ctrlItem}>
                <TouchableOpacity
                  style={[callStyles.ctrlCircle, isSpeaker && callStyles.ctrlActive]}
                  onPress={toggleSpeaker}
                >
                  <Ionicons name={isSpeaker ? "volume-high" : "volume-medium-outline"} size={24} color={isSpeaker ? "#000" : "#fff"} />
                </TouchableOpacity>
                <Text style={callStyles.ctrlLbl}>{isSpeaker ? "Speaker" : "Earpiece"}</Text>
              </View>

              {/* More Options — opens menu with Screen Share & Camera Switch */}
              <View style={callStyles.ctrlItem}>
                <TouchableOpacity
                  style={callStyles.ctrlCircle}
                  onPress={() => setShowMoreCallMenu(v => !v)}
                >
                  <Ionicons name="ellipsis-horizontal" size={24} color="#fff" />
                </TouchableOpacity>
                <Text style={callStyles.ctrlLbl}>More</Text>
              </View>

            </View>

          </View>{/* end overlay */}
        </View>
      </Modal>
    </View>
  );
}

function makeStyles(COLORS: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
    backgroundColor: COLORS.bg,
  },
  backBtn: { padding: 6, marginRight: 8 },
  headerInfo: { flex: 1 },
  headerName: { fontSize: 16, color: COLORS.text, fontFamily: "Inter_600SemiBold" },
  typingIndicator: { fontSize: 12, color: COLORS.primary, fontFamily: "Inter_400Regular" },
  onlineStatus: { fontSize: 12, color: COLORS.primary, fontFamily: "Inter_400Regular" },
  headerAction: { padding: 8, marginLeft: 4 },
  bubbleWrapper: { marginVertical: 2, maxWidth: "80%" },
  bubbleWrapperOwn: { alignSelf: "flex-end", alignItems: "flex-end" },
  bubbleWrapperOther: { alignSelf: "flex-start", alignItems: "flex-start" },
  senderName: { fontSize: 12, color: COLORS.primary, marginBottom: 2, marginLeft: 4, fontFamily: "Inter_500Medium" },
  bubble: { borderRadius: 18, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 },
  bubbleOwn: { backgroundColor: COLORS.primary, borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: COLORS.other, borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 15, color: COLORS.text, fontFamily: "Inter_400Regular", lineHeight: 21 },
  bubbleMeta: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", marginTop: 3 },
  bubbleTime: { fontSize: 11, color: "#ffffff70", fontFamily: "Inter_400Regular" },
  replyBox: {
    backgroundColor: "#ffffff15", borderRadius: 8, borderLeftWidth: 2.5,
    borderLeftColor: "#ffffff50", padding: 8, marginBottom: 6,
  },
  replyName: { fontSize: 12, color: "#ffffffcc", fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  replyContent: { fontSize: 12, color: "#ffffffaa", fontFamily: "Inter_400Regular" },
  reactionsRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 2 },
  reactionsRowOwn: { justifyContent: "flex-end" },
  reactionsRowOther: { justifyContent: "flex-start" },
  reactionBadge: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: COLORS.card, borderRadius: 12,
    paddingHorizontal: 6, paddingVertical: 2,
    borderWidth: 1, borderColor: COLORS.border,
  },
  reactionEmoji: { fontSize: 14 },
  reactionCount: { fontSize: 11, color: COLORS.muted, marginLeft: 2, fontFamily: "Inter_400Regular" },
  msgImage: { width: 200, height: 160, borderRadius: 10 },
  mediaPlayOverlay: { position: "absolute", bottom: 6, right: 6, backgroundColor: "#00000060", borderRadius: 12, padding: 4 },
  videoPlaceholder: { width: 200, height: 160, backgroundColor: "#111", borderRadius: 10, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  videoThumb: { flex: 1, width: "100%", alignItems: "center", justifyContent: "center", backgroundColor: "#1a1a2e" },
  videoLabel: { fontSize: 12, color: COLORS.muted, marginTop: 4, fontFamily: "Inter_400Regular" },
  callRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
  callIcon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  voicePlayer: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4, width: 200 },
  voicePlayBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#ffffff20", alignItems: "center", justifyContent: "center" },
  voiceTrack: { flex: 1, height: 4, backgroundColor: "#ffffff30", borderRadius: 2, overflow: "hidden" },
  voiceProgress: { height: "100%", backgroundColor: "#fff" },
  voiceTime: { fontSize: 10, color: "#ffffff80", marginTop: 3, fontFamily: "Inter_400Regular" },
  emptyChat: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
  emptyChatText: { color: COLORS.muted, fontFamily: "Inter_400Regular", fontSize: 15 },
  inputArea: {
    borderTopWidth: 1, borderTopColor: COLORS.border,
    backgroundColor: COLORS.bg, paddingTop: 8, paddingHorizontal: 8,
  },
  replyBanner: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: COLORS.card, borderRadius: 10,
    borderLeftWidth: 3, borderLeftColor: COLORS.primary,
    paddingHorizontal: 12, paddingVertical: 8, marginBottom: 6,
  },
  replyBannerContent: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, marginRight: 8 },
  replyBannerName: { fontSize: 12, color: COLORS.primary, fontFamily: "Inter_600SemiBold" },
  replyBannerText: { fontSize: 12, color: COLORS.muted, fontFamily: "Inter_400Regular" },
  attachMenu: { flexDirection: "row", gap: 8, marginBottom: 8 },
  attachBtn: { alignItems: "center", backgroundColor: COLORS.card, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14, gap: 4 },
  attachLabel: { fontSize: 11, color: COLORS.primary, fontFamily: "Inter_500Medium" },
  mediaPreviewBox: { position: "relative", marginBottom: 8, alignSelf: "flex-start" },
  mediaPreviewImg: { width: 120, height: 100, borderRadius: 10 },
  mediaCancelBtn: {
    position: "absolute", top: 4, right: 4,
    backgroundColor: "#00000090", borderRadius: 12,
    width: 22, height: 22, alignItems: "center", justifyContent: "center",
  },
  uploadBar: { height: 3, backgroundColor: "#ffffff20", borderRadius: 2, marginTop: 4, overflow: "hidden" },
  uploadFill: { height: "100%", backgroundColor: COLORS.primary },
  recordingBar: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#ef444415", borderRadius: 24,
    borderWidth: 1, borderColor: "#ef444430",
    paddingHorizontal: 14, paddingVertical: 10,
  },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.danger },
  recTime: { fontSize: 14, color: COLORS.danger, fontFamily: "Inter_600SemiBold", fontVariant: ["tabular-nums"] },
  recLabel: { flex: 1, fontSize: 12, color: COLORS.muted, fontFamily: "Inter_400Regular" },
  recStopBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.danger, alignItems: "center", justifyContent: "center" },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: 6 },
  inputAction: { padding: 10 },
  textInput: {
    flex: 1, backgroundColor: COLORS.card, borderRadius: 24,
    paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 15, color: COLORS.text, maxHeight: 120,
    fontFamily: "Inter_400Regular", borderWidth: 1, borderColor: COLORS.border,
  },
  micBtn: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: "center", justifyContent: "center",
    backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: COLORS.primary, alignItems: "center", justifyContent: "center",
  },
  sendBtnDisabled: { backgroundColor: COLORS.primary + "60" },
  menuOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.65)",
    alignItems: "center", justifyContent: "flex-end", paddingBottom: 80,
  },
  menuContainer: { width: "90%", gap: 8 },
  reactionsBar: {
    flexDirection: "row", justifyContent: "space-around",
    backgroundColor: COLORS.card, borderRadius: 30,
    paddingVertical: 8, paddingHorizontal: 4,
    borderWidth: 1, borderColor: COLORS.border,
  },
  reactionEmojiBtn: { padding: 6, borderRadius: 20 },
  reactionEmojiActive: { backgroundColor: `${COLORS.primary}40` },
  menuCard: { backgroundColor: COLORS.card, borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: COLORS.border },
  menuSubHeader: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  menuSubTitle: { fontSize: 12, color: COLORS.muted, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.5 },
  menuItem: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, paddingVertical: 14 },
  menuItemBorder: { borderTopWidth: 1, borderTopColor: COLORS.border },
  menuItemDanger: {},
  menuItemText: { fontSize: 15, color: COLORS.text, fontFamily: "Inter_500Medium" },
  menuItemSub: { fontSize: 12, color: COLORS.muted, fontFamily: "Inter_400Regular", marginTop: 1 },
  });
}

const callStyles = StyleSheet.create({
  bg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#0d1117",
    overflow: "hidden",
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 52,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  topIconBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center", justifyContent: "center",
  },
  topName: {
    fontSize: 18, color: "#ffffff", fontFamily: "Inter_600SemiBold",
    textAlign: "center",
  },
  topEncrypt: {
    fontSize: 12, color: "#25d366", fontFamily: "Inter_400Regular",
  },
  rightSideBtns: {
    position: "absolute",
    right: 16,
    top: 160,
    gap: 12,
  },
  sideRoundBtn: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center", justifyContent: "center",
  },
  centerArea: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: 20,
  },
  avatarOuterRing: {
    width: 170, height: 170, borderRadius: 85,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center", justifyContent: "center",
    marginBottom: 20,
  },
  avatarMidRing: {
    width: 150, height: 150, borderRadius: 75,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center", justifyContent: "center",
  },
  avatarCircle: {
    width: 130, height: 130, borderRadius: 65,
    backgroundColor: "#10b981",
    alignItems: "center", justifyContent: "center",
  },
  avatarLetter: {
    fontSize: 56, color: "#fff", fontFamily: "Inter_700Bold",
  },
  callStatusTxt: {
    fontSize: 15, color: "rgba(255,255,255,0.75)", fontFamily: "Inter_400Regular",
  },
  incomingBar: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    paddingBottom: 52,
    paddingTop: 20,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  incomingBtnLabel: {
    fontSize: 13, color: "#fff", fontFamily: "Inter_500Medium",
  },
  declineCircle: {
    width: 68, height: 68, borderRadius: 34,
    backgroundColor: "#ef4444",
    alignItems: "center", justifyContent: "center",
    elevation: 4,
  },
  acceptCircle: {
    width: 68, height: 68, borderRadius: 34,
    backgroundColor: "#25d366",
    alignItems: "center", justifyContent: "center",
    elevation: 4,
  },
  controlBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: 44,
    backgroundColor: "rgba(15,15,20,0.88)",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  ctrlCircle: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center", justifyContent: "center",
  },
  ctrlActive: {
    backgroundColor: "#ffffff",
  },
  ctrlMuted: {
    backgroundColor: "rgba(239,68,68,0.35)",
  },
  endCircle: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: "#ef4444",
    alignItems: "center", justifyContent: "center",
    elevation: 6,
  },
  ctrlLbl: {
    fontSize: 11, color: "rgba(255,255,255,0.7)", fontFamily: "Inter_400Regular",
  },
  localVideoPip: {
    position: "absolute",
    bottom: 170,
    right: 16,
    width: 110,
    height: 160,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.4)",
    zIndex: 10,
    elevation: 10,
    backgroundColor: "#1a1a2e",
  },
  ctrlItem: {
    alignItems: "center",
    gap: 6,
    minWidth: 60,
  },
  moreMenu: {
    position: "absolute",
    bottom: 130,
    left: 16,
    right: 16,
    backgroundColor: "#1e2530",
    borderRadius: 16,
    paddingVertical: 8,
    elevation: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
  },
  moreMenuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 16,
  },
  moreMenuIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  moreMenuLabel: {
    flex: 1,
    fontSize: 15,
    color: "#fff",
    fontFamily: "Inter_500Medium",
  },
});
