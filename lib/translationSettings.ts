import AsyncStorage from "@react-native-async-storage/async-storage";

const IDLE_TIMEOUT_KEY = "@vibemachine/translationIdleTimeoutSeconds";
const NOISE_REDUCTION_KEY = "@vibemachine/translationNoiseReductionType";
const INPUT_TRANSCRIPTION_ENABLED_KEY =
  "@vibemachine/translationInputTranscriptionEnabled";
const INPUT_TRANSCRIPTION_MODEL_KEY =
  "@vibemachine/translationInputTranscriptionModel";
const TRANSCRIPT_FONT_SIZE_KEY = "@vibemachine/translationTranscriptFontSize";
const OUTPUT_LANGUAGE_KEY = "@vibemachine/translationOutputLanguage";
const BIDIRECTIONAL_ENABLED_KEY = "@vibemachine/translationBidirectionalEnabled";
const BIDIRECTIONAL_LANGUAGE_KEY = "@vibemachine/translationBidirectionalLanguage";

export const DEFAULT_BIDIRECTIONAL_ENABLED = false;
export const DEFAULT_BIDIRECTIONAL_LANGUAGE = "en";

export const DEFAULT_TRANSLATION_IDLE_TIMEOUT_SECONDS = 60;
export const MIN_TRANSLATION_IDLE_TIMEOUT_SECONDS = 10;
export const MAX_TRANSLATION_IDLE_TIMEOUT_SECONDS = 300;
export const DEFAULT_OUTPUT_LANGUAGE = "de";
export const DEFAULT_TRANSLATION_NOISE_REDUCTION: NoiseReductionType =
  "disabled";
export const DEFAULT_TRANSLATION_INPUT_TRANSCRIPTION_ENABLED = false;
export const DEFAULT_TRANSLATION_INPUT_TRANSCRIPTION_MODEL =
  "gpt-realtime-whisper";
export const TRANSCRIPT_FONT_SIZE_OPTIONS = [
  10, 12, 15, 18, 20, 22, 26, 30, 34, 38, 45,
];
export const DEFAULT_TRANSCRIPT_FONT_SIZE = 15;

export type NoiseReductionType = "disabled" | "near_field" | "far_field";

// --- Idle timeout ---

export const loadTranslationIdleTimeoutSeconds = async (): Promise<number> => {
  try {
    const stored = await AsyncStorage.getItem(IDLE_TIMEOUT_KEY);
    if (stored === null) {
      return DEFAULT_TRANSLATION_IDLE_TIMEOUT_SECONDS;
    }
    const parsed = parseInt(stored, 10);
    if (!Number.isFinite(parsed)) {
      return DEFAULT_TRANSLATION_IDLE_TIMEOUT_SECONDS;
    }
    return Math.min(MAX_TRANSLATION_IDLE_TIMEOUT_SECONDS, Math.max(MIN_TRANSLATION_IDLE_TIMEOUT_SECONDS, parsed));
  } catch {
    return DEFAULT_TRANSLATION_IDLE_TIMEOUT_SECONDS;
  }
};

export const saveTranslationIdleTimeoutSeconds = async (
  seconds: number,
): Promise<void> => {
  try {
    const clamped = Math.min(MAX_TRANSLATION_IDLE_TIMEOUT_SECONDS, Math.max(MIN_TRANSLATION_IDLE_TIMEOUT_SECONDS, seconds));
    await AsyncStorage.setItem(IDLE_TIMEOUT_KEY, String(clamped));
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
      const stored = await AsyncStorage.getItem(
        INPUT_TRANSCRIPTION_ENABLED_KEY,
      );
      if (stored === null)
        return DEFAULT_TRANSLATION_INPUT_TRANSCRIPTION_ENABLED;
      return stored === "true";
    } catch {
      return DEFAULT_TRANSLATION_INPUT_TRANSCRIPTION_ENABLED;
    }
  };

export const saveTranslationInputTranscriptionEnabled = async (
  enabled: boolean,
): Promise<void> => {
  try {
    await AsyncStorage.setItem(
      INPUT_TRANSCRIPTION_ENABLED_KEY,
      enabled ? "true" : "false",
    );
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

// --- Transcript font size ---

export const loadTranscriptFontSize = async (): Promise<number> => {
  try {
    const stored = await AsyncStorage.getItem(TRANSCRIPT_FONT_SIZE_KEY);
    if (stored === null) return DEFAULT_TRANSCRIPT_FONT_SIZE;
    const parsed = parseInt(stored, 10);
    return TRANSCRIPT_FONT_SIZE_OPTIONS.includes(parsed)
      ? parsed
      : DEFAULT_TRANSCRIPT_FONT_SIZE;
  } catch {
    return DEFAULT_TRANSCRIPT_FONT_SIZE;
  }
};

export const saveTranscriptFontSize = async (size: number): Promise<void> => {
  try {
    await AsyncStorage.setItem(TRANSCRIPT_FONT_SIZE_KEY, String(size));
  } catch {
    // Ignore persistence errors; UI will fall back to default.
  }
};

// --- Output language ---

export const loadOutputLanguage = async (): Promise<string> => {
  try {
    const stored = await AsyncStorage.getItem(OUTPUT_LANGUAGE_KEY);
    return stored ?? DEFAULT_OUTPUT_LANGUAGE;
  } catch {
    return DEFAULT_OUTPUT_LANGUAGE;
  }
};

export const saveOutputLanguage = async (code: string): Promise<void> => {
  try {
    await AsyncStorage.setItem(OUTPUT_LANGUAGE_KEY, code);
  } catch {
    // Ignore persistence errors; UI will fall back to default.
  }
};

// --- Bidirectional mode ---

export const loadBidirectionalEnabled = async (): Promise<boolean> => {
  try {
    const stored = await AsyncStorage.getItem(BIDIRECTIONAL_ENABLED_KEY);
    if (stored === null) return DEFAULT_BIDIRECTIONAL_ENABLED;
    return stored === "true";
  } catch {
    return DEFAULT_BIDIRECTIONAL_ENABLED;
  }
};

export const saveBidirectionalEnabled = async (enabled: boolean): Promise<void> => {
  try {
    await AsyncStorage.setItem(BIDIRECTIONAL_ENABLED_KEY, enabled ? "true" : "false");
  } catch {
    // Ignore persistence errors; UI will fall back to default.
  }
};

export const loadBidirectionalLanguage = async (): Promise<string> => {
  try {
    const stored = await AsyncStorage.getItem(BIDIRECTIONAL_LANGUAGE_KEY);
    return stored ?? DEFAULT_BIDIRECTIONAL_LANGUAGE;
  } catch {
    return DEFAULT_BIDIRECTIONAL_LANGUAGE;
  }
};

export const saveBidirectionalLanguage = async (code: string): Promise<void> => {
  try {
    await AsyncStorage.setItem(BIDIRECTIONAL_LANGUAGE_KEY, code);
  } catch {
    // Ignore persistence errors; UI will fall back to default.
  }
};
