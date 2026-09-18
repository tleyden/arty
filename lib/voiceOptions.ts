import { isLiveModel } from "./realtimeModelPreference";

export type VoiceOption = {
  value: string;
  label: string;
  description: string;
};

export const REALTIME_VOICES: VoiceOption[] = [
  { value: "alloy", label: "Alloy", description: "Balanced, clear (improved)" },
  { value: "ash", label: "Ash", description: "Warm, friendly (improved)" },
  {
    value: "ballad",
    label: "Ballad",
    description: "Smooth, melodic (improved)",
  },
  {
    value: "coral",
    label: "Coral",
    description: "Vibrant, energetic (improved)",
  },
  {
    value: "echo",
    label: "Echo",
    description: "Calm, professional (improved)",
  },
  {
    value: "sage",
    label: "Sage",
    description: "Thoughtful, steady (improved)",
  },
  {
    value: "shimmer",
    label: "Shimmer",
    description: "Bright, cheerful (improved)",
  },
  {
    value: "verse",
    label: "Verse",
    description: "Expressive, dynamic (improved)",
  },
  {
    value: "cedar",
    label: "Cedar",
    description: "Natural, grounded (Realtime only)",
  },
  {
    value: "marin",
    label: "Marin",
    description: "Expressive, conversational (Realtime only)",
  },
];

// Live voice catalog: https://developers.openai.com/api/docs/guides/live-conversations
// Arbor remains subject to the real-device acceptance gate in the rollout plan.
export const LIVE_VOICES: VoiceOption[] = [
  { value: "arbor", label: "Arbor", description: "Default Live voice" },
  { value: "quartz", label: "Quartz", description: "Australian, feminine" },
  { value: "ripple", label: "Ripple", description: "Australian, masculine" },
  { value: "vesper", label: "Vesper", description: "British, masculine" },
  { value: "willow", label: "Willow", description: "Irish, feminine" },
  { value: "stone", label: "Stone", description: "Irish, masculine" },
  { value: "gleam", label: "Gleam", description: "North American, feminine" },
  { value: "meridian", label: "Meridian", description: "North American, masculine" },
  { value: "bossa", label: "Bossa", description: "Brazilian Portuguese, feminine" },
  { value: "tempo", label: "Tempo", description: "Brazilian Portuguese, masculine" },
  { value: "beacon", label: "Beacon", description: "Filipino, masculine" },
  { value: "delta", label: "Delta", description: "Southern U.S., feminine" },
  { value: "cinder", label: "Cinder", description: "Southern U.S., masculine" },
];

export const getVoiceOptions = (model: string): VoiceOption[] =>
  isLiveModel(model) ? LIVE_VOICES : REALTIME_VOICES;
