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
      aria-label="Schnellsteuerung für Seiten und Zoom"
      className={`fixed left-1/2 -translate-x-1/2 ${
        isFullscreen ? 'bottom-6' : 'bottom-20'
      } z-30 transition-all duration-300 ease-in-out pointer-events-auto ${
        isVisible
          ? 'translate-y-0 opacity-100 scale-100'
          : 'translate-y-10 opacity-0 scale-95 pointer-events-none'
      }`}
    >
      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white/92 backdrop-blur-md border border-slate-200/70 shadow-lg rounded-full text-slate-800 select-none">
        {/* Page navigation */}
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={onPrevPage}
            disabled={currentPage <= 1}
            className="p-1 rounded-full text-slate-700 hover:bg-slate-100 active:bg-slate-200/70 disabled:opacity-30 disabled:hover:bg-transparent transition cursor-pointer min-w-[32px] min-h-[32px] flex items-center justify-center"
            title="Vorherige Seite"
            aria-label="Vorherige Seite"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={onOpenPageGrid}
            className="px-2 py-0.5 rounded-full text-xs font-semibold hover:bg-slate-100 active:bg-slate-200/70 transition cursor-pointer flex items-center gap-1"
            title="Seitenübersicht öffnen"
            aria-label={`Seite ${currentPage} von ${numPages}. Klicken für Seitenübersicht.`}
          >
            <span className="text-blue-600 font-mono font-bold">{currentPage}</span>
            <span className="text-slate-400 font-normal">/</span>
            <span className="text-slate-700 font-mono">{numPages}</span>
          </button>

          <button
            type="button"
            onClick={onNextPage}
            disabled={currentPage >= numPages}
            className="p-1 rounded-full text-slate-700 hover:bg-slate-100 active:bg-slate-200/70 disabled:opacity-30 disabled:hover:bg-transparent transition cursor-pointer min-w-[32px] min-h-[32px] flex items-center justify-center"
            title="Nächste Seite"
            aria-label="Nächste Seite"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Divider */}
        <span className="w-px h-4 bg-slate-200 mx-0.5" />

        {/* Zoom percentage button: shows zoom % and resets to "Ganze Seite" (Fit Page) on click */}
        <button
          type="button"
          onClick={onResetToFitPage}
          className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-100 hover:bg-slate-200/80 active:bg-blue-100 active:text-blue-700 text-slate-700 transition active:scale-95 cursor-pointer whitespace-nowrap min-h-[28px] flex items-center justify-center font-mono"
          title="Klicken, um auf 'Ganze Seite' zurückzusetzen"
          aria-label={`Zoom: ${roundedZoom}%. Klicken für Ganze Seite.`}
        >
          {roundedZoom}%
        </button>

        {/* Fullscreen toggle button */}
        {onToggleFullscreen && (
          <>
            <span className="w-px h-4 bg-slate-200 mx-0.5" />
            <button
              type="button"
              id="mobile-fullscreen-btn"
              onClick={onToggleFullscreen}
              className={`p-1.5 rounded-full text-slate-700 hover:bg-slate-100 active:bg-slate-200/70 transition cursor-pointer min-w-[28px] min-h-[28px] flex items-center justify-center ${
                isFullscreen ? 'text-blue-600 bg-blue-50' : ''
              }`}
              title={isFullscreen ? 'Vollbildmodus beenden' : 'Vollbildmodus aktivieren'}
              aria-label={isFullscreen ? 'Vollbildmodus beenden' : 'Vollbildmodus aktivieren'}
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
