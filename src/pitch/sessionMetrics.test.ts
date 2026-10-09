import { describe, expect, it, vi } from "vitest";
import { PitchSessionMetrics } from "./sessionMetrics";
import type { StablePitch } from "./stabilizer";

const stable = (stringId: StablePitch["stringId"], cents: number, confidence = 0.9): StablePitch => ({
  frequencyHz: 440,
  confidence,
  stringId,
  correctedFrequencyHz: 440,
  cents,
  octaveFactor: 1,
  tuningState: "in-tune",
  signalState: "tracking",
});

describe("PitchSessionMetrics", () => {
  it("summarizes valid rate, performance and per-string stability", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-18T10:00:00Z"));
    const metrics = new PitchSessionMetrics();
    metrics.record({ rawValid: true, stable: stable("A", -2, 0.8), analysisMs: 1 });
    metrics.record({ rawValid: true, stable: stable("A", 0, 0.9), analysisMs: 2 });
    metrics.record({ rawValid: false, stable: null, analysisMs: 3 });
    metrics.record({ rawValid: true, stable: stable("A", 2, 1), analysisMs: 4 });
    vi.setSystemTime(new Date("2026-09-18T10:00:10Z"));

    const summary = metrics.finish();
    expect(summary.durationSeconds).toBe(10);
    expect(summary.rawValidRate).toBe(0.75);
    expect(summary.analysisMs.median).toBe(2);
    expect(summary.analysisMs.p95).toBe(4);
    expect(summary.strings.A?.medianCents).toBe(0);
    expect(summary.strings.A?.medianConfidence).toBe(0.9);
    expect(summary.strings.A?.centsStdDev).toBeCloseTo(Math.sqrt(8 / 3), 6);
    vi.useRealTimers();
  });

  it("counts stable string switches but ignores decay holds", () => {
    const metrics = new PitchSessionMetrics();
    metrics.record({ rawValid: true, stable: stable("G", 0), analysisMs: 1 });
    metrics.record({ rawValid: true, stable: { ...stable("G", 0), signalState: "decay" }, analysisMs: 1 });
    metrics.record({ rawValid: true, stable: stable("D", 0), analysisMs: 1 });
    expect(metrics.finish().stringSwitches).toBe(1);
  });
});
