import React from 'react';
import { Plus, Download, ChevronLeft, ChevronRight, FileUp, Undo2, Redo2, Type } from 'lucide-react';
import { PdfDocumentState } from '../types';

interface MobileBottomBarProps {
  pdfState: PdfDocumentState;
  signatureCount: number;
  textCount?: number;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  onAddSignature: () => void;
  onAddText?: () => void;
  onExport: () => void;
  onChangePage: (newPage: number) => void;
  onChangeDocument: () => void;
}

export const MobileBottomBar: React.FC<MobileBottomBarProps> = ({
  pdfState,
  signatureCount,
  textCount = 0,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  onAddSignature,
  onAddText,
  onExport,
  onChangePage,
  onChangeDocument,
}) => {
  return (
    <div className="sm:hidden sticky bottom-0 z-30 bg-white/95 backdrop-blur border-t border-slate-200 px-2 py-2 flex items-center justify-between gap-1 shadow-lg">
      <button
        onClick={onChangeDocument}
        className="p-1 rounded-xl text-slate-500 hover:bg-slate-100 flex flex-col items-center text-[10px] font-medium shrink-0"
        title="Change PDF File"
      >
        <FileUp className="w-4 h-4" />
        <span>File</span>
      </button>

      {/* Undo / Redo in mobile bar */}
      <div className="flex items-center gap-0.5 bg-slate-100 p-0.5 rounded-xl shrink-0">
        <button
          id="mobile-undo-btn"
          disabled={!canUndo}
          onClick={onUndo}
          className="p-1.5 rounded-lg text-slate-700 disabled:opacity-25 active:bg-white transition"
          title="Undo"
        >
          <Undo2 className="w-3.5 h-3.5" />
        </button>
        <button
          id="mobile-redo-btn"
          disabled={!canRedo}
          onClick={onRedo}
          className="p-1.5 rounded-lg text-slate-700 disabled:opacity-25 active:bg-white transition"
          title="Redo"
        >
          <Redo2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Page switcher */}
      <div className="flex items-center gap-0.5 bg-slate-100 px-1 py-1 rounded-xl shrink-0">
        <button
          disabled={pdfState.currentPage <= 1}
          onClick={() => onChangePage(pdfState.currentPage - 1)}
          className="p-0.5 rounded text-slate-700 disabled:opacity-30"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <span className="text-[10px] font-mono font-bold text-slate-700 px-0.5">
          {pdfState.currentPage}/{pdfState.numPages}
        </span>
        <button
          disabled={pdfState.currentPage >= pdfState.numPages}
          onClick={() => onChangePage(pdfState.currentPage + 1)}
          className="p-0.5 rounded text-slate-700 disabled:opacity-30"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Add Text CTA */}
      {onAddText && (
        <button
          id="mobile-add-text-btn"
          onClick={onAddText}
          className="flex items-center gap-1 px-2.5 py-2 rounded-xl border border-slate-300 active:bg-slate-100 text-slate-800 text-xs font-semibold shadow-2xs shrink-0"
          title="Add Text"
        >
          <Type className="w-3.5 h-3.5 text-blue-600" />
          <span>Text</span>
        </button>
      )}

      {/* Add Signature CTA */}
      <button
        id="mobile-add-signature-btn"
        onClick={onAddSignature}
        className="flex items-center gap-1 px-2.5 py-2 rounded-xl bg-blue-600 active:bg-blue-700 text-white text-xs font-semibold shadow-xs shrink-0"
      >
        <Plus className="w-3.5 h-3.5" />
        <span>Sign</span>
      </button>

      {/* Export CTA */}
      <button
        id="mobile-export-btn"
        onClick={onExport}
        className="flex items-center gap-1 px-2.5 py-2 rounded-xl bg-slate-900 active:bg-slate-800 text-white text-xs font-medium shadow-xs shrink-0"
      >
        <Download className="w-3.5 h-3.5 text-emerald-400" />
        <span>Export</span>
      </button>
    </div>
  );
};

