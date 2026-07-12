import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "@vibemachine/realtimeModelPreference";

export type RealtimeModel = "gpt-realtime" | "gpt-realtime-2" | "gpt-realtime-2.1";

export type RealtimeModelOption = {
  value: RealtimeModel;
  title: string;
  description: string;
};

export const DEFAULT_REALTIME_MODEL: RealtimeModel = "gpt-realtime-2";

export const REALTIME_MODEL_OPTIONS: RealtimeModelOption[] = [
  {
    value: "gpt-realtime",
    title: "GPT Realtime",
    description: "Model ID: gpt-realtime. Original voice model option.",
  },
  {
    value: "gpt-realtime-2",
    title: "GPT Realtime 2",
    description: "Model ID: gpt-realtime-2. Default voice model option.",
  },
  {
    value: "gpt-realtime-2.1",
    title: "GPT Realtime 2.1",
    description: "Model ID: gpt-realtime-2.1. Adds reasoning to speech-to-speech.",
  },
];

const isRealtimeModel = (value: string): value is RealtimeModel =>
  value === "gpt-realtime" ||
  value === "gpt-realtime-2" ||
  value === "gpt-realtime-2.1";

export const loadRealtimeModelPreference = async (): Promise<RealtimeModel> => {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (!stored || !isRealtimeModel(stored)) {
      return DEFAULT_REALTIME_MODEL;
    }
    return stored;
  } catch {
    return DEFAULT_REALTIME_MODEL;
  }
};

export const saveRealtimeModelPreference = async (
  model: RealtimeModel,
): Promise<void> => {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, model);
  } catch {
    // Ignore persistence errors for now; UI will fall back to default.
  }
};
