import { useRef, useEffect } from 'react';
import type { PDFPageProxy } from 'pdfjs-dist';

interface Props {
  page: PDFPageProxy;
  bbox: { x0: number; x1: number; y0: number; y1: number };
  targetHeight: number;
}

// Render a cropped region of a PDF page into a canvas.
// Used to show the original ECG strip next to the extracted signal.
export default function PdfStrip({ page, bbox, targetHeight }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = canvasRef.current;
    const container = containerRef.current;
    if (!cv || !container || !page) return;

    let cancelled = false;

    (async () => {
      const baseVp = page.getViewport({ scale: 1 });

      const traceH = bbox.y1 - bbox.y0;
      const traceW = bbox.x1 - bbox.x0;
      const marginY = traceH * 0.4;
      const marginX = traceW * 0.03;
      const cropY0 = Math.max(0, bbox.y0 - marginY);
      const cropY1 = Math.min(baseVp.height, bbox.y1 + marginY);
      const cropX0 = Math.max(0, bbox.x0 - marginX);
      const cropX1 = Math.min(baseVp.width, bbox.x1 + marginX);
      const cropH = cropY1 - cropY0;
      const cropW = cropX1 - cropX0;

      const dpr = window.devicePixelRatio || 1;
      const cssWidth = container.clientWidth;
      const scaleFromWidth = (cssWidth * dpr) / cropW;
      const scaleFromHeight = (targetHeight * dpr) / cropH;
      const renderScale = Math.max(scaleFromWidth, scaleFromHeight);

      const vp = page.getViewport({
        scale: renderScale,
        offsetX: -cropX0 * renderScale,
        offsetY: -cropY0 * renderScale,
      });

      cv.width = Math.round(cropW * renderScale);
      cv.height = Math.round(cropH * renderScale);

      const ctx = cv.getContext('2d')!;
      ctx.clearRect(0, 0, cv.width, cv.height);

      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      if (cancelled) return;
    })();

    return () => { cancelled = true; };
  }, [page, bbox, targetHeight]);

  return (
    <div ref={containerRef} className="w-full">
      <canvas
        ref={canvasRef}
        className="w-full rounded-lg border border-white/40"
        style={{ height: `${targetHeight}px` }}
      />
    </div>
  );
}
