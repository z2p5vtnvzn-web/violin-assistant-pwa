import { frequencyToCents, type ViolinStringId } from "../tuning/violin";

export type Finger = 1 | 2 | 3 | 4;
export type PracticeState = "low" | "in-tune" | "high" | "far";

type Definition = { stringId: ViolinStringId; finger: Finger; midiNote: number; noteName: string; solfege: string; hint: string };
export type PracticeTarget = Definition & { targetFrequencyHz: number };

const DEFINITIONS: readonly Definition[] = [
  { stringId: "G", finger: 1, midiNote: 57, noteName: "A3", solfege: "la", hint: "1 指" },
  { stringId: "G", finger: 2, midiNote: 59, noteName: "B3", solfege: "si", hint: "高 2 指" },
  { stringId: "G", finger: 3, midiNote: 60, noteName: "C4", solfege: "do", hint: "3 指" },
  { stringId: "G", finger: 4, midiNote: 62, noteName: "D4", solfege: "re", hint: "4 指" },
  { stringId: "D", finger: 1, midiNote: 64, noteName: "E4", solfege: "mi", hint: "1 指" },
  { stringId: "D", finger: 2, midiNote: 65, noteName: "F4", solfege: "fa", hint: "低 2 指" },
  { stringId: "D", finger: 3, midiNote: 67, noteName: "G4", solfege: "sol", hint: "3 指" },
  { stringId: "D", finger: 4, midiNote: 69, noteName: "A4", solfege: "la", hint: "4 指" },
  { stringId: "A", finger: 1, midiNote: 71, noteName: "B4", solfege: "si", hint: "1 指" },
  { stringId: "A", finger: 2, midiNote: 72, noteName: "C5", solfege: "do", hint: "低 2 指" },
  { stringId: "A", finger: 3, midiNote: 74, noteName: "D5", solfege: "re", hint: "3 指" },
  { stringId: "A", finger: 4, midiNote: 76, noteName: "E5", solfege: "mi", hint: "4 指" },
  { stringId: "E", finger: 1, midiNote: 77, noteName: "F5", solfege: "fa", hint: "低 1 指" },
  { stringId: "E", finger: 2, midiNote: 79, noteName: "G5", solfege: "sol", hint: "低 2 指" },
  { stringId: "E", finger: 3, midiNote: 81, noteName: "A5", solfege: "la", hint: "3 指" },
  { stringId: "E", finger: 4, midiNote: 83, noteName: "B5", solfege: "si", hint: "4 指" },
];

export function getPracticeTargets(referenceA4 = 440): PracticeTarget[] {
  if (!Number.isFinite(referenceA4) || referenceA4 < 415 || referenceA4 > 466) throw new RangeError("A4 reference must be between 415 and 466 Hz");
  return DEFINITIONS.map((target) => ({ ...target, targetFrequencyHz: referenceA4 * 2 ** ((target.midiNote - 69) / 12) }));
}

export function getPracticeTarget(stringId: ViolinStringId, finger: Finger, referenceA4 = 440): PracticeTarget {
  const target = getPracticeTargets(referenceA4).find((item) => item.stringId === stringId && item.finger === finger);
  if (!target) throw new Error("Unknown practice target");
  return target;
}

export function getPracticeState(cents: number, previous?: PracticeState): PracticeState {
  if (!Number.isFinite(cents) || Math.abs(cents) > 100) return "far";
  if (previous === "in-tune" && Math.abs(cents) <= 12) return "in-tune";
  if (cents < -10) return "low";
  if (cents > 10) return "high";
  return "in-tune";
}

export type PracticeReading = { frequencyHz: number; confidence: number; cents: number; state: PracticeState; signalState: "tracking" | "decay" };

export type AutoPracticeResult = {
  target: PracticeTarget | null;
  reading: PracticeReading | null;
  phase: "listening" | "acquiring" | "outside" | "tracking";
};

/** Pick the closest natural note while leaving a small undecided region between neighbors. */
export function selectPracticeTarget(frequencyHz: number, stringId: ViolinStringId, referenceA4 = 440): PracticeTarget | null {
  if (!Number.isFinite(frequencyHz) || frequencyHz <= 0) return null;
  const candidates = getPracticeTargets(referenceA4)
    .filter((target) => target.stringId === stringId)
    .map((target) => ({ target, distance: Math.abs(frequencyToCents(frequencyHz, target.targetFrequencyHz)) }))
    .sort((left, right) => left.distance - right.distance);
  return candidates[0]?.distance <= 90 && (!candidates[1] || candidates[1].distance - candidates[0].distance >= 15)
    ? candidates[0].target : null;
}

