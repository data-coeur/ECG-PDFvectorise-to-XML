// types — types partagés entre la pipeline d'extraction (lib/ecg-extract/),
// les composants React et les utilitaires. On y trouve à la fois les types
// "domaine" (Point, Polyline, Layout, ScaleInfo, GridInfo, ECGData, ECGChannel)
// et "UI" (BatchItem, FormatInfo, ServerResponse).
// Raison : un seul fichier d'imports pour tout ce qui circule entre modules.

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
  type: 'stacked_12x1' | 'sequential_6x2' | 'grid_4x3';
  /** Which coordinate axis carries time (the other carries voltage). */
  timeAxis: 'x' | 'y';
  /** When true, smaller value-axis coordinates correspond to higher voltage
   *  (i.e. the y-axis grows downward in the PDF, as in pdfjs's viewport). */
  verticalInverted: boolean;
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
  bbox?: { x0: number; x1: number; y0: number; y1: number };
}

export interface GridInfo {
  spacingX: number;
  spacingY: number;
  hLines: number[];
  vLines: number[];
  // Major (5 mm) grid lines, identified by a thicker stroke width when the
  // PDF distinguishes minor and major lines that way. Used as snap targets
  // for baseline detection when no calibration pulse is available.
  hMajorLines?: number[];
  vMajorLines?: number[];
}

export interface ECGData {
  manufacturer: string;
  layout: string;
  filename: string;
  page_size: { width: number; height: number };
  scale: { mm_per_s: number; mm_per_mV: number; pts_per_mm: number };
  grid: GridInfo;
  channels: ECGChannel[];
  /** True when the source PDF provided a dedicated long rhythm strip channel
   *  (e.g. Mortara 12+1). False when lead II was cloned to fabricate one. */
  hasNativeRhythm: boolean;
  /** Clockwise rotation (degrees) the extractor applied to rectify the page so
   *  time runs left-to-right. The original PDF must be rendered with the same
   *  rotation to match the extracted/rendered image orientation. */
  rotation?: 0 | 90 | 180 | 270;
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

// Batch processing — one entry per dropped file.
export interface BatchItem {
  id: string;
  file: File;
  status: 'queued' | 'detecting' | 'extracting' | 'done' | 'error';
  ecgData: ECGData | null;
  error: string | null;
  warning: string | null;
}
