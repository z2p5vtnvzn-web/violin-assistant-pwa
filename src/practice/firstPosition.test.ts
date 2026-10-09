import { describe, expect, it } from "vitest";
import { centsToFrequency } from "../tuning/violin";
import { detectPitchYin } from "../pitch/yin";
import { AutoFingerTracker, getPracticeState, getPracticeTarget, getPracticeTargets, PracticeTracker, selectPracticeTarget } from "./firstPosition";

describe("first-position practice", () => {
  it("maps all sixteen natural notes in first position", () => {
    expect(getPracticeTargets().map(({ noteName }) => noteName)).toEqual([
      "A3", "B3", "C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5", "D5", "E5", "F5", "G5", "A5", "B5",
    ]);
    expect(getPracticeTarget("A", 2).solfege).toBe("do");
    expect(getPracticeTarget("E", 1).solfege).toBe("fa");
    expect(getPracticeTarget("A", 2).targetFrequencyHz).toBeCloseTo(523.251, 2);
    expect(getPracticeTarget("E", 4).targetFrequencyHz).toBeCloseTo(987.767, 2);
    expect(getPracticeTarget("A", 2, 442).targetFrequencyHz / getPracticeTarget("A", 2).targetFrequencyHz).toBeCloseTo(442 / 440);
  });

  it("uses a separate ±10 cent tolerance with hysteresis", () => {
    expect(getPracticeState(-11)).toBe("low");
    expect(getPracticeState(-10)).toBe("in-tune");
    expect(getPracticeState(10)).toBe("in-tune");
    expect(getPracticeState(11)).toBe("high");
    expect(getPracticeState(12, "in-tune")).toBe("in-tune");
    expect(getPracticeState(13, "in-tune")).toBe("high");
    expect(getPracticeState(101)).toBe("far");
  });

  it("rejects attacks, preserves a brief decay, resets after silence or a target change", () => {
    const tracker = new PracticeTracker();
    const target = getPracticeTarget("A", 2).targetFrequencyHz;
    expect(tracker.update(target, 0.99, target, 0)).toBeNull();
    expect(tracker.update(target, 0.99, target, 50)?.state).toBe("in-tune");
    expect(tracker.update(null, 0, target, 100)?.signalState).toBe("decay");
    expect(tracker.update(null, 0, target, 400)).toBeNull();
    tracker.reset();
    expect(tracker.update(target, 0.99, target, 500)).toBeNull();
  });

  it("does not octave-correct or call a wrong note in tune", () => {
    const tracker = new PracticeTracker();
    const target = getPracticeTarget("E", 4).targetFrequencyHz;
    tracker.update(target / 2, 0.99, target, 0);
    expect(tracker.update(target / 2, 0.99, target, 50)?.state).toBe("far");
    expect(tracker.update(centsToFrequency(target, -20), 0.99, target, 100)?.state).toBe("low");
  });

  it("detects all 16 targets at 48 kHz, including the highest note at A4=466", () => {
    for (const target of getPracticeTargets(466)) {
      const signal = Float32Array.from({ length: 4096 }, (_, index) => 0.7 * Math.sin(2 * Math.PI * target.targetFrequencyHz * index / 48000));
      const detected = detectPitchYin(signal, 48000, { minFrequency: 170, maxFrequency: 1150 });
      expect(detected, target.noteName).not.toBeNull();
      expect(Math.abs(1200 * Math.log2(detected!.frequencyHz / target.targetFrequencyHz)), target.noteName).toBeLessThan(2);
    }
  });

  it("infers notes only from the selected string and leaves boundaries undecided", () => {
    const b = getPracticeTarget("A", 1).targetFrequencyHz;
    const c = getPracticeTarget("A", 2).targetFrequencyHz;
    expect(selectPracticeTarget(centsToFrequency(b, 20), "A")?.finger).toBe(1);
    expect(selectPracticeTarget(centsToFrequency(c, -20), "A")?.finger).toBe(2);
    expect(selectPracticeTarget(centsToFrequency(b, 50), "A")).toBeNull();
    expect(selectPracticeTarget(440, "A")).toBeNull(); // open A is outside the four finger targets
    expect(selectPracticeTarget(b / 2, "A")).toBeNull(); // no octave mapping
  });

  it("follows all four fingers without taps and clears an old finger during a switch", () => {
    const tracker = new AutoFingerTracker();
    let time = 0;
    for (const finger of [1, 2, 3, 4] as const) {
      const frequency = getPracticeTarget("A", finger).targetFrequencyHz;
      const first = tracker.update(frequency, 0.99, "A", 440, time);
      expect(first.target).toBeNull();
      for (let index = 0; index < 5; index += 1) {
        time += 20;
        tracker.update(frequency, 0.99, "A", 440, time);
      }
      const settled = tracker.update(frequency, 0.99, "A", 440, time + 20);
      expect(settled.target?.finger).toBe(finger);
      expect(settled.reading?.state).toBe("in-tune");
      time += 200;
    }
  });

  it("does not label an in-between or stale sound as accurate", () => {
    const tracker = new AutoFingerTracker();
    const b = getPracticeTarget("A", 1).targetFrequencyHz;
    for (const time of [0, 20, 40, 60, 80, 100]) tracker.update(b, 0.99, "A", 440, time);
    const between = centsToFrequency(b, 50);
    expect(tracker.update(between, 0.99, "A", 440, 120).reading).toBeNull();
    expect(tracker.update(between, 0.99, "A", 440, 140).phase).toBe("outside");
    expect(tracker.update(null, 0, "A", 440, 500).target).toBeNull();
  });
});