export class AutoFingerTracker {
  private readonly pitch = new PracticeTracker();
  private lockedFinger: Finger | null = null;
  private pendingFinger: Finger | null = null;
  private pendingFrames = 0;
  private outsideFrames = 0;

  reset() {
    this.pitch.reset();
    this.lockedFinger = null;
    this.pendingFinger = null;
    this.pendingFrames = 0;
    this.outsideFrames = 0;
  }

  update(frequencyHz: number | null, confidence: number, stringId: ViolinStringId, referenceA4: number, timestampMs: number): AutoPracticeResult {
    if (frequencyHz === null || confidence < 0.75) {
      if (this.lockedFinger !== null) {
        const target = getPracticeTarget(stringId, this.lockedFinger, referenceA4);
        const reading = this.pitch.update(null, 0, target.targetFrequencyHz, timestampMs);
        if (reading) return { target, reading, phase: "tracking" };
      }
      this.reset();
      return { target: null, reading: null, phase: "listening" };
    }

    const candidate = selectPracticeTarget(frequencyHz, stringId, referenceA4);
    if (!candidate) {
      this.outsideFrames = Math.min(2, this.outsideFrames + 1);
      if (this.outsideFrames >= 2) {
        this.pitch.reset();
        this.lockedFinger = null;
        this.pendingFinger = null;
        this.pendingFrames = 0;
        return { target: null, reading: null, phase: "outside" };
      }
      return { target: null, reading: null, phase: "acquiring" };
    }
    this.outsideFrames = 0;

    if (candidate.finger !== this.lockedFinger) {
      if (this.pendingFinger === candidate.finger) this.pendingFrames += 1;
      else { this.pendingFinger = candidate.finger; this.pendingFrames = 1; }
      if (this.pendingFrames < 3) return { target: null, reading: null, phase: "acquiring" };
      this.lockedFinger = candidate.finger;
      this.pendingFinger = null;
      this.pendingFrames = 0;
      this.pitch.reset();
    } else {
      this.pendingFinger = null;
      this.pendingFrames = 0;
    }

    const reading = this.pitch.update(frequencyHz, confidence, candidate.targetFrequencyHz, timestampMs);
    return { target: candidate, reading, phase: reading ? "tracking" : "acquiring" };
  }
}

export class PracticeTracker {
  private attackAt: number | null = null;
  private lastValidAt: number | null = null;
  private history: number[] = [];
  private smoothed: number | null = null;
  private last: PracticeReading | null = null;

  reset() { this.attackAt = null; this.lastValidAt = null; this.history = []; this.smoothed = null; this.last = null; }

  update(frequencyHz: number | null, confidence: number, targetFrequencyHz: number, timestampMs: number): PracticeReading | null {
    const cents = frequencyHz === null ? Number.NaN : frequencyToCents(frequencyHz, targetFrequencyHz);
    if (!Number.isFinite(cents) || confidence < 0.75) {
      if (this.last && this.lastValidAt !== null && timestampMs - this.lastValidAt <= 250) return { ...this.last, signalState: "decay" };
      this.reset();
      return null;
    }
    this.lastValidAt = timestampMs;
    if (this.attackAt === null) this.attackAt = timestampMs;
    if (timestampMs - this.attackAt < 45) return null;

    // A wrong note must not drag the previous target's smooth reading toward "in tune".
    if (Math.abs(cents) > 100) {
      this.history = [];
      this.smoothed = null;
      this.last = { frequencyHz: frequencyHz!, confidence, cents, state: "far", signalState: "tracking" };
      return this.last;
    }
    if (this.last?.state === "far") { this.history = []; this.smoothed = null; }
    this.history.push(cents);
    if (this.history.length > 5) this.history.shift();
    const sorted = [...this.history].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    this.smoothed = this.smoothed === null ? median : this.smoothed + 0.38 * (median - this.smoothed);
    this.last = { frequencyHz: frequencyHz!, confidence, cents: this.smoothed, state: getPracticeState(this.smoothed, this.last?.state), signalState: "tracking" };
    return this.last;
  }
}
