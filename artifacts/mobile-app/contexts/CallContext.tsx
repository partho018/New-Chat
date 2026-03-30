import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  Animated,
  Vibration,
  Image,
  StyleSheet,
  Dimensions,
  Platform,
  PanResponder,
} from "react-native";
import { io, Socket } from "socket.io-client";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getToken, APP_BASE } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useNotifications } from "@/contexts/NotificationContext";
import {
  isWebRTCAvailable,
  getLocalStream,
  createCallerSession,
  createCalleeSession,
  addIceCandidate,
  applyAnswer,
  stopStream,
  closePeerConnection,
  replaceTrackInPeerConnection,
} from "@/lib/webrtc";

// Safely import InCallManager (only available in native builds, not Expo Go)
let InCallManager: any = null;
try {
  InCallManager = require("react-native-incall-manager").default;
} catch {
  // Expo Go or not linked yet
}

// Safely import RTCView
let RTCView: any = null;
try {
  RTCView = require("react-native-webrtc").RTCView;
} catch {
  // not available in Expo Go
}

const { width: SW, height: SH } = Dimensions.get("window");

export interface IncomingCallData {
  callerId: string;
  callerName: string;
  callerAvatar?: string;
  peerId: string;
  callType: "audio" | "video";
  conversationId?: number;
}

export type GlobalCallState = "idle" | "incoming" | "calling" | "connected";

interface CallContextValue {
  globalCallState: GlobalCallState;
  incomingCallData: IncomingCallData | null;
  activeConversationId: number | null;
  activeCallType: "audio" | "video";
  callSocket: React.MutableRefObject<Socket | null>;
  isMuted: boolean;
  isSpeaker: boolean;
  callTimer: number;
  localStream: any;
  remoteStream: any;
  isCallMinimized: boolean;
  setGlobalCallState: (s: GlobalCallState) => void;
  setActiveConversationId: (id: number | null) => void;
  setActiveCallType: (t: "audio" | "video") => void;
  answerCall: (accepted: boolean) => void;
  endCall: (targetUserId?: string) => void;
  startCall: (targetUserId: string, callType: "audio" | "video", conversationId: number, conversationName?: string) => void;
  toggleMute: () => void;
  toggleSpeaker: () => void;
  minimizeCall: () => void;
  expandCall: () => void;
  replaceCallVideoTrack: (track: any) => void;
}

const CallContext = createContext<CallContextValue>({
  globalCallState: "idle",
  incomingCallData: null,
  activeConversationId: null,
  activeCallType: "audio",
  callSocket: { current: null },
  isMuted: false,
  isSpeaker: false,
  callTimer: 0,
  localStream: null,
  remoteStream: null,
  isCallMinimized: false,
  setGlobalCallState: () => {},
  setActiveConversationId: () => {},
  setActiveCallType: () => {},
  answerCall: () => {},
  endCall: () => {},
  startCall: () => {},
  toggleMute: () => {},
  toggleSpeaker: () => {},
  minimizeCall: () => {},
  expandCall: () => {},
  replaceCallVideoTrack: () => {},
});

