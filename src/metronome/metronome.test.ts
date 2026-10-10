import { describe, expect, it, vi } from "vitest";
import { clampBpm, MetronomeEngine, pendulumAngle, tempoFromTaps, tempoName } from "./metronome";

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

  it.each([[0, 0.88], [1, 0.56]])("gives beat %i an audible click without clipping", (beat, peak) => {
    const gains: Array<[string, number, number]> = [];
    const envelope = {
      gain: {
        setValueAtTime: (value: number, time: number) => gains.push(["set", value, time]),
        linearRampToValueAtTime: (value: number, time: number) => gains.push(["linear", value, time]),
        exponentialRampToValueAtTime: (value: number, time: number) => gains.push(["exponential", value, time]),
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    const oscillator = {
      frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(() => envelope),
      start: vi.fn(),
      stop: vi.fn(),
      disconnect: vi.fn(),
    };
    const context = {
      createOscillator: () => oscillator,
      createGain: () => envelope,
      destination: {},
    } as unknown as AudioContext;
    const engine = new MetronomeEngine();
    Reflect.get(engine, "scheduleClick").call(engine, context, 5, beat);

    expect(gains).toContainEqual(["linear", peak, 5.003]);
    expect(gains.at(-1)).toEqual(["exponential", 0.0001, 5.11]);
    expect(Math.max(...gains.map(([, value]) => value))).toBeLessThan(1);
    expect(oscillator.stop).toHaveBeenCalledWith(5.115);
  });
});
