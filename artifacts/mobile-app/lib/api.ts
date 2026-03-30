import * as SecureStore from "expo-secure-store";

const SESSION_KEY = "private_session_token";
const USER_CACHE_KEY = "private_user_cache";

const DOMAIN = process.env.EXPO_PUBLIC_DOMAIN || "localhost:8080";
export const API_BASE = `https://${DOMAIN}/api`;
export const APP_BASE = `https://${DOMAIN}`;

let cachedToken: string | null = null;

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export async function getToken(): Promise<string | null> {
  if (cachedToken) return cachedToken;
  try {
    cachedToken = await SecureStore.getItemAsync(SESSION_KEY);
    return cachedToken;
  } catch {
    return null;
  }
}

export async function setToken(token: string): Promise<void> {
  cachedToken = token;
  await SecureStore.setItemAsync(SESSION_KEY, token);
}

export async function clearToken(): Promise<void> {
  cachedToken = null;
  await SecureStore.deleteItemAsync(SESSION_KEY);
  await SecureStore.deleteItemAsync(USER_CACHE_KEY);
}

export async function saveUserCache(user: object): Promise<void> {
  try {
    await SecureStore.setItemAsync(USER_CACHE_KEY, JSON.stringify(user));
  } catch {}
}

export async function loadUserCache(): Promise<any | null> {
  try {
    const raw = await SecureStore.getItemAsync(USER_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function apiRequest<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;

  let response: Response;
  try {
    response = await fetch(url, { ...options, headers });
  } catch {
    throw new Error("Server unreachable. Please check your connection and try again.");
  }

  const contentType = response.headers.get("content-type") || "";
  const isHtml = contentType.includes("text/html");

  if (!response.ok) {
    if (isHtml) {
      if (response.status === 401 || response.status === 403) {
        throw new AuthError("Session expired. Please log in again.");
      }
      throw new Error("Server unavailable. Please try again in a moment.");
    }
    const text = await response.text();
    let message = text;
    try {
      const json = JSON.parse(text);
      message = json.error || json.message || text;
    } catch {}
    if (response.status === 401 || response.status === 403) {
      throw new AuthError(message || `Unauthorized: ${response.status}`);
    }
    throw new Error(message || `Request failed: ${response.status}`);
  }

  if (isHtml) {
    throw new Error("Server returned an unexpected response. Please try again.");
  }

  const text = await response.text();
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

export async function login(email: string, password: string) {
  const data = await apiRequest<{
    success: boolean;
    sessionToken: string;
    user: { id: string; email: string; username: string; firstName: string };
  }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  await setToken(data.sessionToken);
  return data;
}

export async function register(email: string, password: string, username: string) {
  const data = await apiRequest<{
    success: boolean;
    sessionToken: string;
    user: { id: string; email: string; username: string; firstName: string };
  }>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, username }),
  });
  await setToken(data.sessionToken);
  return data;
}

export async function logout() {
  try {
    await apiRequest("/auth/logout", { method: "POST" });
  } catch {}
  await clearToken();
}

export async function getCurrentUser() {
  return apiRequest<{
    isAuthenticated: boolean;
    user: {
      id: string;
      email: string;
      firstName: string | null;
      lastName: string | null;
      profileImageUrl: string | null;
    } | null;
  }>("/auth/user");
}

export async function getConversations() {
  return apiRequest<ConversationWithDetails[]>("/conversations");
}

export async function createConversation(participantId: string) {
  return apiRequest<ConversationWithDetails>("/conversations", {
    method: "POST",
    body: JSON.stringify({ participantIds: [participantId], isGroup: false }),
  });
}

export async function deleteConversation(conversationId: number) {
  return apiRequest(`/conversations/${conversationId}`, { method: "DELETE" });
}

export async function getMessages(conversationId: number, before?: number) {
  const params = new URLSearchParams({ limit: "50" });
  if (before) params.set("before", String(before));
  return apiRequest<Message[]>(`/conversations/${conversationId}/messages?${params}`);
}

export async function sendMessage(
  conversationId: number,
  content: string,
  replyToId?: number
) {
  return apiRequest<Message>(`/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content, messageType: "text", replyToId }),
  });
}

export async function editMessage(
  conversationId: number,
  messageId: number,
  content: string
) {
  return apiRequest<Message>(
    `/conversations/${conversationId}/messages/${messageId}`,
    { method: "PATCH", body: JSON.stringify({ content }) }
  );
}

export async function deleteMessageForEveryone(
  conversationId: number,
  messageId: number
) {
  return apiRequest(
    `/conversations/${conversationId}/messages/${messageId}`,
    { method: "DELETE" }
  );
}

export async function toggleReaction(
  conversationId: number,
  messageId: number,
  emoji: string
) {
  return apiRequest(
    `/conversations/${conversationId}/messages/${messageId}/reactions`,
    { method: "POST", body: JSON.stringify({ emoji }) }
  );
}

export async function uploadFile(
  uri: string,
  name: string,
  mimeType: string
): Promise<{ url: string; fileName: string; fileSize: number }> {
  const token = await getToken();
  const formData = new FormData();
  formData.append("file", { uri, name, type: mimeType } as any);

  const response = await fetch(`${API_BASE}/upload`, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Upload failed: ${response.status} ${text}`);
  }

  return response.json();
}

