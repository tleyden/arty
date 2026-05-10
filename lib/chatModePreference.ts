import AsyncStorage from "@react-native-async-storage/async-storage";

import type { ChatMode } from "../components/settings/ConfigureChatMode";

const STORAGE_KEY = "@vibemachine/chatModePreference";
export const DEFAULT_CHAT_MODE: ChatMode = "voice";

export const loadChatModePreference = async (): Promise<ChatMode> => {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored === "voice" || stored === "text" || stored === "realtimeTranslation") {
      return stored;
    }
    return DEFAULT_CHAT_MODE;
  } catch {
    return DEFAULT_CHAT_MODE;
  }
};

export const saveChatModePreference = async (mode: ChatMode): Promise<void> => {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Ignore persistence errors; UI will fall back to default.
  }
};
