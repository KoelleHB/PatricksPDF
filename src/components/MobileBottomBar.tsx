import React from 'react';
import { Plus, Download, Type } from 'lucide-react';
import { PdfDocumentState } from '../types';

interface MobileBottomBarProps {
  onAddSignature: () => void;
  onAddText?: () => void;
  onExport: () => void;
  // Retain optional props for compatibility
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
  onExport,
}) => {
  return (
    <div className="sm:hidden sticky bottom-0 z-30 bg-white/95 backdrop-blur border-t border-slate-200 px-3 py-2 shadow-lg">
      <div className="grid grid-cols-3 gap-2.5 max-w-md mx-auto">
        {/* Add Text CTA */}
        {onAddText && (
          <button
            id="mobile-add-text-btn"
            onClick={onAddText}
            className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl border border-slate-300 bg-white active:bg-slate-100 text-slate-800 text-xs font-semibold shadow-2xs transition active:scale-98"
            title="Add Text"
          >
            <Type className="w-4 h-4 text-blue-600 shrink-0" />
            <span>Text</span>
          </button>
        )}

        {/* Add Signature CTA */}
        <button
          id="mobile-add-signature-btn"
          onClick={onAddSignature}
          className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-blue-600 active:bg-blue-700 text-white text-xs font-semibold shadow-xs transition active:scale-98"
          title="Add Signature"
        >
          <Plus className="w-4 h-4 shrink-0" />
          <span>Sign</span>
        </button>

        {/* Export CTA */}
        <button
          id="mobile-export-btn"
          onClick={onExport}
          className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-slate-900 active:bg-slate-800 text-white text-xs font-semibold shadow-xs transition active:scale-98"
          title="Export PDF"
        >
          <Download className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>Export</span>
        </button>
      </div>
    </div>
  );
};

