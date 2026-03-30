import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, AppStateStatus } from "react-native";

const QUEUE_KEY = "offline_message_queue";

export interface QueuedMessage {
  id: string;
  conversationId: number;
  content: string;
  replyToId?: number;
  timestamp: number;
}

export async function getQueue(): Promise<QueuedMessage[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function enqueueMessage(msg: QueuedMessage): Promise<void> {
  const queue = await getQueue();
  queue.push(msg);
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export async function removeFromQueue(id: string): Promise<void> {
  const queue = await getQueue();
  const filtered = queue.filter((m) => m.id !== id);
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(filtered));
}

export async function clearQueueForConversation(conversationId: number): Promise<void> {
  const queue = await getQueue();
  const filtered = queue.filter((m) => m.conversationId !== conversationId);
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(filtered));
}

// Simple connectivity check by pinging the server
export async function checkIsOnline(baseUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(`${baseUrl}/api/health`, {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

export function subscribeToAppState(
  onForeground: () => void
): () => void {
  const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
    if (state === "active") onForeground();
  });
  return () => sub.remove();
}
