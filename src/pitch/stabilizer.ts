import { getTuningState, type TuningState, type ViolinStringId } from "../tuning/violin";

export type SignalState = "attack" | "tracking" | "decay";

export type PitchObservation = {
  frequencyHz: number;
  confidence: number;
  stringId: ViolinStringId;
  correctedFrequencyHz: number;
  cents: number;
  octaveFactor: 0.5 | 1 | 2;
};

export type StablePitch = PitchObservation & {
  signalState: SignalState;
  tuningState: TuningState;
};

export type PitchStabilizerOptions = {
  attackMs?: number;
  holdMs?: number;
  medianWindow?: number;
  smoothingAlpha?: number;
  switchConfirmFrames?: number;
};

const DEFAULTS: Required<PitchStabilizerOptions> = {
  attackMs: 45,
  holdMs: 250,
  medianWindow: 5,
  smoothingAlpha: 0.38,
  switchConfirmFrames: 3,
};

export class PitchStabilizer {
  private readonly options: Required<PitchStabilizerOptions>;
  private attackStartedAt: number | null = null;
  private lastValidAt: number | null = null;
  private lockedString: ViolinStringId | null = null;
  private pendingString: ViolinStringId | null = null;
  private pendingCount = 0;
  private centsHistory: number[] = [];
  private smoothedCents: number | null = null;
  private tuningState: TuningState | undefined;
  private lastOutput: StablePitch | null = null;

  constructor(options: PitchStabilizerOptions = {}) {
    this.options = { ...DEFAULTS, ...options };
  }

  reset() {
    this.attackStartedAt = null;
    this.lastValidAt = null;
    this.lockedString = null;
    this.pendingString = null;
    this.pendingCount = 0;
    this.centsHistory = [];
    this.smoothedCents = null;
    this.tuningState = undefined;
    this.lastOutput = null;
  }

  update(observation: PitchObservation | null, timestampMs: number): StablePitch | null {
    if (!observation) return this.handleMissing(timestampMs);

    this.lastValidAt = timestampMs;
    if (this.attackStartedAt === null) {
      this.attackStartedAt = timestampMs;
      this.pendingString = observation.stringId;
      this.pendingCount = 1;
      return null;
    }

    if (timestampMs - this.attackStartedAt < this.options.attackMs) {
      this.trackPendingString(observation.stringId);
      return null;
    }

    if (this.lockedString === null) {
      this.lockedString = this.pendingString ?? observation.stringId;
      this.pendingString = null;
      this.pendingCount = 0;
    }

    if (observation.stringId !== this.lockedString) {
      this.trackPendingString(observation.stringId);
      if (this.pendingCount < this.options.switchConfirmFrames) {
        return this.lastOutput ? { ...this.lastOutput, signalState: "tracking" } : null;
      }
      this.lockedString = observation.stringId;
      this.pendingString = null;
      this.pendingCount = 0;
      this.centsHistory = [];
      this.smoothedCents = null;
      this.tuningState = undefined;
    } else {
      this.pendingString = null;
      this.pendingCount = 0;
    }

    this.centsHistory.push(observation.cents);
    if (this.centsHistory.length > this.options.medianWindow) this.centsHistory.shift();
    const medianCents = median(this.centsHistory);
    this.smoothedCents = this.smoothedCents === null
      ? medianCents
      : this.smoothedCents + this.options.smoothingAlpha * (medianCents - this.smoothedCents);
    this.tuningState = getTuningState(this.smoothedCents, this.tuningState);

    this.lastOutput = {
      ...observation,
      cents: this.smoothedCents,
      tuningState: this.tuningState,
      signalState: "tracking",
    };
    return this.lastOutput;
  }

  private handleMissing(timestampMs: number): StablePitch | null {
    if (this.lastOutput && this.lastValidAt !== null && timestampMs - this.lastValidAt <= this.options.holdMs) {
      return { ...this.lastOutput, signalState: "decay" };
    }
    this.reset();
    return null;
  }

  private trackPendingString(stringId: ViolinStringId) {
    if (this.pendingString === stringId) {
      this.pendingCount += 1;
    } else {
      this.pendingString = stringId;
      this.pendingCount = 1;
    }
  }
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}
