import { beforeEach, describe, expect, mock, test } from "bun:test";

const storage = new Map<string, string>();
let storageFails = false;
mock.module("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => {
      if (storageFails) throw new Error("Storage unavailable");
      return storage.get(key) ?? null;
    },
    setItem: async (key: string, value: string) => {
      if (storageFails) throw new Error("Storage unavailable");
      storage.set(key, value);
    },
  },
}));

const {
  DEFAULT_REALTIME_MODEL, REALTIME_MODEL_OPTIONS, isLiveModel,
  loadRealtimeModelPreference, saveRealtimeModelPreference,
} = await import("../realtimeModelPreference");
const { DEFAULT_VOICE, DEFAULT_LIVE_VOICE, loadVoicePreference, saveVoicePreference } = await import("../voicePreference");
const { getVoiceOptions } = await import("../voiceOptions");

beforeEach(() => { storage.clear(); storageFails = false; });

const modelKey = "@vibemachine/realtimeModelPreference";
describe("voice model preferences", () => {
  test("new installations use the rollout default without persisting an explicit choice", async () => {
    expect(await loadRealtimeModelPreference()).toBe(DEFAULT_REALTIME_MODEL);
    expect(storage.has(modelKey)).toBe(false);
  });
  for (const { value } of REALTIME_MODEL_OPTIONS) {
    test(`retains the explicit ${value} selection`, async () => {
      await saveRealtimeModelPreference(value);
      expect(storage.get(modelKey)).toBe(value);
      expect(await loadRealtimeModelPreference()).toBe(value);
    });
  }
  test("invalid saved models fall back without overwriting storage", async () => {
    storage.set(modelKey, "unsupported-model");
    expect(await loadRealtimeModelPreference()).toBe(DEFAULT_REALTIME_MODEL);
    expect(storage.get(modelKey)).toBe("unsupported-model");
  });
  test("storage failures use the default", async () => {
    storageFails = true;
    expect(await loadRealtimeModelPreference()).toBe(DEFAULT_REALTIME_MODEL);
    await expect(saveRealtimeModelPreference("gpt-live-1")).resolves.toBeUndefined();
  });
  test("Live routing excludes existing Realtime models", () => {
    expect(isLiveModel("gpt-live-1")).toBe(true);
    for (const model of ["gpt-realtime", "gpt-realtime-2", "gpt-realtime-2.1"]) {
      expect(isLiveModel(model)).toBe(false);
    }
  });
});

describe("voices saved per model family", () => {
  test("uses cedar for Realtime and arbor for Live", async () => {
    expect(await loadVoicePreference("gpt-realtime-2")).toBe(DEFAULT_VOICE);
    expect(await loadVoicePreference("gpt-live-1")).toBe(DEFAULT_LIVE_VOICE);
  });
  test("preserves the existing Realtime storage key", async () => {
    storage.set("@vibemachine/voicePreference", "marin");
    expect(await loadVoicePreference("gpt-realtime-2.1")).toBe("marin");
    expect(await loadVoicePreference("gpt-live-1")).toBe(DEFAULT_LIVE_VOICE);
  });
  test("switching families retains both choices and shares all Realtime choices", async () => {
    await saveVoicePreference("gpt-realtime-2", "cedar");
    await saveVoicePreference("gpt-live-1", "willow");
    expect(await loadVoicePreference("gpt-realtime-2.1")).toBe("cedar");
    await saveVoicePreference("gpt-realtime", "marin");
    expect(await loadVoicePreference("gpt-live-1")).toBe("willow");
    expect(await loadVoicePreference("gpt-realtime-2")).toBe("marin");
    expect(storage.get("@vibemachine/liveVoicePreference")).toBe("willow");
  });
  test("rejects values from the wrong family and removed voices", async () => {
    storage.set("@vibemachine/voicePreference", "arbor");
    storage.set("@vibemachine/liveVoicePreference", "removed-voice");
    expect(await loadVoicePreference("gpt-realtime-2")).toBe(DEFAULT_VOICE);
    expect(await loadVoicePreference("gpt-live-1")).toBe(DEFAULT_LIVE_VOICE);
    await saveVoicePreference("gpt-live-1", "cedar");
    expect(storage.get("@vibemachine/liveVoicePreference")).toBe("removed-voice");
  });
  test("storage failure retains valid family defaults", async () => {
    storageFails = true;
    expect(await loadVoicePreference("gpt-live-1")).toBe(DEFAULT_LIVE_VOICE);
    expect(await loadVoicePreference("gpt-realtime")).toBe(DEFAULT_VOICE);
    await expect(saveVoicePreference("gpt-live-1", "willow")).resolves.toBeUndefined();
  });
  test("picker options contain the family default and exclude the other family", () => {
    const live = getVoiceOptions("gpt-live-1").map(({ value }) => value);
    const realtime = getVoiceOptions("gpt-realtime-2.1").map(({ value }) => value);
    expect(live).toContain(DEFAULT_LIVE_VOICE);
    expect(live).not.toContain("cedar");
    expect(realtime).toContain(DEFAULT_VOICE);
    expect(realtime).not.toContain("arbor");
  });
});
