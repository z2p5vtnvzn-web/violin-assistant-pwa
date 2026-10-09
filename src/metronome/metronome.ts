export type Meter = 2 | 3 | 4 | 6;

export const MIN_BPM = 40;
export const MAX_BPM = 208;

export function clampBpm(value: number): number {
  return Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(value)));
}

export function tempoName(bpm: number): string {
  if (bpm < 60) return "广板";
  if (bpm < 76) return "慢板";
  if (bpm < 108) return "行板";
  if (bpm < 120) return "中板";
  if (bpm < 168) return "快板";
  return "急板";
}

/** Ignore an old or implausible tap and use the median of the most recent intervals. */
export function tempoFromTaps(taps: readonly number[]): number | null {
  if (taps.length < 2) return null;
  const recent = taps.slice(-6);
  const intervals = recent.slice(1).map((time, index) => time - recent[index]);
  if (intervals.some((interval) => interval < 250 || interval > 2000)) return null;
  const sorted = intervals.sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return clampBpm(60000 / median);
}

export function pendulumAngle(beatNumber: number, fraction: number): number {
  const safeFraction = Math.max(0, Math.min(1, fraction));
  return (beatNumber % 2 === 0 ? -1 : 1) * 28 * Math.cos(Math.PI * safeFraction);
}

type ScheduledBeat = { time: number; number: number };
export type MetronomeVisual = { angle: number; beatInBar: number; beatNumber: number };

/** Schedules each click against the AudioContext clock, then exposes those same times for the pointer. */
export class MetronomeEngine {
  private context: AudioContext | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private scheduled: ScheduledBeat[] = [];
  private nextBeatTime = 0;
  private nextBeatNumber = 0;
  private generation = 0;
  private bpm = 80;
  private meter: Meter = 4;
  private accentFirstBeat = true;

  get active(): boolean { return this.context?.state === "running"; }

  setSettings(bpm: number, meter: Meter, accentFirstBeat: boolean) {
    this.bpm = clampBpm(bpm);
    this.meter = meter;
    this.accentFirstBeat = accentFirstBeat;
  }

  async start(): Promise<void> {
    this.stop();
    const generation = ++this.generation;
    const context = new AudioContext({ latencyHint: "interactive" });
    this.context = context;
    try {
      await context.resume();
      if (generation !== this.generation) return;
      if (context.state !== "running") throw new Error("音频未能启动");
      this.nextBeatTime = context.currentTime + 0.06;
      this.nextBeatNumber = 0;
      this.scheduled = [];
      this.scheduleAhead();
      this.timer = setInterval(() => this.scheduleAhead(), 25);
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  stop() {
    this.generation += 1;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.scheduled = [];
    const context = this.context;
    this.context = null;
    if (context && context.state !== "closed") void context.close().catch(() => undefined);
  }

  getVisual(): MetronomeVisual | null {
    const context = this.context;
    if (!context || context.state !== "running") return null;
    const now = context.currentTime;
    let current: ScheduledBeat | undefined;
    let next: ScheduledBeat | undefined;
    for (const beat of this.scheduled) {
      if (beat.time <= now) current = beat;
      else { next = beat; break; }
    }
    if (!current) return { angle: -28, beatInBar: 0, beatNumber: -1 };
    // The next scheduled click may still use the previous tempo for one beat.
    // Follow its actual audio timestamp so the pointer never gets ahead of the sound.
    const nextTime = next?.time ?? Math.max(this.nextBeatTime, current.time + 0.01);
    const fraction = (now - current.time) / Math.max(0.01, nextTime - current.time);
    return {
      angle: pendulumAngle(current.number, fraction),
      beatInBar: current.number % this.meter,
      beatNumber: current.number,
    };
  }

  private scheduleAhead() {
    const context = this.context;
    if (!context || context.state !== "running") return;
    const now = context.currentTime;
    const interval = 60 / this.bpm;
    if (this.nextBeatTime < now - 0.1) {
      const missed = Math.ceil((now - this.nextBeatTime) / interval);
      this.nextBeatNumber += missed;
      this.nextBeatTime = now + 0.03;
      this.scheduled = [];
    }
    while (this.nextBeatTime < now + 0.16) {
      this.scheduleClick(context, this.nextBeatTime, this.nextBeatNumber);
      this.scheduled.push({ time: this.nextBeatTime, number: this.nextBeatNumber });
      this.nextBeatNumber += 1;
      this.nextBeatTime += interval;
    }
    this.scheduled = this.scheduled.filter((beat) => beat.time > now - 1.5);
  }

  private scheduleClick(context: AudioContext, time: number, beatNumber: number) {
    const accented = this.accentFirstBeat && beatNumber % this.meter === 0;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(accented ? 1320 : 980, time);
    oscillator.frequency.exponentialRampToValueAtTime(accented ? 980 : 760, time + 0.045);
    envelope.gain.setValueAtTime(0.0001, time);
    envelope.gain.exponentialRampToValueAtTime(accented ? 0.23 : 0.14, time + 0.003);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + 0.065);
    oscillator.connect(envelope).connect(context.destination);
    oscillator.start(time);
    oscillator.stop(time + 0.07);
    oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
  }
}
