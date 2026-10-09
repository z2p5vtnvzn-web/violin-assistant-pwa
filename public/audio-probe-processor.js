class AudioProbeProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frameCount = 0;
    this.sumSquares = 0;
    this.sampleCount = 0;
    this.peak = 0;
    this.windowSize = 4096;
    this.hopSize = 1024;
    this.ring = new Float32Array(this.windowSize);
    this.writeIndex = 0;
    this.totalSamples = 0;
    this.samplesSinceWindow = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel || channel.length === 0) return true;

    for (let index = 0; index < channel.length; index += 1) {
      const sample = channel[index];
      this.sumSquares += sample * sample;
      this.sampleCount += 1;
      this.peak = Math.max(this.peak, Math.abs(sample));
      this.ring[this.writeIndex] = sample;
      this.writeIndex = (this.writeIndex + 1) % this.windowSize;
      this.totalSamples += 1;
      this.samplesSinceWindow += 1;
    }

    this.frameCount += 1;
    if (this.frameCount >= 12) {
      this.port.postMessage({
        type: "level",
        rms: Math.sqrt(this.sumSquares / Math.max(1, this.sampleCount)),
        peak: this.peak,
        sampleRate,
        currentFrame,
        currentTime,
      });
      this.frameCount = 0;
      this.sumSquares = 0;
      this.sampleCount = 0;
      this.peak = 0;
    }

    if (this.totalSamples >= this.windowSize && this.samplesSinceWindow >= this.hopSize) {
      const snapshot = new Float32Array(this.windowSize);
      const tailLength = this.windowSize - this.writeIndex;
      snapshot.set(this.ring.subarray(this.writeIndex), 0);
      snapshot.set(this.ring.subarray(0, this.writeIndex), tailLength);
      this.port.postMessage(
        {
          type: "samples",
          samples: snapshot,
          sampleRate,
          capturedAt: currentTime,
        },
        [snapshot.buffer],
      );
      this.samplesSinceWindow = 0;
    }
    return true;
  }
}

registerProcessor("audio-probe-processor", AudioProbeProcessor);
