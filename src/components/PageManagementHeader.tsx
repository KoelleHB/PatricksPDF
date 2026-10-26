import React from 'react';
import { X, RotateCw, FilePlus2, FileUp, LayoutGrid, Loader2, ArrowUpToLine } from 'lucide-react';

type Props = {
  pageCount: number;
  isDirty: boolean;
  isApplying: boolean;
  isImporting: boolean;
  importFileInputRef: React.RefObject<HTMLInputElement | null>;
  onJumpToBeginning?: () => void;
  onRotateAll: () => void;
  onAddBlank: () => void;
  onImportFile: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onClose: () => void;
};

export const PageManagementHeader: React.FC<Props> = ({
  pageCount,
  isDirty,
  isApplying,
  isImporting,
  importFileInputRef,
  onJumpToBeginning,
  onRotateAll,
  onAddBlank,
  onImportFile,
  onClose,
}) => (
  <div className="shrink-0 px-4 sm:px-6 py-3.5 border-b border-slate-200 bg-slate-50/80 flex items-center justify-between gap-3">
    <div className="flex items-center gap-2.5 min-w-0">
      <div className="h-9 w-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-xs">
        <LayoutGrid className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h2 id="page-management-title" className="text-base sm:text-lg font-bold text-slate-900 tracking-tight truncate">
            Seitenverwaltung
          </h2>
          <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 shrink-0">
            {pageCount} {pageCount === 1 ? 'Seite' : 'Seiten'}
          </span>
          {isDirty && (
            <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
              Ungespeicherte Änderungen
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 truncate hidden sm:block">
          Seiten hinzufügen, löschen, umsortieren und in 90°-Schritten drehen
        </p>
      </div>
    </div>

    {/* Quick Action Buttons */}
    <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
      {/* Jump to Beginning / Seite 1 */}
      {onJumpToBeginning && (
        <button
          id="btn-jump-to-beginning"
          type="button"
          onClick={onJumpToBeginning}
          disabled={pageCount === 0 || isApplying}
          className="flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 active:bg-slate-200 text-slate-700 text-xs sm:text-sm font-medium shadow-2xs transition cursor-pointer"
          title="An den Anfang des Dokuments springen"
          aria-label="An den Anfang des Dokuments springen"
        >
          <ArrowUpToLine className="w-4 h-4 text-blue-600 shrink-0" />
          <span className="hidden xs:inline">An den Anfang</span>
        </button>
      )}

      {/* Rotate All Pages 90° Clockwise */}
      <button
        id="btn-rotate-all-pages"
        type="button"
        onClick={() => onRotateAll()}
        disabled={pageCount === 0 || isApplying}
        className="flex items-center gap-1 px-2 sm:px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 active:bg-slate-200 text-slate-700 text-xs font-medium shadow-2xs transition cursor-pointer"
        title="Alle Seiten um 90° im Uhrzeigersinn drehen"
      >
        <RotateCw className="w-3.5 h-3.5 text-blue-600 shrink-0" />
        <span className="hidden md:inline">Alle drehen</span>
      </button>

      {/* Add Blank Page */}
      <button
        id="btn-open-add-blank-page"
        type="button"
        onClick={() => onAddBlank()}
        disabled={isApplying}
        className="flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 active:bg-slate-200 text-slate-700 text-xs sm:text-sm font-medium shadow-2xs transition cursor-pointer"
        title="Leere Seite hinzufügen"
      >
        <FilePlus2 className="w-4 h-4 text-emerald-600 shrink-0" />
        <span className="hidden sm:inline">Leere Seite</span>
      </button>

      {/* Import Pages from another PDF */}
      <button
        id="btn-import-pdf-pages"
        type="button"
        onClick={() => importFileInputRef.current?.click()}
        disabled={isApplying || isImporting}
        className="flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 active:bg-slate-200 text-slate-700 text-xs sm:text-sm font-medium shadow-2xs transition cursor-pointer"
        title="Seiten aus einer anderen PDF importieren"
      >
        {isImporting ? (
          <Loader2 className="w-4 h-4 text-blue-600 animate-spin shrink-0" />
        ) : (
          <FileUp className="w-4 h-4 text-purple-600 shrink-0" />
        )}
        <span className="hidden sm:inline">Importieren</span>
      </button>

      {/* Hidden file input for importing */}
      <input
        ref={importFileInputRef}
        type="file"
        accept=".pdf,application/pdf"
        className="hidden"
        onChange={onImportFile}
      />

      {/* Close Button */}
      <button
        id="btn-close-page-manager"
        type="button"
        onClick={onClose}
        disabled={isApplying}
        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/70 transition cursor-pointer"
        aria-label="Schließen"
      >
        <X className="w-5 h-5" />
      </button>
    </div>
  </div>
);