export async function sendMediaMessage(
  conversationId: number,
  fileUrl: string,
  fileName: string,
  fileSize: number,
  messageType: "image" | "video",
  caption?: string,
  replyToId?: number
) {
  return apiRequest<Message>(`/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      messageType,
      fileUrl,
      fileName,
      fileSize,
      ...(caption ? { content: caption } : {}),
      ...(replyToId ? { replyToId } : {}),
    }),
  });
}

export async function sendVoiceMessage(
  conversationId: number,
  fileUrl: string,
  duration: number
) {
  return apiRequest<Message>(`/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({ messageType: "voice", fileUrl, fileName: "voice.m4a", duration }),
  });
}

export async function getUsers() {
  return apiRequest<User[]>("/users");
}

export async function getUserById(userId: string) {
  return apiRequest<User>(`/users/${userId}`);
}

export async function updateProfile(data: { displayName?: string; avatarUrl?: string }) {
  return apiRequest("/users/me/profile", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function uploadAvatar(
  uri: string,
  name: string,
  mimeType: string
): Promise<{ url: string }> {
  const token = await getToken();
  const formData = new FormData();
  formData.append("file", { uri, name, type: mimeType } as any);

  const response = await fetch(`${API_BASE}/upload`, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: formData,
  });

  if (!response.ok) throw new Error("Avatar upload failed");
  const data = await response.json();
  return { url: `${APP_BASE}${data.url}` };
}

export async function registerExpoPushToken(token: string) {
  return apiRequest("/push/expo-token", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export async function registerFcmToken(token: string, platform: string = "android") {
  return apiRequest("/push/fcm-token", {
    method: "POST",
    body: JSON.stringify({ token, platform }),
  });
}

export async function getCalls() {
  return apiRequest<CallEntry[]>("/calls");
}

export async function getStories() {
  return apiRequest<Story[]>("/stories");
}

export async function createTextStory(data: {
  content: string;
  backgroundColor?: string;
  textColor?: string;
}) {
  return apiRequest<Story>("/stories", {
    method: "POST",
    body: JSON.stringify({ type: "text", ...data }),
  });
}

export async function createMediaStory(
  uri: string,
  mimeType: string
): Promise<Story> {
  const token = await getToken();
  const formData = new FormData();
  const ext = mimeType.startsWith("video") ? "mp4" : "jpg";
  formData.append("file", { uri, name: `story_${Date.now()}.${ext}`, type: mimeType } as any);

  const response = await fetch(`${API_BASE}/stories/media`, {
    method: "POST",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: formData,
  });
  if (!response.ok) throw new Error("Story upload failed");
  return response.json();
}

export async function viewStory(storyId: number) {
  return apiRequest(`/stories/${storyId}/view`, { method: "POST" });
}

export async function reactToStory(storyId: number, emoji: string) {
  return apiRequest(`/stories/${storyId}/react`, {
    method: "POST",
    body: JSON.stringify({ emoji }),
  });
}

export async function deleteStory(storyId: number) {
  return apiRequest(`/stories/${storyId}`, { method: "DELETE" });
}

export interface User {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  isOnline: boolean;
  lastSeen: string | null;
  createdAt: string;
}

export interface Message {
  id: number;
  conversationId: number;
  senderId: string;
  sender: User;
  content: string | null;
  messageType: string;
  fileUrl: string | null;
  fileName: string | null;
  fileSize: number | null;
  duration: number | null;
  replyToId: number | null;
  replyTo: Message | null;
  isDeleted: boolean;
  edited: boolean;
  seenBy: string[];
  reactions: { emoji: string; userId: string }[];
  createdAt: string;
}

export interface ConversationWithDetails {
  id: number;
  isGroup: boolean;
  name: string | null;
  createdAt: string;
  participants: User[];
  lastMessage: Message | null;
  unreadCount: number;
}

export interface Story {
  id: number;
  userId: string;
  type: "text" | "image" | "video" | "voice";
  content: string | null;
  mediaUrl: string | null;
  backgroundColor: string | null;
  textColor: string | null;
  createdAt: string;
  expiresAt: string;
  userName: string | null;
  userAvatar: string | null;
  viewCount: number;
  hasViewed: boolean;
  views: any[];
  reactions: { id: number; storyId: number; userId: string; emoji: string }[];
}

export interface StoryGroup {
  userId: string;
  userName: string | null;
  userAvatar: string | null;
  stories: Story[];
  hasUnviewed: boolean;
}

export interface CallEntry {
  id: number;
  conversationId: number;
  senderId: string;
  duration: number | null;
  createdAt: string;
  callerId: string;
  calleeId: string | null;
  callType: "audio" | "video";
  answeredAt: string | null;
  caller: {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    isOnline: boolean;
    lastSeen: string | null;
  } | null;
  callee: {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    isOnline: boolean;
    lastSeen: string | null;
  } | null;
}