export function CallProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { playRingtone, stopRingtone, vibrateCall, scheduleLocalNotification } = useNotifications();
  const callSocket = useRef<Socket | null>(null);

  const [globalCallState, setGlobalCallState] = useState<GlobalCallState>("idle");
  const [incomingCallData, setIncomingCallData] = useState<IncomingCallData | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [activeCallType, setActiveCallType] = useState<"audio" | "video">("audio");
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaker, setIsSpeaker] = useState(false);
  const [callTimer, setCallTimer] = useState(0);
  const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isCallMinimized, setIsCallMinimized] = useState(false);

  // Refs to avoid stale closures in socket callbacks
  const activeCallTypeRef = useRef<"audio" | "video">("audio");
  const isSpeakerRef = useRef(false);

  // WebRTC state
  const [localStream, setLocalStream] = useState<any>(null);
  const [remoteStream, setRemoteStream] = useState<any>(null);
  const peerConnectionRef = useRef<any>(null);
  const pendingIceCandidatesRef = useRef<any[]>([]);
  // Buffer for SDP answer that may arrive before createCallerSession() finishes
  const pendingAnswerRef = useRef<any>(null);
  const activeTargetUserIdRef = useRef<string | null>(null);
  const localStreamRef = useRef<any>(null);

  // Keep refs in sync with state
  useEffect(() => {
    activeCallTypeRef.current = activeCallType;
  }, [activeCallType]);

  useEffect(() => {
    localStreamRef.current = localStream;
  }, [localStream]);

  const clearCallTimer = useCallback(() => {
    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }
  }, []);

  const startCallTimer = useCallback(() => {
    clearCallTimer();
    setCallTimer(0);
    callTimerRef.current = setInterval(() => setCallTimer(t => t + 1), 1000);
  }, [clearCallTimer]);

  // Start InCallManager audio session
  const startAudioSession = useCallback((callType: "audio" | "video") => {
    if (!InCallManager) return;
    try {
      InCallManager.start({ media: callType === "video" ? "video" : "audio" });
      const speakerDefault = callType === "video";
      InCallManager.setSpeakerphoneOn(speakerDefault);
      isSpeakerRef.current = speakerDefault;
      setIsSpeaker(speakerDefault);
    } catch (e) {
      console.warn("InCallManager start error:", e);
    }
  }, []);

  // Stop InCallManager audio session
  const stopAudioSession = useCallback(() => {
    if (!InCallManager) return;
    try {
      InCallManager.stop();
    } catch (e) {
      console.warn("InCallManager stop error:", e);
    }
  }, []);

  const cleanupWebRTC = useCallback(() => {
    closePeerConnection(peerConnectionRef.current);
    peerConnectionRef.current = null;
    stopStream(localStreamRef.current);
    localStreamRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    pendingIceCandidatesRef.current = [];
    pendingAnswerRef.current = null;
    activeTargetUserIdRef.current = null;
    stopAudioSession();
    setIsMuted(false);
    setIsSpeaker(false);
    isSpeakerRef.current = false;
    setIsCallMinimized(false);
  }, [stopAudioSession]);

  useEffect(() => {
    if (!user?.id) return;
    let mounted = true;

    async function connect() {
      const token = await getToken();
      if (!token || !mounted) return;

      const sock = io(APP_BASE, {
        path: "/api/socket.io",
        auth: { token },
        transports: ["websocket"],
      });
      callSocket.current = sock;

      sock.on("incoming-call", (data: IncomingCallData) => {
        if (!mounted) return;
        setIncomingCallData(data);
        setActiveCallType(data.callType);
        activeCallTypeRef.current = data.callType;
        setGlobalCallState("incoming");
        playRingtone();
        vibrateCall();
        scheduleLocalNotification({
          title: `📞 Incoming ${data.callType === "video" ? "video" : "voice"} call`,
          body: `${data.callerName} is calling you`,
          isCall: true,
        });
      });

      sock.on("call-answer", async ({ accepted }: { accepted: boolean }) => {
        if (!mounted) return;
        if (accepted) {
          setGlobalCallState("connected");
          startCallTimer();

          const currentCallType = activeCallTypeRef.current;
          startAudioSession(currentCallType);

          if (isWebRTCAvailable && activeTargetUserIdRef.current) {
            try {
              // Reuse existing local stream if already started during "calling" phase
              // (caller starts camera immediately so they can see themselves while ringing)
              let stream = localStreamRef.current;
              if (!stream) {
                stream = await getLocalStream(currentCallType === "video");
                localStreamRef.current = stream;
                setLocalStream(stream);
              }

              const pc = await createCallerSession(
                activeTargetUserIdRef.current,
                stream,
                sock,
                (remStream) => {
                  if (mounted) setRemoteStream(remStream);
                },
                () => {},
              );
              peerConnectionRef.current = pc;

              // Apply buffered SDP answer that arrived while createCallerSession() was running
              if (pendingAnswerRef.current) {
                console.log("[WebRTC] applying buffered answer now that PC is ready");
                await applyAnswer(pc, pendingAnswerRef.current);
                pendingAnswerRef.current = null;
              }
              // Apply any ICE candidates that arrived before the PC was ready
              for (const c of pendingIceCandidatesRef.current) {
                await addIceCandidate(pc, c);
              }
              pendingIceCandidatesRef.current = [];
            } catch (e) {
              console.warn("WebRTC caller setup failed:", e);
            }
          }
        } else {
          setGlobalCallState("idle");
          setActiveConversationId(null);
          cleanupWebRTC();
        }
      });

      sock.on("webrtc-offer", async ({ fromUserId, sdp }: { fromUserId: string; sdp: any }) => {
        if (!mounted || !isWebRTCAvailable) return;
        try {
          const isVideo = activeCallTypeRef.current === "video";

          // Reuse existing local stream (started when answerCall was called)
          let stream = localStreamRef.current;
          if (!stream) {
            stream = await getLocalStream(isVideo);
            localStreamRef.current = stream;
            setLocalStream(stream);
          }

          const pc = await createCalleeSession(
            fromUserId,
            sdp,
            stream,
            sock,
            (remStream) => {
              if (mounted) setRemoteStream(remStream);
            },
          );
          peerConnectionRef.current = pc;

          for (const c of pendingIceCandidatesRef.current) {
            await addIceCandidate(pc, c);
          }
          pendingIceCandidatesRef.current = [];
        } catch (e) {
          console.warn("WebRTC callee setup failed:", e);
        }
      });

      sock.on("webrtc-answer", async ({ sdp }: { sdp: any }) => {
        if (!mounted) return;
        if (!peerConnectionRef.current) {
          // createCallerSession() hasn't finished yet — buffer the answer.
          // It will be applied immediately after peerConnectionRef.current is set.
          console.log("[WebRTC] answer arrived before PC ready — buffering");
          pendingAnswerRef.current = sdp;
          return;
        }
        await applyAnswer(peerConnectionRef.current, sdp);
        for (const c of pendingIceCandidatesRef.current) {
          await addIceCandidate(peerConnectionRef.current, c);
        }
        pendingIceCandidatesRef.current = [];
      });

      sock.on("webrtc-ice-candidate", async ({ candidate }: { candidate: any }) => {
        if (!mounted) return;
        if (peerConnectionRef.current) {
          await addIceCandidate(peerConnectionRef.current, candidate);
        } else {
          pendingIceCandidatesRef.current.push(candidate);
        }
      });

      sock.on("call-end", () => {
        if (!mounted) return;
        stopRingtone();
        Vibration.cancel();
        clearCallTimer();
        setGlobalCallState("idle");
        setIncomingCallData(null);
        setActiveConversationId(null);
        setCallTimer(0);
        cleanupWebRTC();
      });
    }

    connect();

    return () => {
      mounted = false;
      callSocket.current?.disconnect();
      callSocket.current = null;
      clearCallTimer();
    };
  }, [user?.id]);

  const incomingCallDataRef = useRef<IncomingCallData | null>(null);
  useEffect(() => {
    incomingCallDataRef.current = incomingCallData;
  }, [incomingCallData]);

  const answerCall = useCallback(async (accepted: boolean) => {
    if (!incomingCallData) return;
    stopRingtone();
    Vibration.cancel();

    if (accepted) {
      // ── Critical: initialise local stream BEFORE sending call-answer ──────
      // If we send call-answer first, the caller immediately creates a WebRTC
      // offer and sends it back.  On video calls the offer arrives while the
      // callee's camera is still starting (~1-2 s on Android), so the callee
      // adds the offer to the PC with no video tracks → neither side sees video.
      // Waiting for the stream here means the offer won't arrive until the
      // stream (and its video track) is already in localStreamRef.current.
      if (isWebRTCAvailable && !localStreamRef.current) {
        try {
          const stream = await getLocalStream(incomingCallData.callType === "video");
          localStreamRef.current = stream;
          setLocalStream(stream);
        } catch (e) {
          console.warn("Could not start receiver local stream:", e);
        }
      }

      // NOW tell the caller we accepted (stream is ready to add to PC)
      callSocket.current?.emit("call-answer", {
        callerId: incomingCallData.callerId,
        accepted: true,
        peerId: `${user?.id}-${Date.now()}`,
      });

      setGlobalCallState("connected");
      setActiveConversationId(incomingCallData.conversationId ?? null);
      startCallTimer();
      startAudioSession(incomingCallData.callType);

      if (incomingCallData.conversationId) {
        router.push(`/chat/${incomingCallData.conversationId}?name=${encodeURIComponent(incomingCallData.callerName)}&otherId=${incomingCallData.callerId}`);
      }
    } else {
      callSocket.current?.emit("call-answer", {
        callerId: incomingCallData.callerId,
        accepted: false,
        peerId: `${user?.id}-${Date.now()}`,
      });
      setGlobalCallState("idle");
      setIncomingCallData(null);
      scheduleLocalNotification({
        title: "Missed Call",
        body: `You missed a call from ${incomingCallData.callerName}`,
        isCall: false,
      });
    }
  }, [incomingCallData, user?.id, stopRingtone, startCallTimer, startAudioSession, scheduleLocalNotification]);

  const endCall = useCallback((targetUserId?: string) => {
    stopRingtone();
    Vibration.cancel();
    clearCallTimer();
    if (targetUserId) {
      callSocket.current?.emit("call-end", { userId: targetUserId });
    } else if (incomingCallData?.callerId && globalCallState === "incoming") {
      callSocket.current?.emit("call-end", { userId: incomingCallData.callerId });
    } else if (activeTargetUserIdRef.current) {
      callSocket.current?.emit("call-end", { userId: activeTargetUserIdRef.current });
    }
    setGlobalCallState("idle");
    setIncomingCallData(null);
    setActiveConversationId(null);
    setCallTimer(0);
    cleanupWebRTC();
  }, [incomingCallData, globalCallState, stopRingtone, clearCallTimer, cleanupWebRTC]);

  const startCall = useCallback(async (
    targetUserId: string,
    callType: "audio" | "video",
    conversationId: number,
  ) => {
    activeTargetUserIdRef.current = targetUserId;
    activeCallTypeRef.current = callType;
    setActiveCallType(callType);
    setActiveConversationId(conversationId);

    // Start local camera immediately so caller sees themselves during ringing
    if (isWebRTCAvailable) {
      try {
        const stream = await getLocalStream(callType === "video");
        localStreamRef.current = stream;
        setLocalStream(stream);
      } catch (e) {
        console.warn("Could not start local stream before call:", e);
      }
    }

    setGlobalCallState("calling");
    callSocket.current?.emit("call-offer", {
      targetUserId,
      peerId: `${user?.id}-${Date.now()}`,
      callType,
      conversationId,
    });
  }, [user?.id]);

  const toggleMute = useCallback(() => {
    setIsMuted(m => {
      const next = !m;
      const stream = localStreamRef.current;
      if (stream) {
        stream.getAudioTracks().forEach((t: any) => { t.enabled = !next; });
      }
      return next;
    });
  }, []);

  const toggleSpeaker = useCallback(() => {
    setIsSpeaker(s => {
      const next = !s;
      isSpeakerRef.current = next;
      if (InCallManager) {
        try {
          InCallManager.setSpeakerphoneOn(next);
        } catch (e) {
          console.warn("Speaker toggle error:", e);
        }
      }
      return next;
    });
  }, []);

  const minimizeCall = useCallback(() => setIsCallMinimized(true), []);
  const expandCall = useCallback(() => setIsCallMinimized(false), []);

  // Replace the video track in the active peer connection (used for screen sharing)
  const replaceCallVideoTrack = useCallback((track: any) => {
    if (peerConnectionRef.current) {
      replaceTrackInPeerConnection(peerConnectionRef.current, track, "video");
    }
  }, []);

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <CallContext.Provider value={{
      globalCallState,
      incomingCallData,
      activeConversationId,
      activeCallType,
      callSocket,
      isMuted,
      isSpeaker,
      callTimer,
      localStream,
      remoteStream,
      isCallMinimized,
      setGlobalCallState,
      setActiveConversationId,
      setActiveCallType,
      answerCall,
      endCall,
      startCall,
      toggleMute,
      toggleSpeaker,
      minimizeCall,
      expandCall,
      replaceCallVideoTrack,
    }}>
      {children}

      {/* Incoming call modal */}
      {globalCallState === "incoming" && incomingCallData && (
        <IncomingCallModal data={incomingCallData} onAnswer={answerCall} />
      )}

      {/* Floating mini call window (shown when minimized) — uses Modal for true global overlay */}
      <Modal
        visible={isCallMinimized && (globalCallState === "calling" || globalCallState === "connected")}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={expandCall}
      >
        <View style={{ flex: 1, pointerEvents: "box-none" }}>
          <FloatingCallWindow
            callState={globalCallState}
            callType={activeCallType}
            localStream={localStream}
            remoteStream={remoteStream}
            isMuted={isMuted}
            callerName={incomingCallData?.callerName ?? "Call"}
            callTimer={callTimer}
            onToggleMute={toggleMute}
            onEndCall={endCall}
            onExpand={expandCall}
            fmtTime={fmtTime}
          />
        </View>
      </Modal>
    </CallContext.Provider>
  );
}

