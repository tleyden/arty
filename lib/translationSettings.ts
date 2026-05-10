import AsyncStorage from "@react-native-async-storage/async-storage";

const IDLE_TIMEOUT_KEY = "@vibemachine/translationIdleTimeoutSeconds";
export const DEFAULT_TRANSLATION_IDLE_TIMEOUT_SECONDS = 60;

export const loadTranslationIdleTimeoutSeconds = async (): Promise<number> => {
  try {
    const stored = await AsyncStorage.getItem(IDLE_TIMEOUT_KEY);
    if (stored === null) {
      return DEFAULT_TRANSLATION_IDLE_TIMEOUT_SECONDS;
    }
    const parsed = parseInt(stored, 10);
    return Number.isFinite(parsed) ? parsed : DEFAULT_TRANSLATION_IDLE_TIMEOUT_SECONDS;
  } catch {
    return DEFAULT_TRANSLATION_IDLE_TIMEOUT_SECONDS;
  }
};

export const saveTranslationIdleTimeoutSeconds = async (
  seconds: number,
): Promise<void> => {
  try {
    await AsyncStorage.setItem(IDLE_TIMEOUT_KEY, String(seconds));
  } catch {
    // Ignore persistence errors; UI will fall back to default.
  }
};
