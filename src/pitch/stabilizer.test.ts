import { describe, expect, it } from "vitest";
import { PitchStabilizer, type PitchObservation } from "./stabilizer";

const observation = (stringId: PitchObservation["stringId"], cents: number): PitchObservation => ({
  frequencyHz: 440,
  confidence: 0.95,
  stringId,
  correctedFrequencyHz: 440,
  cents,
  octaveFactor: 1,
});

describe("PitchStabilizer", () => {
  it("suppresses the initial attack before exposing a result", () => {
    const tracker = new PitchStabilizer({ attackMs: 45 });
    expect(tracker.update(observation("A", 2), 0)).toBeNull();
    expect(tracker.update(observation("A", 2), 30)).toBeNull();
    expect(tracker.update(observation("A", 2), 50)?.stringId).toBe("A");
  });

  it("uses median filtering to reject an isolated cents spike", () => {
    const tracker = new PitchStabilizer({ attackMs: 0, smoothingAlpha: 1 });
    tracker.update(observation("A", 2), 0);
    tracker.update(observation("A", 2), 1);
    tracker.update(observation("A", 40), 2);
    expect(tracker.update(observation("A", 3), 3)?.cents).toBeCloseTo(3, 6);
  });

  it("requires consecutive frames before switching strings", () => {
    const tracker = new PitchStabilizer({ attackMs: 0, switchConfirmFrames: 3 });
    tracker.update(observation("A", 0), 0);
    expect(tracker.update(observation("A", 0), 1)?.stringId).toBe("A");
    expect(tracker.update(observation("E", 0), 2)?.stringId).toBe("A");
    expect(tracker.update(observation("E", 0), 3)?.stringId).toBe("A");
    expect(tracker.update(observation("E", 0), 4)?.stringId).toBe("E");
  });

  it("holds a stable result during a brief signal gap then clears it", () => {
    const tracker = new PitchStabilizer({ attackMs: 0, holdMs: 250 });
    tracker.update(observation("D", -3), 0);
    tracker.update(observation("D", -3), 1);
    expect(tracker.update(null, 200)?.signalState).toBe("decay");
    expect(tracker.update(null, 300)).toBeNull();
  });

  it("retains in-tune state inside the seven-cent hysteresis boundary", () => {
    const tracker = new PitchStabilizer({ attackMs: 0, medianWindow: 1, smoothingAlpha: 1 });
    tracker.update(observation("A", 0), 0);
    expect(tracker.update(observation("A", 0), 1)?.tuningState).toBe("in-tune");
    expect(tracker.update(observation("A", 6.5), 2)?.tuningState).toBe("in-tune");
    expect(tracker.update(observation("A", 7.5), 3)?.tuningState).toBe("high");
  });
});