export function useCall() {
  return useContext(CallContext);
}

// ─── Floating Mini Call Window ───────────────────────────────────────────────

function FloatingCallWindow({
  callState,
  callType,
  localStream,
  remoteStream,
  isMuted,
  callerName,
  callTimer,
  onToggleMute,
  onEndCall,
  onExpand,
  fmtTime,
}: {
  callState: GlobalCallState;
  callType: "audio" | "video";
  localStream: any;
  remoteStream: any;
  isMuted: boolean;
  callerName: string;
  callTimer: number;
  onToggleMute: () => void;
  onEndCall: () => void;
  onExpand: () => void;
  fmtTime: (s: number) => string;
}) {
  const pan = useRef(new Animated.ValueXY({ x: SW - 170, y: SH - 320 })).current;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        pan.setOffset({ x: (pan.x as any)._value, y: (pan.y as any)._value });
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], {
        useNativeDriver: false,
      }),
      onPanResponderRelease: () => {
        pan.flattenOffset();
        // Clamp within screen bounds
        const x = Math.max(0, Math.min((pan.x as any)._value, SW - 160));
        const y = Math.max(60, Math.min((pan.y as any)._value, SH - 280));
        Animated.spring(pan, {
          toValue: { x, y },
          useNativeDriver: false,
          tension: 40,
          friction: 7,
        }).start();
      },
    })
  ).current;

  const displayStream = callType === "video"
    ? (remoteStream || localStream)
    : null;

  return (
    <Animated.View
      style={[floatSt.container, { transform: pan.getTranslateTransform() }]}
      {...panResponder.panHandlers}
    >
      {/* Video or avatar background */}
      {displayStream && RTCView ? (
        <RTCView
          streamURL={displayStream.toURL()}
          style={StyleSheet.absoluteFillObject}
          objectFit="cover"
          mirror={!remoteStream}
          zOrder={0}
        />
      ) : (
        <View style={floatSt.audioBg}>
          <Ionicons name="call" size={28} color="#10b981" />
        </View>
      )}

      {/* Dark overlay for controls visibility */}
      <View style={floatSt.overlay}>
        {/* Top: name + status */}
        <View style={floatSt.topRow}>
          <Text style={floatSt.nameText} numberOfLines={1}>{callerName}</Text>
          <Text style={floatSt.statusText}>
            {callState === "calling" ? "Ringing..." : fmtTime(callTimer)}
          </Text>
        </View>

        {/* Bottom controls */}
        <View style={floatSt.controls}>
          {/* Mute */}
          <TouchableOpacity style={[floatSt.btn, isMuted && floatSt.btnActive]} onPress={onToggleMute}>
            <Ionicons name={isMuted ? "mic-off" : "mic-outline"} size={16} color="#fff" />
          </TouchableOpacity>

          {/* End Call */}
          <TouchableOpacity style={floatSt.endBtn} onPress={onEndCall}>
            <Ionicons name="call" size={18} color="#fff" style={{ transform: [{ rotate: "135deg" }] }} />
          </TouchableOpacity>

          {/* Expand to full screen */}
          <TouchableOpacity style={floatSt.btn} onPress={onExpand}>
            <Ionicons name="expand-outline" size={16} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
    </Animated.View>
  );
}

