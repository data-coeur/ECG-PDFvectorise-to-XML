// signal-resample — helpers de manipulation de durée et de SampleBase pour
// les canaux ECG reçus du frontend, avant écriture XML par les writers.
// In  : Channel[] (avec samples + duration_s + sample_rate_hz).
// Out : channels reshapés + métadonnées agrégées (sampleRate, durée max…).
// Appelé par routes/convert et routes/render-image.

export interface Channel {
  name: string;
  samples: number[];
  duration_s: number;
  sample_rate_hz: number;
}

/**
 * Reshape one channel so it covers exactly `target` seconds.
 *   - target < source : truncate to the first `target × sampleRate` samples
 *   - target > source : concatenate the channel with itself enough times to
 *                       cover the target, then truncate to the exact length
 *   - target ≈ source : passthrough
 *
 * The Python renderer reads the XML duration and picks the page format from
 * it (≤ 4 s → 3x4+1, ≤ 8 s → 6x2+1, else 12x1).
 */
export function fitChannelToDuration(channel: Channel, target: number): Channel {
  const sourceLen = channel.samples.length;
  if (sourceLen === 0 || channel.duration_s <= 0) return channel;
  if (Math.abs(target - channel.duration_s) < 1e-3) return channel;
  const sampleRate = sourceLen / channel.duration_s;
  const targetLen = Math.max(1, Math.round(target * sampleRate));
  let samples: number[];
  if (targetLen <= sourceLen) {
    samples = channel.samples.slice(0, targetLen);
  } else {
    samples = new Array(targetLen);
    for (let i = 0; i < targetLen; i++) samples[i] = channel.samples[i % sourceLen];
  }
  return { ...channel, samples, duration_s: target };
}

/**
 * Pass channels through unchanged. The frontend already produces samples at
 * the optimal rate for each channel (uniform PDFs → preserved as-is,
 * non-uniform → resampled to 500 Hz). Resampling here would only smooth or
 * distort the data.
 *
 * We pick the highest sample rate found across channels as the "global"
 * SampleBase used by the Python renderer to compute the time axis.
 * Per-channel sample counts are preserved via samplesPerChannelArray.
 */
export function resample(channels: Channel[]) {
  let maxDuration = 0;
  let sourceRate = 0;
  for (const channel of channels) {
    if (channel.duration_s > maxDuration) maxDuration = channel.duration_s;
    if (channel.sample_rate_hz > sourceRate) sourceRate = channel.sample_rate_hz;
  }
  if (maxDuration <= 0) maxDuration = 10;
  const sampleRate = sourceRate > 0 ? sourceRate : 500;

  const resampled: number[][] = channels.map(c => [...c.samples]);
  const samplesPerChannelArray: number[] = channels.map(c => c.samples.length);
  const samplesPerChannel = Math.max(...samplesPerChannelArray);
  return { resampled, sampleRate, samplesPerChannel, samplesPerChannelArray, maxDuration };
}
