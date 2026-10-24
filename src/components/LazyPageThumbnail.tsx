import React, { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { PageSpec } from '../types';
import { renderPageThumbnail } from '../utils/pdfThumbnails';

interface LazyPageThumbnailProps {
  page: PageSpec;
  originalPdfBuffer: ArrayBuffer;
  placeholderUrl?: string;
  rotationDeg: number;
  pageNumber: number;
}

/**
 * A lightweight placeholder stays in the grid. JPEG previews are rendered only
 * near the modal viewport and released when they leave it. The shared PDF
 * thumbnail cache retains at most 64 recently generated page previews.
 */
export const LazyPageThumbnail: React.FC<LazyPageThumbnailProps> = ({
  page, originalPdfBuffer, placeholderUrl, rotationDeg, pageNumber,
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [thumbnail, setThumbnail] = useState<string | null>(null);

  useEffect(() => {
    const element = hostRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => {
      setVisible(entry.isIntersecting);
    }, { rootMargin: '350px 0px', threshold: 0 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || page.source === 'blank') {
      setThumbnail(null);
      return;
    }
    let cancelled = false;
    const data = page.source === 'imported' ? page.sourceBuffer : originalPdfBuffer;
    const pageIndex = page.source === 'imported'
      ? (page.sourceDocPageIndex ?? -1) + 1
      : page.originalPageIndex + 1;
    if (!data || pageIndex < 1) return;
    renderPageThumbnail(data, pageIndex, 180)
      .then((url) => { if (!cancelled) setThumbnail(url); })
      .catch((err) => {
        if (!cancelled) console.warn('Could not render page thumbnail:', err);
      });
    return () => { cancelled = true; };
  }, [visible, page.source, page.sourceBuffer, page.sourceDocPageIndex, page.originalPageIndex, originalPdfBuffer]);

  const displayUrl = visible ? (page.source === 'blank' ? placeholderUrl : thumbnail) : undefined;
  return (
    <div
      ref={hostRef}
      className="relative max-h-full max-w-full flex items-center justify-center transition-transform duration-200"
      style={{ transform: `rotate(${rotationDeg}deg)` }}
    >
      {displayUrl ? (
        <img
          src={displayUrl}
          alt={`Vorschau Seite ${pageNumber}`}
          className="max-h-[170px] max-w-[130px] sm:max-h-[190px] sm:max-w-[150px] object-contain rounded-sm shadow-xs border border-slate-200 bg-white"
        />
      ) : (
        <div className="h-36 w-24 rounded border border-dashed border-slate-300 flex flex-col items-center justify-center bg-white text-slate-400 gap-1">
          {visible && page.source !== 'blank' && <Loader2 className="w-5 h-5 animate-spin text-blue-500" />}
          <span className="text-[10px]">{visible ? 'Vorschau...' : `Seite ${pageNumber}`}</span>
        </div>
      )}
    </div>
  );
};
