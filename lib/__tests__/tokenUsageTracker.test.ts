import { describe, expect, test } from "bun:test";
import { TokenUsageTracker, type TokenUsage } from "../tokenUsageTracker";

const empty: TokenUsage = { inputText: 0, outputText: 0, inputAudio: 0, outputAudio: 0 };

describe("session cost estimates", () => {
  test("Live replaces cumulative seconds, including final usage", () => {
    const tracker = new TokenUsageTracker("gpt-live-1");
    tracker.addUsage({ ...empty, liveSeconds: 15 });
    tracker.addUsage({ ...empty, liveSeconds: 45 });
    const totals = tracker.addUsage({ ...empty, liveSeconds: 60 });
    expect(totals.liveSeconds).toBe(60);
    expect(totals.totalUSD).toBeCloseTo(0.05, 8);
  });
  test("Live adds Terra input, cached input and output without double counting cache", () => {
    const tracker = new TokenUsageTracker("gpt-live-1");
    tracker.addUsage({ ...empty, liveSeconds: 60 });
    const backend = { model: "gpt-5.6-terra", inputTokens: 1000, cachedInputTokens: 400, outputTokens: 100 };
    tracker.addUsage({ ...empty, liveBackend: backend });
    const totals = tracker.addUsage({ ...empty, liveBackend: backend });
    expect(totals.backendUSD).toBeCloseTo(0.00496, 8);
    expect(totals.totalUSD).toBeCloseTo(0.05496, 8);
    expect(totals.hasBackendPricing).toBe(true);
  });
  test("Terra long-context multiplier is applied per backend request", () => {
    const tracker = new TokenUsageTracker("gpt-live-1");
    const totals = tracker.addUsage({ ...empty, liveBackend: {
      model: "gpt-5.6-terra", inputTokens: 300_000, cachedInputTokens: 100_000, outputTokens: 1000,
    } });
    expect(totals.backendUSD).toBeCloseTo(0.858, 8);
  });
  test("unknown backend prices leave a clearly incomplete voice-only estimate", () => {
    const tracker = new TokenUsageTracker("gpt-live-1");
    const totals = tracker.addUsage({ ...empty, liveSeconds: 120, liveBackend: {
      model: "future-backend", inputTokens: 1000, cachedInputTokens: 0, outputTokens: 100,
    } });
    expect(totals.hasPricing).toBe(true);
    expect(totals.hasBackendPricing).toBe(false);
    expect(totals.totalUSD).toBeCloseTo(0.1, 8);
  });
  test("unknown voice models have no assumed prices", () => {
    const tracker = new TokenUsageTracker("future-model");
    const totals = tracker.addUsage({ ...empty, inputText: 1000 });
    expect(TokenUsageTracker.hasPricingForModel("future-model")).toBe(false);
    expect(totals.hasPricing).toBe(false);
    expect(totals.totalUSD).toBe(0);
  });
  test("existing Realtime 2.1 pricing is preserved", () => {
    const tracker = new TokenUsageTracker("gpt-realtime-2.1");
    const totals = tracker.addUsage({ inputText: 1000, inputAudio: 1000, outputText: 1000, outputAudio: 1000 });
    expect(totals.totalUSD).toBeCloseTo(0.124, 8);
  });
  test("reset clears Live cost before switching back to Realtime", () => {
    const tracker = new TokenUsageTracker("gpt-live-1");
    tracker.addUsage({ ...empty, liveSeconds: 120 });
    tracker.setModel("gpt-realtime-2");
    tracker.reset();
    const totals = tracker.addUsage(empty);
    expect(totals.liveSeconds).toBe(0);
    expect(totals.totalUSD).toBe(0);
    expect(totals.hasPricing).toBe(true);
  });
});
