// tokenUsageTracker.ts
// Tracks estimated costs for Realtime tokens or Live duration plus backend tokens.

export interface TokenUsage {
  inputText: number;
  inputAudio: number;
  outputText: number;
  outputAudio: number;
  cachedInput?: number;
  liveSeconds?: number;
  liveBackend?: {
    model: string;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
  };
}

export interface TokenTotals extends TokenUsage {
  cachedInput: number; // Make non-optional in totals since we always initialize it
  liveSeconds: number;
  voiceUSD: number;
  backendUSD: number;
  hasBackendPricing: boolean;
  totalUSD: number;
  hasPricing: boolean;
}

type PricedModel =
  | "gpt-realtime"
  | "gpt-realtime-2"
  | "gpt-realtime-2.1"
  | "gpt-realtime-mini";

interface PriceStructure {
  inputText: number;
  cachedInput: number;
  outputText: number;
  inputAudio: number;
  outputAudio: number;
}

const DEFAULT_PRICED_MODEL: PricedModel = "gpt-realtime-2";

const PRICES: Record<PricedModel, PriceStructure> = {
  "gpt-realtime": {
    inputText: 4.0 / 1_000_000,
    cachedInput: 0.4 / 1_000_000,
    outputText: 16.0 / 1_000_000,
    inputAudio: 32.0 / 1_000_000,
    outputAudio: 64.0 / 1_000_000,
  },
  "gpt-realtime-2": {
    inputText: 4.0 / 1_000_000,
    cachedInput: 0.4 / 1_000_000,
    outputText: 24.0 / 1_000_000,
    inputAudio: 32.0 / 1_000_000,
    outputAudio: 64.0 / 1_000_000,
  },
  "gpt-realtime-2.1": {
    inputText: 4.0 / 1_000_000,
    cachedInput: 0.4 / 1_000_000,
    outputText: 24.0 / 1_000_000,
    inputAudio: 32.0 / 1_000_000,
    outputAudio: 64.0 / 1_000_000,
  },
  "gpt-realtime-mini": {
    inputText: 0.6 / 1_000_000,
    cachedInput: 0.06 / 1_000_000,
    outputText: 2.4 / 1_000_000,
    inputAudio: 10.0 / 1_000_000,
    outputAudio: 20.0 / 1_000_000,
  },
};

export class TokenUsageTracker {
  private model: string;
  private totals: TokenTotals;

  constructor(model: string = DEFAULT_PRICED_MODEL) {
    this.model = model;
    this.totals = this.createEmptyTotals();
  }

  static hasPricingForModel(model: string): boolean {
    return model === "gpt-live-1" || Object.prototype.hasOwnProperty.call(PRICES, model);
  }

  hasPricing(): boolean {
    return TokenUsageTracker.hasPricingForModel(this.model);
  }

  setModel(model: string): void {
    this.model = model;
  }

  /** Call this with each onTokenUsage event payload */
  addUsage(usage: TokenUsage): TokenTotals {
    if (this.model === "gpt-live-1") return this.addLiveUsage(usage);
    this.totals.inputText += usage.inputText;
    this.totals.inputAudio += usage.inputAudio;
    this.totals.outputText += usage.outputText;
    this.totals.outputAudio += usage.outputAudio;
    this.totals.cachedInput += usage.cachedInput ?? 0;

    const p = this.getPriceStructure();
    this.totals.hasPricing = p !== undefined;
    if (!p) return { ...this.totals };

    const cost =
      this.totals.inputText * p.inputText +
      this.totals.cachedInput * p.cachedInput +
      this.totals.outputText * p.outputText +
      this.totals.inputAudio * p.inputAudio +
      this.totals.outputAudio * p.outputAudio;

    this.totals.totalUSD = parseFloat(cost.toFixed(6));

    return { ...this.totals };
  }

  private addLiveUsage(usage: TokenUsage): TokenTotals {
    if (usage.liveSeconds !== undefined && Number.isFinite(usage.liveSeconds)) {
      // Live reports cumulative seconds; later and final snapshots replace the estimate.
      this.totals.liveSeconds = Math.max(0, usage.liveSeconds);
      this.totals.voiceUSD = this.totals.liveSeconds / 60 * 0.05;
    }
    const backend = usage.liveBackend;
    if (backend) {
      if (backend.model === "gpt-5.6-terra") {
        // https://developers.openai.com/api/docs/models/gpt-5.6-terra
        const longContext = backend.inputTokens > 272_000;
        const cached = Math.min(backend.inputTokens, backend.cachedInputTokens);
        this.totals.inputText += backend.inputTokens - cached;
        this.totals.cachedInput += cached;
        this.totals.outputText += backend.outputTokens;
        this.totals.backendUSD += (
          ((backend.inputTokens - cached) * 2 + cached * 0.2) * (longContext ? 2 : 1)
          + backend.outputTokens * 12 * (longContext ? 1.5 : 1)
        ) / 1_000_000;
      } else {
        this.totals.hasBackendPricing = false;
      }
    }
    // An unknown backend makes the displayed estimate voice-only, never Realtime-priced.
    this.totals.totalUSD = this.totals.voiceUSD +
      (this.totals.hasBackendPricing ? this.totals.backendUSD : 0);
    return { ...this.totals };
  }

  /** Reset totals — call at start of a new WebRTC session */
  reset() {
    this.totals = this.createEmptyTotals();
  }

  private createEmptyTotals(): TokenTotals {
    return {
      inputText: 0,
      inputAudio: 0,
      outputText: 0,
      outputAudio: 0,
      cachedInput: 0,
      liveSeconds: 0,
      voiceUSD: 0,
      backendUSD: 0,
      hasBackendPricing: true,
      totalUSD: 0,
      hasPricing: this.hasPricing(),
    };
  }

  private getPriceStructure(): PriceStructure | undefined {
    if (Object.prototype.hasOwnProperty.call(PRICES, this.model)) {
      return PRICES[this.model as PricedModel];
    }
    return undefined;
  }
}
