import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface MobileFloatingPillProps {
  currentPage: number;
  numPages: number;
  isFitWidth: boolean;
  isVisible: boolean;
  onPrevPage: () => void;
  onNextPage: () => void;
  onToggleFitMode: () => void;
  onOpenPageGrid: () => void;
}

export const MobileFloatingPill: React.FC<MobileFloatingPillProps> = ({
  currentPage,
  numPages,
  isFitWidth,
  isVisible,
  onPrevPage,
  onNextPage,
  onToggleFitMode,
  onOpenPageGrid,
}) => {
  return (
    <aside
      aria-label="Schnellsteuerung für Seiten und Lesemodus"
      className={`fixed left-1/2 -translate-x-1/2 bottom-20 z-30 transition-all duration-300 ease-in-out pointer-events-auto ${
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

        {/* Fit Width / Original quick switch */}
        <button
          type="button"
          onClick={onToggleFitMode}
          className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition active:scale-95 cursor-pointer whitespace-nowrap min-h-[28px] flex items-center justify-center ${
            isFitWidth
              ? 'bg-blue-600 text-white shadow-2xs'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200/70'
          }`}
          title={isFitWidth ? 'Auf Originalgröße (100%) schalten' : 'An Bildschirmbreite anpassen'}
        >
          {isFitWidth ? 'Breite' : 'Original'}
        </button>
      </div>
    </aside>
  );
};
