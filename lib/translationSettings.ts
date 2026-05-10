import AsyncStorage from "@react-native-async-storage/async-storage";

const IDLE_TIMEOUT_KEY = "@vibemachine/translationIdleTimeoutSeconds";
const NOISE_REDUCTION_KEY = "@vibemachine/translationNoiseReductionType";
const INPUT_TRANSCRIPTION_ENABLED_KEY = "@vibemachine/translationInputTranscriptionEnabled";
const INPUT_TRANSCRIPTION_MODEL_KEY = "@vibemachine/translationInputTranscriptionModel";

export const DEFAULT_TRANSLATION_IDLE_TIMEOUT_SECONDS = 60;
export const DEFAULT_TRANSLATION_NOISE_REDUCTION: NoiseReductionType = "disabled";
export const DEFAULT_TRANSLATION_INPUT_TRANSCRIPTION_ENABLED = false;
export const DEFAULT_TRANSLATION_INPUT_TRANSCRIPTION_MODEL = "gpt-realtime-whisper";

export type NoiseReductionType = "disabled" | "near_field" | "far_field";

// --- Idle timeout ---

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

// --- Noise reduction ---

export const loadTranslationNoiseReductionType =
  async (): Promise<NoiseReductionType> => {
    try {
      const stored = await AsyncStorage.getItem(NOISE_REDUCTION_KEY);
      if (stored === "near_field" || stored === "far_field") return stored;
      return DEFAULT_TRANSLATION_NOISE_REDUCTION;
    } catch {
      return DEFAULT_TRANSLATION_NOISE_REDUCTION;
    }
  };

export const saveTranslationNoiseReductionType = async (
  type: NoiseReductionType,
): Promise<void> => {
  try {
    await AsyncStorage.setItem(NOISE_REDUCTION_KEY, type);
  } catch {
    // Ignore persistence errors; UI will fall back to default.
  }
};

// --- Input transcription ---

export const loadTranslationInputTranscriptionEnabled =
  async (): Promise<boolean> => {
    try {
      const stored = await AsyncStorage.getItem(INPUT_TRANSCRIPTION_ENABLED_KEY);
      if (stored === null) return DEFAULT_TRANSLATION_INPUT_TRANSCRIPTION_ENABLED;
      return stored === "true";
    } catch {
      return DEFAULT_TRANSLATION_INPUT_TRANSCRIPTION_ENABLED;
    }
  };

export const saveTranslationInputTranscriptionEnabled = async (
  enabled: boolean,
): Promise<void> => {
  try {
    await AsyncStorage.setItem(INPUT_TRANSCRIPTION_ENABLED_KEY, enabled ? "true" : "false");
  } catch {
    // Ignore persistence errors; UI will fall back to default.
  }
};

export const loadTranslationInputTranscriptionModel =
  async (): Promise<string> => {
    try {
      const stored = await AsyncStorage.getItem(INPUT_TRANSCRIPTION_MODEL_KEY);
      return stored ?? DEFAULT_TRANSLATION_INPUT_TRANSCRIPTION_MODEL;
    } catch {
      return DEFAULT_TRANSLATION_INPUT_TRANSCRIPTION_MODEL;
    }
  };

export const saveTranslationInputTranscriptionModel = async (
  model: string,
): Promise<void> => {
  try {
    await AsyncStorage.setItem(INPUT_TRANSCRIPTION_MODEL_KEY, model);
  } catch {
    // Ignore persistence errors; UI will fall back to default.
  }
};
