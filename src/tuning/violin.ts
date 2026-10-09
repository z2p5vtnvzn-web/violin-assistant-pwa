export type ViolinStringId = "G" | "D" | "A" | "E";
export type TuningState = "low" | "in-tune" | "high";

export type ViolinString = {
  id: ViolinStringId;
  note: string;
  midiNote: number;
  frequencyHz: number;
};

export type ViolinCandidate = {
  string: ViolinString;
  detectedFrequencyHz: number;
  correctedFrequencyHz: number;
  octaveFactor: 0.5 | 1 | 2;
  cents: number;
  score: number;
};

const STRING_DEFINITIONS: ReadonlyArray<Omit<ViolinString, "frequencyHz">> = [
  { id: "G", note: "G3", midiNote: 55 },
  { id: "D", note: "D4", midiNote: 62 },
  { id: "A", note: "A4", midiNote: 69 },
  { id: "E", note: "E5", midiNote: 76 },
];

export function getViolinStrings(referenceA4 = 440): ViolinString[] {
  if (!Number.isFinite(referenceA4) || referenceA4 < 415 || referenceA4 > 466) {
    throw new RangeError("A4 reference must be between 415 and 466 Hz");
  }
  return STRING_DEFINITIONS.map((definition) => ({
    ...definition,
    frequencyHz: referenceA4 * 2 ** ((definition.midiNote - 69) / 12),
  }));
}

export function frequencyToCents(frequencyHz: number, targetFrequencyHz: number): number {
  if (frequencyHz <= 0 || targetFrequencyHz <= 0) return Number.NaN;
  return 1200 * Math.log2(frequencyHz / targetFrequencyHz);
}

export function centsToFrequency(targetFrequencyHz: number, cents: number): number {
  return targetFrequencyHz * 2 ** (cents / 1200);
}

export function getTuningState(cents: number, current?: TuningState): TuningState {
  if (current === "in-tune" && Math.abs(cents) <= 7) return "in-tune";
  if (cents < -5) return "low";
  if (cents > 5) return "high";
  return "in-tune";
}

/**
 * Map a raw detector result onto one of the four violin strings while checking
 * the common half/double-frequency alternatives. Octave corrections receive a
 * small penalty so an equally good raw fundamental always wins.
 */
export function selectViolinCandidate(
  detectedFrequencyHz: number,
  referenceA4 = 440,
  maxDistanceCents = 300,
): ViolinCandidate | null {
  if (!Number.isFinite(detectedFrequencyHz) || detectedFrequencyHz <= 0) return null;
  const strings = getViolinStrings(referenceA4);
  const octaveFactors = [1, 0.5, 2] as const;
  let best: ViolinCandidate | null = null;

  for (const octaveFactor of octaveFactors) {
    const correctedFrequencyHz = detectedFrequencyHz * octaveFactor;
    for (const string of strings) {
      const cents = frequencyToCents(correctedFrequencyHz, string.frequencyHz);
      const correctionPenalty = octaveFactor === 1 ? 0 : 24;
      const score = Math.abs(cents) + correctionPenalty;
      if (!best || score < best.score) {
        best = {
          string,
          detectedFrequencyHz,
          correctedFrequencyHz,
          octaveFactor,
          cents,
          score,
        };
      }
    }
  }

  return best && Math.abs(best.cents) <= maxDistanceCents ? best : null;
}

export function selectCandidateForString(
  detectedFrequencyHz: number,
  stringId: ViolinStringId,
  referenceA4 = 440,
  maxDistanceCents = 300,
): ViolinCandidate | null {
  if (!Number.isFinite(detectedFrequencyHz) || detectedFrequencyHz <= 0) return null;
  const string = getViolinStrings(referenceA4).find((item) => item.id === stringId);
  if (!string) return null;
  const octaveFactors = [1, 0.5, 2] as const;
  let best: ViolinCandidate | null = null;

  for (const octaveFactor of octaveFactors) {
    const correctedFrequencyHz = detectedFrequencyHz * octaveFactor;
    const cents = frequencyToCents(correctedFrequencyHz, string.frequencyHz);
    const correctionPenalty = octaveFactor === 1 ? 0 : 24;
    const score = Math.abs(cents) + correctionPenalty;
    if (!best || score < best.score) {
      best = { string, detectedFrequencyHz, correctedFrequencyHz, octaveFactor, cents, score };
    }
  }

  return best && Math.abs(best.cents) <= maxDistanceCents ? best : null;
}
