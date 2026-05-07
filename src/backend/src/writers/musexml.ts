// musexml — sérialise les canaux ECG en XML "GE MUSE RestingECG", le format
// d'entrée attendu par le pipeline Python ecgmind_raw2paper. Les samples mV
// sont encodés en base64 d'int16 little-endian, avec une résolution de
// 0.5 µV/bit (10× la default MUSE, préserve le bruit de baseline fin).
// Appelé par routes/render-image avant l'invocation du script matplotlib.

import fs from 'fs';

interface Channel { name: string }

// Résolution plus fine que le default MUSE (4.88 µV/bit) pour préserver le
// bruit de baseline sur les leads à faible amplitude (ex. lead III ~0.16 mV).
// À 0.5 µV/bit, le range int16 vaut ±32767 × 0.5 / 1000 = ±16.4 mV, bien
// au-dessus de toute amplitude ECG clinique tout en gagnant 10× la résolution.
const GAIN_UV_PER_BIT = 0.5;

/**
 * Structure XML produite (extrait) :
 *   <RestingECG>
 *     <Waveform>
 *       <WaveformType>Rhythm</WaveformType>
 *       <LeadData>
 *         <LeadID>I</LeadID>
 *         <LeadAmplitudeUnitsPerBit>0.5</LeadAmplitudeUnitsPerBit>
 *         <WaveFormData>{base64 int16-LE}</WaveFormData>
 *       </LeadData>
 *       ...
 *     </Waveform>
 *   </RestingECG>
 *
 * @param samplesPerChannel  Soit un seul nombre (tous canaux pareil), soit
 *   un tableau (un par canal — utilisé quand le rhythm strip est plus long
 *   que les 12 leads standards).
 */
export function writeMuseXml(
  channels: Channel[],
  resampled: number[][],
  samplesPerChannel: number | number[],
  sampleRate: number,
  filename: string,
): void {
  const lines: string[] = [];
  const writeLine = (s: string) => lines.push(s);

  writeLine('<?xml version="1.0" encoding="UTF-8"?>');
  writeLine('<RestingECG>');
  writeLine(`  <SampleBase>${sampleRate}</SampleBase>`);
  writeLine('  <Waveform>');
  writeLine('    <WaveformType>Rhythm</WaveformType>');
  writeLine(`    <SampleBase>${sampleRate}</SampleBase>`);

  const getSampleCount = (i: number): number => {
    if (Array.isArray(samplesPerChannel)) return samplesPerChannel[i] ?? 0;
    return samplesPerChannel;
  };

  for (let i = 0; i < channels.length; i++) {
    const samples = resampled[i] || [];
    const sampleCount = getSampleCount(i);
    const buf = Buffer.alloc(sampleCount * 2);
    for (let j = 0; j < sampleCount; j++) {
      // Convert mV → ADC units. value_int16 = mV * 1000 / gain_uV_per_bit
      const adc = Math.round((samples[j] || 0) * 1000 / GAIN_UV_PER_BIT);
      const clamped = Math.max(-32768, Math.min(32767, adc));
      buf.writeInt16LE(clamped, j * 2);
    }
    const b64 = buf.toString('base64');

    writeLine('    <LeadData>');
    writeLine(`      <LeadID>${channels[i].name}</LeadID>`);
    writeLine(`      <LeadAmplitudeUnitsPerBit>${GAIN_UV_PER_BIT}</LeadAmplitudeUnitsPerBit>`);
    writeLine('      <LeadAmplitudeUnits>MICROVOLTS</LeadAmplitudeUnits>');
    writeLine(`      <LeadSampleCountTotal>${sampleCount}</LeadSampleCountTotal>`);
    writeLine(`      <WaveFormData>${b64}</WaveFormData>`);
    writeLine('    </LeadData>');
  }

  writeLine('  </Waveform>');
  writeLine('</RestingECG>');

  fs.writeFileSync(filename, lines.join('\n'), 'utf-8');
}
