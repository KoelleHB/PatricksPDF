import React, { useState, useRef, useEffect } from 'react';
import {
  ArrowLeft,
  Search,
  LayoutGrid,
  MoreVertical,
  BookOpen,
  AlignLeft,
  Printer,
  Share2,
  FolderOpen,
  History,
  HelpCircle,
  Check,
  Undo2,
  Redo2,
} from 'lucide-react';
import { PdfDocumentState } from '../../types';

interface MobileReaderTopBarProps {
  pdfState: PdfDocumentState;
  isVisible: boolean;
  isSaved: boolean;
  onBack: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  onToggleSearch: () => void;
  isSearchActive?: boolean;
  onTogglePageGrid: () => void;
  onOpenToc?: () => void;
  onToggleReflow?: () => void;
  isReflowActive?: boolean;
  onQuickPrint?: () => void;
  onQuickShare?: () => void;
  onOpenFile?: () => void;
  onOpenRecent?: () => void;
  onOpenDiagnostics?: () => void;
}

export const MobileReaderTopBar: React.FC<MobileReaderTopBarProps> = ({
  pdfState,
  isVisible,
  isSaved,
  onBack,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  onToggleSearch,
  isSearchActive = false,
  onTogglePageGrid,
  onOpenToc,
  onToggleReflow,
  isReflowActive = false,
  onQuickPrint,
  onQuickShare,
  onOpenFile,
  onOpenRecent,
  onOpenDiagnostics,
}) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close overflow menu when clicking outside
  useEffect(() => {
    if (!isMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isMenuOpen]);

  // Document file size helper
  const sizeBytes = pdfState.file?.size ?? pdfState.arrayBuffer?.byteLength ?? 0;
  const formattedSize =
    sizeBytes > 1024 * 1024
      ? `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
      : sizeBytes > 0
      ? `${Math.max(1, Math.round(sizeBytes / 1024))} KB`
      : '';

  return (
    <header
      id="mobile-reader-top-bar"
      className={`sticky top-0 inset-x-0 shrink-0 z-40 bg-white/90 backdrop-blur-md border-b border-slate-200/60 shadow-xs transition-all duration-300 ease-in-out ${
        isVisible ? 'opacity-100 pointer-events-auto block' : 'opacity-0 pointer-events-none hidden'
      }`}
      style={{
        paddingTop: 'max(0.35rem, env(safe-area-inset-top, 0.35rem))',
      }}
    >
      <div className="flex items-center justify-between px-2 sm:px-4 py-2 h-14 max-w-full">
        {/* Left: Back button + Title & metadata badge */}
        <div className="flex items-center gap-1.5 min-w-0 flex-1 mr-1">
          <button
            type="button"
            onClick={onBack}
            className="p-1.5 -ml-1 rounded-full text-slate-700 hover:bg-slate-100 active:bg-slate-200/70 transition shrink-0 cursor-pointer min-w-[36px] min-h-[36px] flex items-center justify-center"
            title="Zurück zur Übersicht"
            aria-label="Zurück zur Übersicht"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <div className="flex flex-col min-w-0">
            <h1
              className="text-xs sm:text-sm font-semibold text-slate-900 truncate tracking-tight leading-tight"
              title={pdfState.name}
            >
              {pdfState.name || 'Dokument'}
            </h1>
            <div className="flex items-center gap-1.5 mt-0.5 text-[10px] sm:text-[11px] text-slate-500 font-medium truncate">
              <span>PDF</span>
              {formattedSize && (
                <>
                  <span className="text-slate-300">•</span>
                  <span>{formattedSize}</span>
                </>
              )}
              <span className="text-slate-300">•</span>
              <span className="inline-flex items-center gap-1 shrink-0">
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    isSaved ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'
                  }`}
                />
                <span className={isSaved ? 'text-slate-600' : 'text-amber-700 font-semibold'}>
                  {isSaved ? 'Gespeichert' : 'Geändert'}
                </span>
              </span>
            </div>
          </div>
        </div>

        {/* Right: Undo, Redo, Search, Grid, Overflow Menu */}
        <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
          {/* Undo Button */}
          {onUndo && (
            <button
              type="button"
              onClick={onUndo}
              disabled={!canUndo}
              className="p-1.5 rounded-full text-slate-700 hover:bg-slate-100 active:bg-slate-200/70 disabled:opacity-25 disabled:hover:bg-transparent transition cursor-pointer min-w-[34px] min-h-[34px] flex items-center justify-center"
              title="Rückgängig"
              aria-label="Rückgängig"
            >
              <Undo2 className="w-4 h-4" />
            </button>
          )}

          {/* Redo Button */}
          {onRedo && (
            <button
              type="button"
              onClick={onRedo}
              disabled={!canRedo}
              className="p-1.5 rounded-full text-slate-700 hover:bg-slate-100 active:bg-slate-200/70 disabled:opacity-25 disabled:hover:bg-transparent transition cursor-pointer min-w-[34px] min-h-[34px] flex items-center justify-center"
              title="Wiederholen"
              aria-label="Wiederholen"
            >
              <Redo2 className="w-4 h-4" />
            </button>
          )}

          {/* Search Toggle */}
          <button
            type="button"
            onClick={onToggleSearch}
            className={`p-1.5 rounded-full transition cursor-pointer min-w-[34px] min-h-[34px] flex items-center justify-center ${
              isSearchActive
                ? 'bg-blue-100 text-blue-600'
                : 'text-slate-700 hover:bg-slate-100 active:bg-slate-200/70'
            }`}
            title="Dokument durchsuchen"
            aria-label="Dokument durchsuchen"
          >
            <Search className="w-4 h-4" />
          </button>

          {/* Overflow Menu (Three-dots) */}
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setIsMenuOpen((prev) => !prev)}
              className={`p-1.5 rounded-full transition cursor-pointer min-w-[34px] min-h-[34px] flex items-center justify-center ${
                isMenuOpen
                  ? 'bg-slate-200 text-slate-900'
                  : 'text-slate-700 hover:bg-slate-100 active:bg-slate-200/70'
              }`}
              title="Weitere Optionen"
              aria-label="Weitere Optionen"
              aria-expanded={isMenuOpen}
            >
              <MoreVertical className="w-4 h-4" />
            </button>

            {isMenuOpen && (
              <div
                className="absolute right-0 mt-2 w-56 bg-white/95 backdrop-blur-md rounded-2xl shadow-xl border border-slate-200/80 py-1.5 z-50 text-xs animate-in fade-in zoom-in-95 duration-150 divide-y divide-slate-100"
                role="menu"
              >
                {/* 1. Document File & History actions */}
                <div className="py-1">
                  {onOpenFile && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsMenuOpen(false);
                        onOpenFile();
                      }}
                      className="w-full px-3.5 py-2 text-left flex items-center gap-2.5 hover:bg-slate-100 text-slate-700 transition cursor-pointer"
                    >
                      <FolderOpen className="w-4 h-4 text-blue-600" />
                      <span className="font-medium">Datei öffnen</span>
                    </button>
                  )}

                  {onOpenRecent && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsMenuOpen(false);
                        onOpenRecent();
                      }}
                      className="w-full px-3.5 py-2 text-left flex items-center gap-2.5 hover:bg-slate-100 text-slate-700 transition cursor-pointer"
                    >
                      <History className="w-4 h-4 text-blue-600" />
                      <span>Verlauf zeigen</span>
                    </button>
                  )}
                </div>

                {/* 2. Reading Features */}
                <div className="py-1">
                  {onTogglePageGrid && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsMenuOpen(false);
                        onTogglePageGrid();
                      }}
                      className="w-full px-3.5 py-2 text-left flex items-center gap-2.5 hover:bg-slate-100 text-slate-700 transition cursor-pointer"
                    >
                      <LayoutGrid className="w-4 h-4 text-slate-600" />
                      <span>Seitenübersicht</span>
                    </button>
                  )}

                  {onOpenToc && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsMenuOpen(false);
                        onOpenToc();
                      }}
                      className="w-full px-3.5 py-2 text-left flex items-center gap-2.5 hover:bg-slate-100 text-slate-700 transition cursor-pointer"
                    >
                      <BookOpen className="w-4 h-4 text-slate-600" />
                      <span>Inhaltsverzeichnis</span>
                    </button>
                  )}

                  {onToggleReflow && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsMenuOpen(false);
                        onToggleReflow();
                      }}
                      className="w-full px-3.5 py-2 text-left flex items-center justify-between hover:bg-slate-100 text-slate-700 transition cursor-pointer"
                    >
                      <div className="flex items-center gap-2.5">
                        <AlignLeft className="w-4 h-4 text-slate-600" />
                        <span>Text-Reflow (Lesemodus)</span>
                      </div>
                      {isReflowActive && <Check className="w-3.5 h-3.5 text-blue-600" />}
                    </button>
                  )}
                </div>

                {/* 3. Output Actions: Print & Share */}
                <div className="py-1">
                  {onQuickPrint && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsMenuOpen(false);
                        onQuickPrint();
                      }}
                      className="w-full px-3.5 py-2 text-left flex items-center gap-2.5 hover:bg-slate-100 text-slate-700 transition cursor-pointer"
                    >
                      <Printer className="w-4 h-4 text-slate-600" />
                      <span>Drucken</span>
                    </button>
                  )}

                  {onQuickShare && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsMenuOpen(false);
                        onQuickShare();
                      }}
                      className="w-full px-3.5 py-2 text-left flex items-center gap-2.5 hover:bg-slate-100 text-slate-700 transition cursor-pointer"
                    >
                      <Share2 className="w-4 h-4 text-slate-600" />
                      <span>Teilen</span>
                    </button>
                  )}
                </div>

                {onOpenDiagnostics && (
                  <div className="py-1">
                    <button
                      type="button"
                      onClick={() => {
                        setIsMenuOpen(false);
                        onOpenDiagnostics();
                      }}
                      className="w-full px-3.5 py-2 text-left flex items-center gap-2.5 hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition cursor-pointer"
                    >
                      <HelpCircle className="w-4 h-4 text-slate-400" />
                      <span>Diagnose</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
