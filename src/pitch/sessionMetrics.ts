import type { StablePitch } from "./stabilizer";
import type { ViolinStringId } from "../tuning/violin";

type StringSamples = {
  confidence: number[];
  cents: number[];
};

export type StringSessionSummary = {
  samples: number;
  medianConfidence: number;
  medianCents: number;
  centsStdDev: number;
};

export type PitchSessionSummary = {
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  totalWindows: number;
  rawValidWindows: number;
  rawValidRate: number;
  stableTrackingWindows: number;
  stringSwitches: number;
  analysisMs: {
    median: number;
    p95: number;
    max: number;
  };
  strings: Partial<Record<ViolinStringId, StringSessionSummary>>;
};

export class PitchSessionMetrics {
  private readonly startedAtDate = new Date();
  private totalWindows = 0;
  private rawValidWindows = 0;
  private stableTrackingWindows = 0;
  private stringSwitches = 0;
  private lastString: ViolinStringId | null = null;
  private analysisTimes: number[] = [];
  private readonly strings = new Map<ViolinStringId, StringSamples>();

  record(input: { rawValid: boolean; stable: StablePitch | null; analysisMs: number }) {
    this.totalWindows += 1;
    if (input.rawValid) this.rawValidWindows += 1;
    this.analysisTimes.push(input.analysisMs);

    if (!input.stable || input.stable.signalState !== "tracking") return;
    this.stableTrackingWindows += 1;
    if (this.lastString && this.lastString !== input.stable.stringId) this.stringSwitches += 1;
    this.lastString = input.stable.stringId;

    const samples = this.strings.get(input.stable.stringId) ?? { confidence: [], cents: [] };
    samples.confidence.push(input.stable.confidence);
    samples.cents.push(input.stable.cents);
    this.strings.set(input.stable.stringId, samples);
  }

  finish(endedAtDate = new Date()): PitchSessionSummary {
    const strings: PitchSessionSummary["strings"] = {};
    for (const [stringId, samples] of this.strings) {
      strings[stringId] = {
        samples: samples.cents.length,
        medianConfidence: median(samples.confidence),
        medianCents: median(samples.cents),
        centsStdDev: standardDeviation(samples.cents),
      };
    }

    return {
      startedAt: this.startedAtDate.toISOString(),
      endedAt: endedAtDate.toISOString(),
      durationSeconds: Math.max(0, (endedAtDate.getTime() - this.startedAtDate.getTime()) / 1000),
      totalWindows: this.totalWindows,
      rawValidWindows: this.rawValidWindows,
      rawValidRate: this.totalWindows > 0 ? this.rawValidWindows / this.totalWindows : 0,
      stableTrackingWindows: this.stableTrackingWindows,
      stringSwitches: this.stringSwitches,
      analysisMs: {
        median: percentile(this.analysisTimes, 0.5),
        p95: percentile(this.analysisTimes, 0.95),
        max: this.analysisTimes.length ? Math.max(...this.analysisTimes) : 0,
      },
      strings,
    };
  }
}

function median(values: number[]) {
  return percentile(values, 0.5);
}

function percentile(values: number[], fraction: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
}

function standardDeviation(values: number[]) {
  if (values.length < 2) return 0;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}
