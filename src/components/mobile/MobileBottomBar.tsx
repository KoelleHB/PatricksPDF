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
      aria-label="Mobile toolbar"
      className={`shrink-0 z-30 bg-white/90 backdrop-blur-md border-t border-slate-200/80 px-3 py-2 shadow-lg transition-all duration-300 ease-in-out ${
        isVisible
          ? 'opacity-100 pointer-events-auto block'
          : 'opacity-0 pointer-events-none hidden'
      }`}
      style={{
        paddingBottom: 'max(0.6rem, env(safe-area-inset-bottom, 0.6rem))',
      }}
    >
      <div className="grid grid-cols-4 gap-2 max-w-md mx-auto items-center">
        {/* 1. Pages with dynamic badge */}
        {onOpenPageManager && (
          <button
            type="button"
            id="mobile-pages-btn"
            onClick={onOpenPageManager}
            className="flex flex-col items-center justify-center gap-1 py-1.5 px-2 rounded-xl bg-slate-50 hover:bg-slate-100 active:bg-slate-200/70 border border-slate-200/70 text-slate-700 text-[11px] font-medium transition active:scale-95 cursor-pointer min-h-[48px]"
            title="Page Overview & Organization"
            aria-label={`Pages (${pdfState?.numPages || 1})`}
          >
            <div className="relative">
              <LayoutGrid className="w-4 h-4 text-slate-600 shrink-0" />
              {pdfState && (
                <span className="absolute -top-1.5 -right-2.5 text-[9px] font-mono font-bold px-1 py-0.2 rounded-full bg-blue-100 text-blue-700 leading-tight border border-blue-200">
                  {pdfState.numPages}
                </span>
              )}
            </div>
            <span className="leading-none tracking-tight">Pages</span>
          </button>
        )}

        {/* 2. Text */}
        {onAddText && (
          <button
            type="button"
            id="mobile-add-text-btn"
            onClick={onAddText}
            className="flex flex-col items-center justify-center gap-1 py-1.5 px-2 rounded-xl bg-slate-50 hover:bg-slate-100 active:bg-slate-200/70 border border-slate-200/70 text-slate-700 text-[11px] font-medium transition active:scale-95 cursor-pointer min-h-[48px]"
            title="Add Text"
            aria-label="Add Text"
          >
            <PenLine className="w-4 h-4 text-slate-600 shrink-0" />
            <span className="leading-none tracking-tight">Text</span>
          </button>
        )}

        {/* 3. Sign */}
        <button
          type="button"
          id="mobile-add-signature-btn"
          onClick={onAddSignature}
          className="flex flex-col items-center justify-center gap-1 py-1.5 px-2 rounded-xl bg-slate-50 hover:bg-slate-100 active:bg-slate-200/70 border border-slate-200/80 text-slate-700 text-[11px] font-medium transition active:scale-95 cursor-pointer min-h-[48px]"
          title="Add Signature"
          aria-label="Add Signature"
        >
          <Plus className="w-4 h-4 text-blue-600 shrink-0 stroke-[2.2]" />
          <span className="leading-none tracking-tight">Sign</span>
        </button>

        {/* 4. Save / Export */}
        <button
          type="button"
          id="mobile-save-btn"
          onClick={handleSave}
          className="flex flex-col items-center justify-center gap-1 py-1.5 px-2 rounded-xl bg-slate-50 hover:bg-slate-100 active:bg-slate-200/70 border border-slate-200/80 text-slate-700 text-[11px] font-medium transition active:scale-95 cursor-pointer min-h-[48px]"
          title="Save or Export PDF"
          aria-label="Save or Export PDF"
        >
          <Download className="w-4 h-4 text-emerald-600 shrink-0" />
          <span className="leading-none tracking-tight">Save</span>
        </button>
      </div>
    </nav>
  );
};
