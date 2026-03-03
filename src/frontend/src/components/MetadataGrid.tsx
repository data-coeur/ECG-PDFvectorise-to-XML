import type { ECGData } from '../lib/types';

interface Props { data: ECGData }

export default function MetadataGrid({ data }: Props) {
  const items: [string, string | number][] = [
    ['Fabricant', data.manufacturer],
    ['Layout', data.layout],
    ['Canaux', data.channels.length],
    ['Échelle', `${data.scale.mm_per_s}mm/s · ${data.scale.mm_per_mV}mm/mV`],
  ];
  return (
    <div className="mg">
      {items.map(([k, v]) => (
        <div key={k} className="mi">
          <div className="k">{k}</div>
          <div className="v">{v}</div>
        </div>
      ))}
    </div>
  );
}