const floatSt = StyleSheet.create({
  container: {
    position: "absolute",
    width: 155,
    height: 210,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#0d1117",
    elevation: 20,
    zIndex: 9999,
    borderWidth: 2,
    borderColor: "rgba(16,185,129,0.6)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },
  audioBg: {
    ...StyleSheet.absoluteFillObject as any,
    backgroundColor: "#0d1b2a",
    alignItems: "center",
    justifyContent: "center",
  },
  overlay: {
    ...StyleSheet.absoluteFillObject as any,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "space-between",
    padding: 8,
  },
  topRow: {
    alignItems: "flex-start",
  },
  nameText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
    maxWidth: 130,
  },
  statusText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 10,
    marginTop: 2,
  },
  controls: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  btn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  btnActive: {
    backgroundColor: "rgba(239,68,68,0.5)",
  },
  endBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#ef4444",
    alignItems: "center",
    justifyContent: "center",
  },
});

// ─── Incoming Call Modal ──────────────────────────────────────────────────────

function IncomingCallModal({
  data,
  onAnswer,
}: {
  data: IncomingCallData;
  onAnswer: (accepted: boolean) => void;
}) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent>
      <Animated.View style={[st.overlay, { opacity: fadeAnim }]}>
        <View style={st.topSection}>
          <Text style={st.callTypeLabel}>
            {data.callType === "video" ? "📹 Incoming Video Call" : "📞 Incoming Voice Call"}
          </Text>
          <Text style={st.callerName}>{data.callerName}</Text>

          <Animated.View style={[st.avatarRing, { transform: [{ scale: pulseAnim }] }]}>
            <View style={st.avatarWrap}>
              {data.callerAvatar ? (
                <Image source={{ uri: data.callerAvatar }} style={st.avatar} />
              ) : (
                <View style={st.avatarFallback}>
                  <Text style={st.avatarLetter}>{(data.callerName || "?")[0].toUpperCase()}</Text>
                </View>
              )}
            </View>
          </Animated.View>

          <Text style={st.ringingLabel}>Ringing...</Text>
        </View>

        <View style={st.actionsRow}>
          <TouchableOpacity style={[st.callBtn, st.rejectBtn]} onPress={() => onAnswer(false)}>
            <Ionicons name="call" size={32} color="#fff" style={{ transform: [{ rotate: "135deg" }] }} />
            <Text style={st.callBtnLabel}>Decline</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[st.callBtn, st.acceptBtn]} onPress={() => onAnswer(true)}>
            <Ionicons name="call" size={32} color="#fff" />
            <Text style={st.callBtnLabel}>Accept</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </Modal>
  );
}

