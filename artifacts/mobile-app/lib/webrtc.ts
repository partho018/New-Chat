import { Socket } from "socket.io-client";
import { PermissionsAndroid, Platform, Alert } from "react-native";
import { API_BASE } from "./api";

// Safely import react-native-webrtc (not available in Expo Go)
let RTCPeerConnection: any = null;
let RTCSessionDescription: any = null;
let RTCIceCandidate: any = null;
let mediaDevices: any = null;
let MediaStream: any = null;

try {
  const webrtc = require("react-native-webrtc");
  RTCPeerConnection = webrtc.RTCPeerConnection;
  RTCSessionDescription = webrtc.RTCSessionDescription;
  RTCIceCandidate = webrtc.RTCIceCandidate;
  mediaDevices = webrtc.mediaDevices;
  MediaStream = webrtc.MediaStream;
} catch {
  // Expo Go or native module not linked yet
}

export const isWebRTCAvailable = !!RTCPeerConnection;

// Fallback ICE servers if backend fetch fails
const FALLBACK_ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun.relay.metered.ca:80" },
];

// Fetch fresh ICE servers (including TURN credentials) from backend
async function fetchIceServers(): Promise<any[]> {
  try {
    const response = await fetch(`${API_BASE}/ice-servers`, { method: "GET" });
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data.iceServers) && data.iceServers.length > 0) {
        return data.iceServers;
      }
    }
  } catch {}
  return FALLBACK_ICE_SERVERS;
}

async function buildPCConfig() {
  const iceServers = await fetchIceServers();
  return {
    iceServers,
    iceCandidatePoolSize: 10,
  };
}

export interface WebRTCSession {
  localStream: any;
  remoteStream: any;
  close: () => void;
}

// Request Android permissions before accessing media
export async function requestMediaPermissions(video: boolean): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  try {
    const permissions: any[] = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
    if (video) permissions.push(PermissionsAndroid.PERMISSIONS.CAMERA);

    const results = await PermissionsAndroid.requestMultiple(permissions);

    const audioGranted = results[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED;
    const cameraGranted = !video || results[PermissionsAndroid.PERMISSIONS.CAMERA] === PermissionsAndroid.RESULTS.GRANTED;

    if (!audioGranted) {
      Alert.alert("Permission Required", "Microphone permission is required for calls.");
      return false;
    }
    if (!cameraGranted) {
      Alert.alert("Permission Required", "Camera permission is required for video calls.");
      return false;
    }
    return true;
  } catch (e) {
    console.warn("Permission request error:", e);
    return false;
  }
}

export async function getLocalStream(video: boolean): Promise<any> {
  if (!mediaDevices) throw new Error("WebRTC not available");

  // Request permissions first on Android
  const granted = await requestMediaPermissions(video);
  if (!granted) throw new Error("Media permission denied");

  const constraints: any = {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: video
      ? { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } }
      : false,
  };

  return mediaDevices.getUserMedia(constraints);
}

export async function getScreenShareStream(): Promise<any> {
  if (!mediaDevices) throw new Error("WebRTC not available");
  try {
    return await mediaDevices.getDisplayMedia({ video: true, audio: false });
  } catch (e) {
    throw new Error("Screen sharing not supported on this device");
  }
}

export function replaceTrackInPeerConnection(pc: any, newTrack: any, kind: string) {
  if (!pc) return;
  try {
    const senders: any[] = pc.getSenders();
    const sender = senders.find((s: any) => s.track && s.track.kind === kind);
    if (sender) sender.replaceTrack(newTrack);
  } catch (e) {
    console.warn("replaceTrack failed:", e);
  }
}

