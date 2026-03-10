import { useRef, useEffect, useState } from 'react';
import { pdfjsLib } from '../lib/pdf-config';

interface Props { file: File }

export default function PdfPreview({ file }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const data = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data }).promise;
      const page = await pdf.getPage(1);
      if (cancelled) return;
      const scale = 2;
      const vp = page.getViewport({ scale });
      const cv = canvasRef.current!;
      cv.width = vp.width;
      cv.height = vp.height;
      await page.render({ canvasContext: cv.getContext('2d')!, viewport: vp }).promise;
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [file]);

  return (
    <div className="relative">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-primary" />
        </div>
      )}
      <canvas ref={canvasRef} className="w-full rounded-lg border border-white/40" />
    </div>
  );
}
