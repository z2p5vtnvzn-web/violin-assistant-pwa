export type YinOptions = {
  minFrequency?: number;
  maxFrequency?: number;
  threshold?: number;
  minConfidence?: number;
};

export type PitchResult = {
  frequencyHz: number;
  confidence: number;
  periodSamples: number;
};

const DEFAULT_OPTIONS: Required<YinOptions> = {
  minFrequency: 170,
  maxFrequency: 720,
  threshold: 0.12,
  minConfidence: 0.75,
};

/**
 * Estimate the fundamental frequency of one mono PCM window with YIN.
 * This function is allocation-light apart from its per-call difference buffer
 * and has no browser dependencies, so it can run in an AudioWorklet or tests.
 */
export function detectPitchYin(
  samples: Float32Array,
  sampleRate: number,
  options: YinOptions = {},
): PitchResult | null {
  const config = { ...DEFAULT_OPTIONS, ...options };
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || samples.length < 32) return null;
  if (config.minFrequency <= 0 || config.maxFrequency <= config.minFrequency) return null;

  const tauMin = Math.max(2, Math.floor(sampleRate / config.maxFrequency));
  const tauMax = Math.min(Math.floor(sampleRate / config.minFrequency), Math.floor(samples.length / 2));
  if (tauMax <= tauMin + 1) return null;

  let mean = 0;
  for (let index = 0; index < samples.length; index += 1) mean += samples[index];
  mean /= samples.length;

  let energy = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const centered = samples[index] - mean;
    energy += centered * centered;
  }
  if (energy / samples.length < 1e-8) return null;

  const difference = new Float64Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau += 1) {
    let sum = 0;
    const limit = samples.length - tauMax;
    for (let index = 0; index < limit; index += 1) {
      const delta = (samples[index] - mean) - (samples[index + tau] - mean);
      sum += delta * delta;
    }
    difference[tau] = sum;
  }

  difference[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau <= tauMax; tau += 1) {
    runningSum += difference[tau];
    difference[tau] = runningSum > 0 ? (difference[tau] * tau) / runningSum : 1;
  }

  let selectedTau = -1;
  for (let tau = tauMin; tau <= tauMax; tau += 1) {
    if (difference[tau] >= config.threshold) continue;
    while (tau + 1 <= tauMax && difference[tau + 1] < difference[tau]) tau += 1;
    selectedTau = tau;
    break;
  }

  if (selectedTau < 0) {
    let bestValue = Number.POSITIVE_INFINITY;
    for (let tau = tauMin; tau <= tauMax; tau += 1) {
      if (difference[tau] < bestValue) {
        bestValue = difference[tau];
        selectedTau = tau;
      }
    }
  }

  if (selectedTau <= 0) return null;
  const confidence = Math.max(0, Math.min(1, 1 - difference[selectedTau]));
  if (confidence < config.minConfidence) return null;

  const refinedTau = parabolicMinimum(difference, selectedTau);
  const frequencyHz = sampleRate / refinedTau;
  if (frequencyHz < config.minFrequency || frequencyHz > config.maxFrequency) return null;

  return { frequencyHz, confidence, periodSamples: refinedTau };
}

function parabolicMinimum(values: Float64Array, index: number): number {
  if (index <= 0 || index >= values.length - 1) return index;
  const left = values[index - 1];
  const center = values[index];
  const right = values[index + 1];
  const denominator = left - 2 * center + right;
  if (Math.abs(denominator) < 1e-12) return index;
  const offset = 0.5 * (left - right) / denominator;
  return index + Math.max(-1, Math.min(1, offset));
}
