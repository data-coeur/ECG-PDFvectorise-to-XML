import fs from 'fs';

interface Channel { name: string }

// Higher resolution than the GE MUSE default (4.88 µV/bit) to preserve fine
// baseline noise on low-amplitude leads (e.g. lead III with ~0.16 mV peaks).
// At 0.5 µV/bit, the int16 range is ±32767 × 0.5 / 1000 = ±16.4 mV — well above
// any clinical ECG amplitude, while giving 10× the resolution of the MUSE default.
const GAIN_UV_PER_BIT = 0.5;

/**
 * Write a GE MUSE-style RestingECG XML.
 *
 * Used as input for the Python rendering pipeline (ecgmind_raw2paper).
 * The python parser expects this exact structure:
 *   <RestingECG>
 *     <Waveform>
 *       <WaveformType>Rhythm</WaveformType>
 *       <LeadData>
 *         <LeadID>I</LeadID>
 *         <LeadAmplitudeUnitsPerBit>4.88</LeadAmplitudeUnitsPerBit>
 *         <WaveFormData>{base64 little-endian int16}</WaveFormData>
 *       </LeadData>
 *       ...
 *     </Waveform>
 *   </RestingECG>
 *
 * Each lead's samples are encoded as base64 of int16 little-endian, with values in
 * (mV / gain) such that decoding produces the original mV when multiplied back by gain/1000.
 */
/**
 * @param nSamplesPerCh — number of samples per channel. Either:
 *   - a single number (all channels have the same sample count, legacy)
 *   - an array of numbers (one per channel — used when the rhythm strip
 *     has a different duration than the standard 12 leads)
 */
export function writeMuseXml(
  channels: Channel[],
  resampled: number[][],
  nSamplesPerCh: number | number[],
  sr: number,
  filename: string,
): void {
  const lines: string[] = [];
  const w = (s: string) => lines.push(s);

  w('<?xml version="1.0" encoding="UTF-8"?>');
  w('<RestingECG>');
  w(`  <SampleBase>${sr}</SampleBase>`);
  w('  <Waveform>');
  w('    <WaveformType>Rhythm</WaveformType>');
  w(`    <SampleBase>${sr}</SampleBase>`);

  const getSampleCount = (i: number): number => {
    if (Array.isArray(nSamplesPerCh)) return nSamplesPerCh[i] ?? 0;
    return nSamplesPerCh;
  };

  for (let i = 0; i < channels.length; i++) {
    const samples = resampled[i] || [];
    const nSamples = getSampleCount(i);
    const buf = Buffer.alloc(nSamples * 2);
    for (let j = 0; j < nSamples; j++) {
      // Convert mV → ADC units. value_int16 = mV * 1000 / gain_uV_per_bit
      const adc = Math.round((samples[j] || 0) * 1000 / GAIN_UV_PER_BIT);
      const clamped = Math.max(-32768, Math.min(32767, adc));
      buf.writeInt16LE(clamped, j * 2);
    }
    const b64 = buf.toString('base64');

    w('    <LeadData>');
    w(`      <LeadID>${channels[i].name}</LeadID>`);
    w(`      <LeadAmplitudeUnitsPerBit>${GAIN_UV_PER_BIT}</LeadAmplitudeUnitsPerBit>`);
    w('      <LeadAmplitudeUnits>MICROVOLTS</LeadAmplitudeUnits>');
    w(`      <LeadSampleCountTotal>${nSamples}</LeadSampleCountTotal>`);
    w(`      <WaveFormData>${b64}</WaveFormData>`);
    w('    </LeadData>');
  }

  w('  </Waveform>');
  w('</RestingECG>');

  fs.writeFileSync(filename, lines.join('\n'), 'utf-8');
}
