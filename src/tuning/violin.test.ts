import { describe, expect, it } from "vitest";
import {
  centsToFrequency,
  frequencyToCents,
  getTuningState,
  getViolinStrings,
  selectCandidateForString,
  selectViolinCandidate,
} from "./violin";

describe("violin tuning model", () => {
  it("uses the standard G-D-A-E frequencies at A4=440", () => {
    const strings = getViolinStrings();
    expect(strings.map((item) => item.id)).toEqual(["G", "D", "A", "E"]);
    expect(strings[0].frequencyHz).toBeCloseTo(196, 2);
    expect(strings[1].frequencyHz).toBeCloseTo(293.6648, 3);
    expect(strings[2].frequencyHz).toBe(440);
    expect(strings[3].frequencyHz).toBeCloseTo(659.2551, 3);
  });

  it("round-trips cents and frequency", () => {
    const frequency = centsToFrequency(440, -23.5);
    expect(frequencyToCents(frequency, 440)).toBeCloseTo(-23.5, 8);
  });

  it("applies the ±5 cent state boundary and ±7 cent hysteresis", () => {
    expect(getTuningState(-5)).toBe("in-tune");
    expect(getTuningState(5)).toBe("in-tune");
    expect(getTuningState(-5.1)).toBe("low");
    expect(getTuningState(5.1)).toBe("high");
    expect(getTuningState(6.9, "in-tune")).toBe("in-tune");
    expect(getTuningState(7.1, "in-tune")).toBe("high");
  });

  it("maps a strong second harmonic back to the intended string", () => {
    const candidate = selectViolinCandidate(getViolinStrings()[0].frequencyHz * 2);
    expect(candidate?.string.id).toBe("G");
    expect(candidate?.octaveFactor).toBe(0.5);
    expect(candidate?.cents).toBeCloseTo(0, 6);
  });

  it("prefers an uncorrected fundamental when it already matches", () => {
    const candidate = selectViolinCandidate(440);
    expect(candidate?.string.id).toBe("A");
    expect(candidate?.octaveFactor).toBe(1);
  });

  it("rejects frequencies too far from every valid candidate", () => {
    expect(selectViolinCandidate(130, 440, 100)).toBeNull();
  });

  it("locks candidate mapping to a manually selected string", () => {
    expect(selectCandidateForString(440, "A")?.string.id).toBe("A");
    expect(selectCandidateForString(440, "E", 440, 100)).toBeNull();
  });
});
