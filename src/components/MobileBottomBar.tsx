import React from 'react';
import { Plus, Download, Type, LayoutGrid } from 'lucide-react';
import { PdfDocumentState } from '../types';

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
}

export const MobileBottomBar: React.FC<MobileBottomBarProps> = ({
  onAddSignature,
  onAddText,
  onOpenPageManager,
  onSave,
  onExport,
  pdfState,
}) => {
  const handleSave = onSave || onExport;
  return (
    <div
      id="bottom-action-toolbar"
      className="sm:hidden shrink-0 z-30 bg-white/95 backdrop-blur-md border-t border-slate-200 px-2.5 py-2 shadow-lg"
      style={{ paddingBottom: 'max(0.6rem, env(safe-area-inset-bottom, 0.6rem))' }}
    >
      <div className="grid grid-cols-4 gap-1.5 max-w-md mx-auto">
        {/* Pages Manager CTA */}
        {onOpenPageManager && (
          <button
            id="mobile-pages-btn"
            onClick={onOpenPageManager}
            className="flex flex-col items-center justify-center gap-1 py-2 px-1.5 rounded-xl border border-slate-300 bg-white active:bg-slate-100 text-slate-800 text-[11px] font-semibold shadow-2xs transition active:scale-98 cursor-pointer min-h-[44px]"
            title="Manage Pages: Add, delete, reorder, and rotate pages"
          >
            <div className="relative">
              <LayoutGrid className="w-4 h-4 text-blue-600 shrink-0" />
              {pdfState && (
                <span className="absolute -top-1.5 -right-2 text-[9px] font-mono font-bold px-1 rounded-full bg-blue-100 text-blue-700">
                  {pdfState.numPages}
                </span>
              )}
            </div>
            <span className="leading-none">Pages</span>
          </button>
        )}

        {/* Add Text CTA */}
        {onAddText && (
          <button
            id="mobile-add-text-btn"
            onClick={onAddText}
            className="flex flex-col items-center justify-center gap-1 py-2 px-1.5 rounded-xl border border-slate-300 bg-white active:bg-slate-100 text-slate-800 text-[11px] font-semibold shadow-2xs transition active:scale-98 cursor-pointer min-h-[44px]"
            title="Add Text"
          >
            <Type className="w-4 h-4 text-blue-600 shrink-0" />
            <span className="leading-none">Text</span>
          </button>
        )}

        {/* Add Signature CTA */}
        <button
          id="mobile-add-signature-btn"
          onClick={onAddSignature}
          className="flex flex-col items-center justify-center gap-1 py-2 px-1.5 rounded-xl bg-blue-600 active:bg-blue-700 text-white text-[11px] font-semibold shadow-xs transition active:scale-98 cursor-pointer min-h-[44px]"
          title="Add Signature"
        >
          <Plus className="w-4 h-4 shrink-0" />
          <span className="leading-none">Sign</span>
        </button>

        {/* Save CTA */}
        <button
          id="mobile-save-btn"
          onClick={handleSave}
          className="flex flex-col items-center justify-center gap-1 py-2 px-1.5 rounded-xl bg-slate-900 active:bg-slate-800 text-white text-[11px] font-semibold shadow-xs transition active:scale-98 cursor-pointer min-h-[44px]"
          title="Save PDF"
        >
          <Download className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="leading-none">Save</span>
        </button>
      </div>
    </div>
  );
};



