import React from 'react';
import { ChevronLeft, ChevronRight, Maximize2, Minimize2 } from 'lucide-react';

interface MobileFloatingPillProps {
  currentPage: number;
  numPages: number;
  zoomLevel: number;
  isVisible: boolean;
  isFullscreen?: boolean;
  onPrevPage: () => void;
  onNextPage: () => void;
  onResetToFitPage: () => void;
  onOpenPageGrid: () => void;
  onToggleFullscreen?: () => void;
}

export const MobileFloatingPill: React.FC<MobileFloatingPillProps> = ({
  currentPage,
  numPages,
  zoomLevel,
  isVisible,
  isFullscreen = false,
  onPrevPage,
  onNextPage,
  onResetToFitPage,
  onOpenPageGrid,
  onToggleFullscreen,
}) => {
  const roundedZoom = Math.round(zoomLevel);

  return (
    <aside
      aria-label="Quick page and zoom controls"
      className={`fixed left-1/2 -translate-x-1/2 ${
        isFullscreen ? 'bottom-6' : 'bottom-20'
      } z-30 transition-all duration-300 ease-in-out pointer-events-auto ${
        isVisible
          ? 'translate-y-0 opacity-100 scale-100'
          : 'translate-y-10 opacity-0 scale-95 pointer-events-none'
      }`}
    >
      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white/75 backdrop-blur-md border border-slate-200/50 shadow-md rounded-full text-slate-800 select-none">
        {/* Page navigation */}
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={onPrevPage}
            disabled={currentPage <= 1}
            className="p-1 rounded-full text-slate-700 hover:bg-slate-200/50 active:bg-slate-200/70 disabled:opacity-30 disabled:hover:bg-transparent transition cursor-pointer min-w-[32px] min-h-[32px] flex items-center justify-center"
            title="Previous page"
            aria-label="Previous page"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={onOpenPageGrid}
            className="px-2 py-0.5 rounded-full text-xs font-semibold hover:bg-slate-200/50 active:bg-slate-200/70 transition cursor-pointer flex items-center gap-1"
            title="Open page overview"
            aria-label={`Page ${currentPage} of ${numPages}. Tap for page overview.`}
          >
            <span className="text-blue-600 font-mono font-bold">{currentPage}</span>
            <span className="text-slate-400 font-normal">/</span>
            <span className="text-slate-700 font-mono">{numPages}</span>
          </button>

          <button
            type="button"
            onClick={onNextPage}
            disabled={currentPage >= numPages}
            className="p-1 rounded-full text-slate-700 hover:bg-slate-200/50 active:bg-slate-200/70 disabled:opacity-30 disabled:hover:bg-transparent transition cursor-pointer min-w-[32px] min-h-[32px] flex items-center justify-center"
            title="Next page"
            aria-label="Next page"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Divider */}
        <span className="w-px h-4 bg-slate-300/60 mx-0.5" />

        {/* Zoom percentage button: shows zoom % and resets to Fit Page on click */}
        <button
          type="button"
          onClick={onResetToFitPage}
          className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-200/55 hover:bg-slate-200/80 active:bg-blue-100/80 active:text-blue-700 text-slate-700 transition active:scale-95 cursor-pointer whitespace-nowrap min-h-[28px] flex items-center justify-center font-mono"
          title="Tap to reset zoom to Fit Page"
          aria-label={`Zoom: ${roundedZoom}%. Tap to fit page.`}
        >
          {roundedZoom}%
        </button>

        {/* Fullscreen toggle button */}
        {onToggleFullscreen && (
          <>
            <span className="w-px h-4 bg-slate-300/60 mx-0.5" />
            <button
              type="button"
              id="mobile-fullscreen-btn"
              onClick={onToggleFullscreen}
              className={`p-1.5 rounded-full text-slate-700 hover:bg-slate-200/50 active:bg-slate-200/70 transition cursor-pointer min-w-[28px] min-h-[28px] flex items-center justify-center ${
                isFullscreen ? 'text-blue-600 bg-blue-50/80' : ''
              }`}
              title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            >
              {isFullscreen ? (
                <Minimize2 className="w-3.5 h-3.5" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5" />
              )}
            </button>
          </>
        )}
      </div>
    </aside>
  );
};
