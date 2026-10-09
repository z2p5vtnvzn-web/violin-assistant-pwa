import { describe, expect, it } from "vitest";
import { centsToFrequency, getViolinStrings } from "../tuning/violin";
import { detectPitchYin } from "./yin";

const SAMPLE_RATE = 48_000;
const WINDOW_SIZE = 4096;

function makeSignal(
  frequencyHz: number,
  options: { harmonics?: number[]; noise?: number; decay?: number } = {},
): Float32Array {
  const harmonics = options.harmonics ?? [1];
  let randomState = 0x12345678;
  const random = () => {
    randomState = (1664525 * randomState + 1013904223) >>> 0;
    return randomState / 0xffffffff;
  };
  const result = new Float32Array(WINDOW_SIZE);
  for (let index = 0; index < result.length; index += 1) {
    const time = index / SAMPLE_RATE;
    const envelope = options.decay ? Math.exp(-options.decay * time) : 1;
    let sample = 0;
    for (let harmonic = 0; harmonic < harmonics.length; harmonic += 1) {
      sample += harmonics[harmonic] * Math.sin(2 * Math.PI * frequencyHz * (harmonic + 1) * time + harmonic * 0.17);
    }
    sample *= envelope / Math.max(1, harmonics.reduce((sum, value) => sum + Math.abs(value), 0));
    sample += ((random() * 2) - 1) * (options.noise ?? 0);
    result[index] = sample * 0.8;
  }
  return result;
}

function centsError(actual: number, expected: number) {
  return 1200 * Math.log2(actual / expected);
}

describe("detectPitchYin", () => {
  for (const violinString of getViolinStrings()) {
    it(`detects ${violinString.note} within one cent`, () => {
      const result = detectPitchYin(makeSignal(violinString.frequencyHz), SAMPLE_RATE);
      expect(result).not.toBeNull();
      expect(Math.abs(centsError(result!.frequencyHz, violinString.frequencyHz))).toBeLessThan(1);
      expect(result!.confidence).toBeGreaterThan(0.9);
    });
  }

  it("tracks detuned frequencies instead of snapping to a note", () => {
    const target = getViolinStrings()[2].frequencyHz;
    const detuned = centsToFrequency(target, -20);
    const result = detectPitchYin(makeSignal(detuned), SAMPLE_RATE);
    expect(result).not.toBeNull();
    expect(Math.abs(centsError(result!.frequencyHz, detuned))).toBeLessThan(1);
  });

  it("finds the fundamental when upper harmonics are stronger", () => {
    const target = getViolinStrings()[0].frequencyHz;
    const result = detectPitchYin(makeSignal(target, { harmonics: [0.18, 1, 0.62, 0.35] }), SAMPLE_RATE);
    expect(result).not.toBeNull();
    expect(Math.abs(centsError(result!.frequencyHz, target))).toBeLessThan(1.5);
  });

  it("handles a decaying plucked-string envelope with light noise", () => {
    const target = getViolinStrings()[1].frequencyHz;
    const result = detectPitchYin(makeSignal(target, { harmonics: [1, 0.7, 0.35], noise: 0.006, decay: 8 }), SAMPLE_RATE);
    expect(result).not.toBeNull();
    expect(Math.abs(centsError(result!.frequencyHz, target))).toBeLessThan(2);
  });

  it("rejects silence", () => {
    expect(detectPitchYin(new Float32Array(WINDOW_SIZE), SAMPLE_RATE)).toBeNull();
  });
});
