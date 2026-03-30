import AsyncStorage from "@react-native-async-storage/async-storage";

function key(myId: string, targetId: string) {
  return `nickname_${myId}_${targetId}`;
}

export async function getNickname(myId: string, targetId: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key(myId, targetId));
  } catch {
    return null;
  }
}

export async function setNickname(myId: string, targetId: string, nickname: string): Promise<void> {
  await AsyncStorage.setItem(key(myId, targetId), nickname.trim());
}

export async function removeNickname(myId: string, targetId: string): Promise<void> {
  await AsyncStorage.removeItem(key(myId, targetId));
}
