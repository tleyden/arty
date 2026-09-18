import AsyncStorage from "@react-native-async-storage/async-storage";
import { isLiveModel } from "./realtimeModelPreference";
import { getVoiceOptions } from "./voiceOptions";

export const DEFAULT_VOICE = "cedar";
export const DEFAULT_LIVE_VOICE = "meridian";
const storageKey = (model: string) => isLiveModel(model)
  ? "@vibemachine/liveVoicePreference"
  : "@vibemachine/voicePreference";
const defaultVoice = (model: string) =>
  isLiveModel(model) ? DEFAULT_LIVE_VOICE : DEFAULT_VOICE;

export const loadVoicePreference = async (model: string): Promise<string> => {
  try {
    const key = storageKey(model);
    const stored = await AsyncStorage.getItem(key);
    if (stored && getVoiceOptions(model).some(({ value }) => value === stored)) {
      return stored;
    }
    const fallback = defaultVoice(model);
    if (stored && isLiveModel(model)) {
      // Replace removed Live voices, including Arbor, in saved preferences.
      await AsyncStorage.setItem(key, fallback);
    }
    return fallback;
  } catch {
    return defaultVoice(model);
  }
};

export const saveVoicePreference = async (model: string, voice: string): Promise<void> => {
  if (!getVoiceOptions(model).some(({ value }) => value === voice)) return;
  try {
    await AsyncStorage.setItem(storageKey(model), voice);
  } catch {
    // Preserve the current UI selection if storage is temporarily unavailable.
  }
};
