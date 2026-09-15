import React, { useState, useRef } from 'react';
import { FileSignature, Download, Wifi, WifiOff, HelpCircle, FolderOpen, X } from 'lucide-react';

interface HeaderProps {
  documentName: string;
  hasDocument: boolean;
  signatureCount: number;
  hasUnsavedChanges?: boolean;
  onOpenSetupGuide: () => void;
  onOpenExport: () => void;
  onFileSelect?: (file: File) => void;
  onCloseDocument?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  documentName,
  hasDocument,
  signatureCount,
  hasUnsavedChanges = false,
  onOpenSetupGuide,
  onOpenExport,
  onFileSelect,
  onCloseDocument,
}) => {
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onFileSelect) {
      onFileSelect(file);
    }
    // Reset value so same file can be re-selected if desired
    e.target.value = '';
  };

  React.useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200 shadow-xs px-3 sm:px-6 py-2.5">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-2">
        {/* Brand identity */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="h-9 w-9 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-xs shrink-0">
            <FileSignature className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight truncate">
                PatricksPDF
              </h1>
              <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                100% Client-Side Local
              </span>
            </div>
            {hasDocument && (
              <div className="flex items-center gap-1.5 min-w-0">
                <p className="text-xs text-slate-500 truncate max-w-[180px] sm:max-w-xs md:max-w-md">
                  {documentName} {signatureCount > 0 && `• ${signatureCount} signature${signatureCount > 1 ? 's' : ''}`}
                </p>
                {hasUnsavedChanges ? (
                  <span
                    className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300 shrink-0"
                    title="You have unsaved changes that have not been exported yet"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                    <span className="hidden sm:inline">Unsaved</span>
                  </span>
                ) : (
                  <span
                    className="hidden sm:inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 shrink-0"
                    title="All changes exported"
                  >
                    Exported
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right action controls */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Offline/Online badge */}
          <div
            title={isOnline ? 'Online (Ready)' : 'Offline mode active (Local processing works 100%)'}
            className={`hidden md:flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border ${
              isOnline
                ? 'bg-slate-50 text-slate-600 border-slate-200'
                : 'bg-amber-50 text-amber-700 border-amber-200'
            }`}
          >
            {isOnline ? <Wifi className="w-3.5 h-3.5 text-slate-500" /> : <WifiOff className="w-3.5 h-3.5 text-amber-600" />}
            <span>{isOnline ? 'Local' : 'Offline'}</span>
          </div>

          {/* Setup Architecture & Install guide button: [?] on small screen, [? Guide] on desktop */}
          <button
            id="setup-guide-btn"
            onClick={onOpenSetupGuide}
            className="flex items-center justify-center gap-1 px-2 sm:px-3 py-1.5 rounded-lg border border-slate-200 text-xs sm:text-sm font-semibold text-slate-700 hover:bg-slate-100 active:bg-slate-200 transition shrink-0"
            title="Help, Architecture & Install Instructions"
            aria-label="Help and Setup Guide"
          >
            <HelpCircle className="w-4 h-4 text-blue-600 shrink-0" />
            <span className="hidden sm:inline font-medium">Guide</span>
          </button>

          {/* Hidden file input for opening documents */}
          {onFileSelect && (
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf,application/x-pdf"
              className="hidden"
              onChange={handleFileChange}
            />
          )}

          {/* Open Another PDF Button */}
          {hasDocument && onFileSelect && (
            <button
              id="header-open-pdf-btn"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg border border-slate-200 text-xs sm:text-sm font-medium text-slate-700 hover:bg-slate-100 active:bg-slate-200 transition"
              title="Open or replace current PDF"
            >
              <FolderOpen className="w-4 h-4 text-slate-600 shrink-0" />
              <span className="hidden sm:inline">Open PDF</span>
            </button>
          )}

          {/* Close Document Button */}
          {hasDocument && onCloseDocument && (
            <button
              id="header-close-doc-btn"
              onClick={onCloseDocument}
              className="flex items-center gap-1 px-2 sm:px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs sm:text-sm font-medium text-slate-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition"
              title="Close current document"
              aria-label="Close document"
            >
              <X className="w-4 h-4 shrink-0" />
              <span className="hidden md:inline">Close</span>
            </button>
          )}

          {/* Export PDF Button (hidden on small screen where it's already in the mobile bottom bar) */}
          {hasDocument && (
            <button
              id="header-export-btn"
              onClick={onOpenExport}
              className="hidden sm:flex items-center gap-1.5 px-3 sm:px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-xs sm:text-sm font-medium shadow-xs transition"
            >
              <Download className="w-4 h-4 shrink-0" />
              <span>Export PDF</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
