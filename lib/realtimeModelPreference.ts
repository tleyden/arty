import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "@vibemachine/realtimeModelPreference";

export type RealtimeModel = "gpt-realtime" | "gpt-realtime-2";

export type RealtimeModelOption = {
  value: RealtimeModel;
  title: string;
  description: string;
};

export const DEFAULT_REALTIME_MODEL: RealtimeModel = "gpt-realtime";

export const REALTIME_MODEL_OPTIONS: RealtimeModelOption[] = [
  {
    value: "gpt-realtime",
    title: "GPT Realtime",
    description: "Model ID: gpt-realtime. Current default for voice sessions.",
  },
  {
    value: "gpt-realtime-2",
    title: "GPT Realtime 2",
    description: "Model ID: gpt-realtime-2. Newer voice model option.",
  },
];

const isRealtimeModel = (value: string): value is RealtimeModel =>
  value === "gpt-realtime" || value === "gpt-realtime-2";

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