export async function createCallerSession(
  targetUserId: string,
  localStream: any,
  socket: Socket,
  onRemoteStream: (stream: any) => void,
  onIceCandidate: (candidate: any) => void,
): Promise<any> {
  if (!RTCPeerConnection) throw new Error("WebRTC not available");

  const pcConfig = await buildPCConfig();
  const pc = new RTCPeerConnection(pcConfig);

  // Add all local tracks
  localStream.getTracks().forEach((track: any) => {
    pc.addTrack(track, localStream);
  });

  // Accumulator stream: when event.streams is empty, tracks arrive one-by-one.
  // We MUST add them all to the SAME stream — otherwise each ontrack overwrites
  // the previous one and either audio or video gets silently dropped.
  let accumStream: any = null;

  // Listen for remote stream
  pc.ontrack = (event: any) => {
    console.log("[WebRTC Caller] ontrack fired, kind:", event.track?.kind, "streams:", event.streams?.length);
    if (event.streams && event.streams[0]) {
      // Standard path: all tracks arrive bundled in one stream
      onRemoteStream(event.streams[0]);
    } else if (event.track && MediaStream) {
      // Fallback path: tracks arrive individually — accumulate into one stream
      if (!accumStream) accumStream = new MediaStream();
      accumStream.addTrack(event.track);
      onRemoteStream(accumStream);
    }
  };

  // Relay ICE candidates
  pc.onicecandidate = (event: any) => {
    if (event.candidate) {
      onIceCandidate(event.candidate);
      socket.emit("webrtc-ice-candidate", { targetUserId, candidate: event.candidate });
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log("[WebRTC Caller] ICE state:", pc.iceConnectionState);
  };

  pc.onconnectionstatechange = () => {
    console.log("[WebRTC Caller] Connection state:", pc.connectionState);
  };

  const offer = await pc.createOffer({
    offerToReceiveAudio: true,
    offerToReceiveVideo: true,
  });
  await pc.setLocalDescription(new RTCSessionDescription(offer));
  socket.emit("webrtc-offer", { targetUserId, sdp: offer });

  return pc;
}

export async function createCalleeSession(
  callerId: string,
  sdpOffer: any,
  localStream: any,
  socket: Socket,
  onRemoteStream: (stream: any) => void,
): Promise<any> {
  if (!RTCPeerConnection) throw new Error("WebRTC not available");

  const pcConfig = await buildPCConfig();
  const pc = new RTCPeerConnection(pcConfig);

  // Add all local tracks
  localStream.getTracks().forEach((track: any) => {
    pc.addTrack(track, localStream);
  });

  // Accumulator stream: same fix as createCallerSession — prevent audio/video
  // track drop when they arrive individually (event.streams empty on Android).
  let accumStream: any = null;

  // Listen for remote stream
  pc.ontrack = (event: any) => {
    console.log("[WebRTC Callee] ontrack fired, kind:", event.track?.kind, "streams:", event.streams?.length);
    if (event.streams && event.streams[0]) {
      // Standard path: all tracks arrive bundled in one stream
      onRemoteStream(event.streams[0]);
    } else if (event.track && MediaStream) {
      // Fallback path: tracks arrive individually — accumulate into one stream
      if (!accumStream) accumStream = new MediaStream();
      accumStream.addTrack(event.track);
      onRemoteStream(accumStream);
    }
  };

  // Relay ICE candidates
  pc.onicecandidate = (event: any) => {
    if (event.candidate) {
      socket.emit("webrtc-ice-candidate", { targetUserId: callerId, candidate: event.candidate });
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log("[WebRTC Callee] ICE state:", pc.iceConnectionState);
  };

  pc.onconnectionstatechange = () => {
    console.log("[WebRTC Callee] Connection state:", pc.connectionState);
  };

  await pc.setRemoteDescription(new RTCSessionDescription(sdpOffer));

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(new RTCSessionDescription(answer));
  socket.emit("webrtc-answer", { targetUserId: callerId, sdp: answer });

  return pc;
}

export async function addIceCandidate(pc: any, candidate: any) {
  if (!pc || !RTCIceCandidate) return;
  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (e) {
    console.warn("Failed to add ICE candidate:", e);
  }
}

export async function applyAnswer(pc: any, sdpAnswer: any) {
  if (!pc || !RTCSessionDescription) return;
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(sdpAnswer));
  } catch (e) {
    console.warn("Failed to apply answer:", e);
  }
}

export function stopStream(stream: any) {
  if (!stream) return;
  try {
    stream.getTracks().forEach((track: any) => track.stop());
  } catch {}
}

export function closePeerConnection(pc: any) {
  if (!pc) return;
  try {
    pc.close();
  } catch {}
}
