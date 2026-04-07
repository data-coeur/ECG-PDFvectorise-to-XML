import fs from 'fs';

interface Channel { name: string }

// Default gain matching standard GE MUSE: 4.88 µV per ADC bit (16-bit signed int).
const GAIN_UV_PER_BIT = 4.88;

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
export function writeMuseXml(
  channels: Channel[],
  resampled: number[][],
  nSamples: number,
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

  for (let i = 0; i < channels.length; i++) {
    const samples = resampled[i] || [];
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
