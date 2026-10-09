import { describe, expect, it } from "vitest";
import { clampBpm, pendulumAngle, tempoFromTaps, tempoName } from "./metronome";

describe("metronome controls", () => {
  it("keeps tempo within the supported range", () => {
    expect(clampBpm(12)).toBe(40);
    expect(clampBpm(240)).toBe(208);
    expect(clampBpm(80.6)).toBe(81);
    expect(tempoName(80)).toBe("行板");
  });

  it("computes tap tempo from recent intervals and rejects a paused sequence", () => {
    expect(tempoFromTaps([1000])).toBeNull();
    expect(tempoFromTaps([1000, 1750, 2500, 3260])).toBe(80);
    expect(tempoFromTaps([1000, 2500, 5000])).toBeNull();
  });

  it("moves the pointer between alternating extremes on the beat clock", () => {
    expect(pendulumAngle(0, 0)).toBe(-28);
    expect(Math.abs(pendulumAngle(0, 0.5))).toBeLessThan(0.001);
    expect(pendulumAngle(1, 0)).toBe(28);
    expect(pendulumAngle(1, 1)).toBe(-28);
  });
});
