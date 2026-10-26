import React from 'react';
import { Download, LayoutGrid, PenLine, Plus } from 'lucide-react';
import { PdfDocumentState } from '../../types';

interface MobileBottomBarProps {
  onAddSignature: () => void;
  onAddText?: () => void;
  onOpenPageManager?: () => void;
  onSave?: () => void;
  onExport?: () => void;
  pdfState?: PdfDocumentState;
  signatureCount?: number;
  textCount?: number;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  onChangePage?: (newPage: number) => void;
  onChangeDocument?: () => void;
  isVisible?: boolean;
}

export const MobileBottomBar: React.FC<MobileBottomBarProps> = ({
  onAddSignature,
  onAddText,
  onOpenPageManager,
  onSave,
  onExport,
  pdfState,
  isVisible = true,
}) => {
  const handleSave = onSave || onExport;

  return (
    <nav
      id="bottom-action-toolbar"
      aria-label="Mobile Werkzeugleiste"
      className={`fixed bottom-0 inset-x-0 z-30 bg-white/90 backdrop-blur-md border-t border-slate-200/80 px-3 py-2 shadow-lg transition-all duration-300 ease-in-out ${
        isVisible
          ? 'translate-y-0 opacity-100 pointer-events-auto'
          : 'translate-y-full opacity-0 pointer-events-none'
      }`}
      style={{
        paddingBottom: 'max(0.6rem, env(safe-area-inset-bottom, 0.6rem))',
      }}
    >
      <div className="grid grid-cols-4 gap-2 max-w-md mx-auto items-center">
        {/* 1. Seiten / Pages with dynamic badge */}
        {onOpenPageManager && (
          <button
            type="button"
            id="mobile-pages-btn"
            onClick={onOpenPageManager}
            className="flex flex-col items-center justify-center gap-1 py-1.5 px-2 rounded-xl bg-slate-50 hover:bg-slate-100 active:bg-slate-200/70 border border-slate-200/70 text-slate-700 text-[11px] font-medium transition active:scale-95 cursor-pointer min-h-[48px]"
            title="Seitenübersicht und Organisation"
            aria-label={`Seiten (${pdfState?.numPages || 1})`}
          >
            <div className="relative">
              <LayoutGrid className="w-4 h-4 text-slate-600 shrink-0" />
              {pdfState && (
                <span className="absolute -top-1.5 -right-2.5 text-[9px] font-mono font-bold px-1 py-0.2 rounded-full bg-blue-100 text-blue-700 leading-tight border border-blue-200">
                  {pdfState.numPages}
                </span>
              )}
            </div>
            <span className="leading-none tracking-tight">Seiten</span>
          </button>
        )}

        {/* 2. Text (Stift-Icon) */}
        {onAddText && (
          <button
            type="button"
            id="mobile-add-text-btn"
            onClick={onAddText}
            className="flex flex-col items-center justify-center gap-1 py-1.5 px-2 rounded-xl bg-slate-50 hover:bg-slate-100 active:bg-slate-200/70 border border-slate-200/70 text-slate-700 text-[11px] font-medium transition active:scale-95 cursor-pointer min-h-[48px]"
            title="Text einfügen"
            aria-label="Text einfügen"
          >
            <PenLine className="w-4 h-4 text-slate-600 shrink-0" />
            <span className="leading-none tracking-tight">Text</span>
          </button>
        )}

        {/* 3. Signieren (Hervorgehobener primärer Aktions-Button mit Akzentblau) */}
        <button
          type="button"
          id="mobile-add-signature-btn"
          onClick={onAddSignature}
          className="flex flex-col items-center justify-center gap-1 py-1.5 px-2 rounded-2xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-[11px] font-semibold shadow-md shadow-blue-500/20 transition active:scale-95 cursor-pointer min-h-[48px]"
          title="Unterschrift hinzufügen"
          aria-label="Unterschrift hinzufügen"
        >
          <Plus className="w-4 h-4 shrink-0 stroke-[2.5]" />
          <span className="leading-none tracking-tight">Signieren</span>
        </button>

        {/* 4. Speichern / Exportieren */}
        <button
          type="button"
          id="mobile-save-btn"
          onClick={handleSave}
          className="flex flex-col items-center justify-center gap-1 py-1.5 px-2 rounded-xl bg-slate-900 hover:bg-slate-800 active:bg-black text-white text-[11px] font-medium shadow-xs transition active:scale-95 cursor-pointer min-h-[48px]"
          title="PDF Speichern oder Exportieren"
          aria-label="PDF Speichern oder Exportieren"
        >
          <Download className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="leading-none tracking-tight">Speichern</span>
        </button>
      </div>
    </nav>
  );
};
