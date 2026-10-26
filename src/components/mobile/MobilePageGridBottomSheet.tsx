import React, { useEffect, useState, useRef } from 'react';
import { X, Layers, Loader2, ArrowUpToLine } from 'lucide-react';
import { PdfDocumentState } from '../../types';
import { renderPageThumbnail } from '../../utils/pdfThumbnails';

interface MobilePageGridBottomSheetProps {
  isOpen: boolean;
  pdfState: PdfDocumentState;
  currentPage: number;
  onClose: () => void;
  onSelectPage: (pageNumber: number) => void;
  onOpenFullPageManager?: () => void;
}

const ThumbnailCard: React.FC<{
  pageNumber: number;
  isCurrent: boolean;
  arrayBuffer: ArrayBuffer | null;
  onSelect: () => void;
  cardRef?: (node: HTMLButtonElement | null) => void;
}> = ({ pageNumber, isCurrent, arrayBuffer, onSelect, cardRef }) => {
  const hostRef = useRef<HTMLButtonElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Lazy render thumbnails only when card enters or nears the viewport
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
        }
      },
      { rootMargin: '250px 0px', threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isVisible || !arrayBuffer) return;
    let cancelled = false;
    setIsLoading(true);

    renderPageThumbnail(arrayBuffer, pageNumber, 160)
      .then((url) => {
        if (!cancelled) {
          setThumbUrl(url);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn(`Could not render thumbnail for page ${pageNumber}:`, err);
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isVisible, arrayBuffer, pageNumber]);

  return (
    <button
      ref={(node) => {
        hostRef.current = node;
        if (cardRef) cardRef(node);
      }}
      type="button"
      onClick={onSelect}
      className={`group relative flex flex-col items-center p-2 rounded-2xl transition-all cursor-pointer ${
        isCurrent
          ? 'bg-blue-50 ring-2 ring-blue-600 shadow-md scale-[1.02]'
          : 'bg-slate-50 hover:bg-slate-100 border border-slate-200/70 shadow-2xs active:scale-98'
      }`}
    >
      <div className="w-full aspect-[1/1.414] bg-white rounded-lg overflow-hidden border border-slate-200 flex items-center justify-center relative shadow-xs">
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt={`Seite ${pageNumber}`}
            className="w-full h-full object-contain animate-in fade-in duration-150"
            loading="lazy"
          />
        ) : (
          <div className="flex flex-col items-center justify-center p-2 text-slate-400 gap-1">
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
            ) : (
              <span className="text-[11px] font-mono text-slate-400">P.{pageNumber}</span>
            )}
          </div>
        )}
      </div>

      <div className="mt-1.5 flex items-center gap-1">
        <span
          className={`text-[11px] font-mono font-medium ${
            isCurrent ? 'text-blue-700 font-bold' : 'text-slate-600'
          }`}
        >
          Seite {pageNumber}
        </span>
        {isCurrent && (
          <span className="w-1.5 h-1.5 rounded-full bg-blue-600" />
        )}
      </div>
    </button>
  );
};

export const MobilePageGridBottomSheet: React.FC<MobilePageGridBottomSheetProps> = ({
  isOpen,
  pdfState,
  currentPage,
  onClose,
  onSelectPage,
  onOpenFullPageManager,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const activeCardNodeRef = useRef<HTMLButtonElement | null>(null);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Scroll to current page upon opening so the user immediately sees the active page
  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      if (activeCardNodeRef.current) {
        activeCardNodeRef.current.scrollIntoView({ block: 'center', behavior: 'auto' });
      }
    }, 60);
    return () => clearTimeout(timer);
  }, [isOpen, currentPage]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-Up Sheet */}
      <div
        className="relative z-10 w-full max-h-[78vh] flex flex-col bg-white rounded-t-3xl shadow-2xl border-t border-slate-200 animate-in slide-in-from-bottom duration-250 ease-out"
        style={{
          paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 1rem))',
        }}
      >
        {/* Handle pill */}
        <div className="w-12 h-1.5 bg-slate-300 rounded-full mx-auto mt-3 mb-1 shrink-0" />

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 shrink-0 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-sm font-semibold text-slate-900 truncate">
              Seitenübersicht
            </h2>
            <span className="text-xs font-mono font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 shrink-0">
              {pdfState.numPages} {pdfState.numPages === 1 ? 'Seite' : 'Seiten'}
            </span>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Jump to Beginning Button */}
            <button
              type="button"
              id="mobile-grid-jump-to-beginning"
              onClick={() => {
                scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="text-xs font-medium text-slate-700 hover:text-slate-900 active:bg-slate-100 px-2 py-1 rounded-lg border border-slate-200 transition flex items-center gap-1 cursor-pointer shadow-2xs"
              title="An den Anfang (Seite 1) scrollen"
              aria-label="An den Anfang scrollen"
            >
              <ArrowUpToLine className="w-3.5 h-3.5 text-blue-600" />
              <span>An den Anfang</span>
            </button>

            {onOpenFullPageManager && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenFullPageManager();
                }}
                className="text-xs font-medium text-blue-600 hover:text-blue-700 active:bg-blue-50 px-2 py-1 rounded-lg transition flex items-center gap-1 cursor-pointer"
                title="Seiten verwalten"
                aria-label="Seiten verwalten"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Verwalten</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-full text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition cursor-pointer"
              aria-label="Schließen"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Pages Grid */}
        <div
          ref={scrollContainerRef}
          className="p-4 overflow-y-auto no-scrollbar overscroll-contain"
        >
          <div className="grid grid-cols-3 gap-3">
            {Array.from({ length: pdfState.numPages }, (_, i) => i + 1).map((pageNum) => (
              <ThumbnailCard
                key={pageNum}
                pageNumber={pageNum}
                isCurrent={pageNum === currentPage}
                arrayBuffer={pdfState.arrayBuffer}
                cardRef={(node) => {
                  if (pageNum === currentPage) {
                    activeCardNodeRef.current = node;
                  }
                }}
                onSelect={() => {
                  onSelectPage(pageNum);
                  onClose();
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