const st = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "#0d1b2a",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: Platform.OS === "android" ? 60 : 80,
    paddingBottom: 60,
  },
  topSection: { alignItems: "center", flex: 1, justifyContent: "center" },
  callTypeLabel: {
    fontSize: 16,
    color: "#94a3b8",
    fontFamily: "Inter_400Regular",
    marginBottom: 16,
    letterSpacing: 0.5,
  },
  callerName: {
    fontSize: 32,
    color: "#ffffff",
    fontFamily: "Inter_700Bold",
    marginBottom: 40,
    textAlign: "center",
  },
  avatarRing: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: "#10b98130",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  avatarWrap: {
    width: 120,
    height: 120,
    borderRadius: 60,
    overflow: "hidden",
    backgroundColor: "#1e293b",
    borderWidth: 3,
    borderColor: "#10b981",
  },
  avatar: { width: "100%", height: "100%" },
  avatarFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#10b981",
  },
  avatarLetter: { fontSize: 52, color: "#fff", fontFamily: "Inter_700Bold" },
  ringingLabel: {
    fontSize: 15,
    color: "#64748b",
    fontFamily: "Inter_400Regular",
    letterSpacing: 1,
  },
  actionsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    width: "100%",
    paddingHorizontal: 50,
  },
  callBtn: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  acceptBtn: { backgroundColor: "#10b981" },
  rejectBtn: { backgroundColor: "#ef4444" },
  callBtnLabel: {
    color: "#fff",
    fontSize: 12,
    marginTop: 8,
    fontFamily: "Inter_500Medium",
    position: "absolute",
    bottom: -22,
    width: 80,
    textAlign: "center",
  },
});
