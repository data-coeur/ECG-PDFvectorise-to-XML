export interface Point { x: number; y: number }

export interface Polyline {
  pts: Point[];
  col: number[];
  w: number;
  bb?: BoundingBox;
}

export interface BoundingBox {
  x0: number; x1: number; y0: number; y1: number;
  cx: number; cy: number; dx: number; dy: number;
}

export interface Label { text: string; x: number; y: number }

export interface Layout {
  type: 'stacked_12x1' | 'sequential_6x2';
  tA: 'x' | 'y';
  vI: boolean;
}

export interface ScaleInfo {
  pmm: number; pps: number; ppv: number;
  pmmX: number; pmmY: number;
}

export interface ECGChannel {
  name: string;
  samples: number[];
  duration_s: number;
  sample_rate_hz: number;
  voltage_unit: string;
  time_unit: string;
}

export interface ECGData {
  manufacturer: string;
  layout: string;
  filename: string;
  page_size: { width: number; height: number };
  scale: { mm_per_s: number; mm_per_mV: number; pts_per_mm: number };
  channels: ECGChannel[];
}

export interface ServerResponse {
  success: boolean;
  base?: string;
  files?: Record<string, string>;
  info?: {
    manufacturer: string;
    layout: string;
    channels: number;
    sample_rate: number;
    duration: number;
  };
  error?: string;
}

export interface FormatInfo {
  label: string;
  badge: 'std' | 'med' | 'img';
  badgeText: string;
  desc: string;
}
