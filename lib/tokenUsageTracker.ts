// tokenUsageTracker.ts
// Tracks cumulative token usage + estimated cost for an OpenAI Realtime session.

export interface TokenUsage {
  inputText: number;
  inputAudio: number;
  outputText: number;
  outputAudio: number;
  cachedInput?: number;
}

export interface TokenTotals extends TokenUsage {
  cachedInput: number; // Make non-optional in totals since we always initialize it
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

  constructor(model = DEFAULT_PRICED_MODEL) {
    this.model = model;
    this.totals = this.createEmptyTotals();
  }

  static hasPricingForModel(_model: string): boolean {
    return true;
  }

  hasPricing(): boolean {
    return TokenUsageTracker.hasPricingForModel(this.model);
  }

  setModel(model: string): void {
    this.model = model;
  }

  /** Call this with each onTokenUsage event payload */
  addUsage(usage: TokenUsage): TokenTotals {
    this.totals.inputText += usage.inputText;
    this.totals.inputAudio += usage.inputAudio;
    this.totals.outputText += usage.outputText;
    this.totals.outputAudio += usage.outputAudio;
    this.totals.cachedInput += usage.cachedInput ?? 0;

    const p = this.getPriceStructure();
    this.totals.hasPricing = true;

    const cost =
      this.totals.inputText * p.inputText +
      this.totals.cachedInput * p.cachedInput +
      this.totals.outputText * p.outputText +
      this.totals.inputAudio * p.inputAudio +
      this.totals.outputAudio * p.outputAudio;

    this.totals.totalUSD = parseFloat(cost.toFixed(6));

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
      totalUSD: 0,
      hasPricing: this.hasPricing(),
    };
  }

  private getPriceStructure(): PriceStructure {
    if (Object.prototype.hasOwnProperty.call(PRICES, this.model)) {
      return PRICES[this.model as PricedModel];
    }
    return PRICES[DEFAULT_PRICED_MODEL];
  }
}
