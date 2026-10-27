import React from 'react';
import { AlertTriangle, Download, Trash2, X, Clock } from 'lucide-react';

interface UnsavedChangesModalProps {
  isOpen: boolean;
  documentName: string;
  actionType: 'close' | 'switch';
  onKeepEditing: () => void;
  onKeepDraftAndProceed?: () => void;
  onDiscardChanges: () => void;
  onSaveFirst?: () => void;
  onExportFirst?: () => void;
}

export const UnsavedChangesModal: React.FC<UnsavedChangesModalProps> = ({
  isOpen,
  documentName,
  actionType,
  onKeepEditing,
  onKeepDraftAndProceed,
  onDiscardChanges,
  onSaveFirst,
  onExportFirst,
}) => {
  const handleSaveFirst = onSaveFirst || onExportFirst;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div
        id="unsaved-changes-dialog"
        className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col animate-in zoom-in-95 duration-150"
      >
        {/* Header with warning icon */}
        <div className="p-5 sm:p-6 pb-4 flex items-start gap-4">
          <div className="w-11 h-11 rounded-2xl bg-amber-100 text-amber-600 flex items-center justify-center shrink-0 shadow-2xs">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <h3 className="text-base sm:text-lg font-bold text-slate-900 leading-snug">
                Unexported Edits
              </h3>
              <button
                id="unsaved-modal-close-btn"
                onClick={onKeepEditing}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
                title="Cancel"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs sm:text-sm text-slate-600 mt-1.5 leading-relaxed">
              You have edits in{' '}
              <span className="font-semibold text-slate-800 break-all">"{documentName}"</span>{' '}
              that have not been exported as a final PDF yet.
            </p>
            <p className="text-xs text-slate-500 mt-1.5">
              Your working progress is automatically saved locally as a draft in Recent Documents so you can resume anytime, or you can export a PDF now.
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="px-5 sm:px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-col gap-2">
          <div className="flex flex-col sm:flex-row items-center justify-end gap-2">
            {onKeepDraftAndProceed && (
              <button
                id="unsaved-keep-draft-btn"
                type="button"
                onClick={onKeepDraftAndProceed}
                className="w-full sm:w-auto px-3.5 py-2 rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 text-xs sm:text-sm font-semibold transition flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Clock className="w-4 h-4 shrink-0 text-amber-700" />
                <span>Keep Draft & {actionType === 'switch' ? 'Open' : 'Close'}</span>
              </button>
            )}
            {handleSaveFirst && (
              <button
                id="unsaved-save-first-btn"
                type="button"
                onClick={handleSaveFirst}
                className="w-full sm:w-auto px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-xs sm:text-sm font-semibold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
              >
                <Download className="w-4 h-4 shrink-0" />
                <span>Export PDF Now</span>
              </button>
            )}
          </div>
          <div className="flex flex-col-reverse sm:flex-row items-center justify-between gap-2 pt-1 border-t border-slate-200/80">
            <button
              id="unsaved-discard-btn"
              type="button"
              onClick={onDiscardChanges}
              className="w-full sm:w-auto px-3 py-1.5 rounded-xl text-red-600 hover:bg-red-50 text-xs font-semibold transition flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5 shrink-0" />
              <span>Discard Draft & Reset</span>
            </button>
            <button
              id="unsaved-keep-editing-btn"
              type="button"
              onClick={onKeepEditing}
              className="w-full sm:w-auto px-3.5 py-1.5 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100 transition cursor-pointer"
            >
              Back to Editor
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
