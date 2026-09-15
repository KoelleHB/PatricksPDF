import React, { useState, useRef } from 'react';
import { FileSignature, Download, Info, CheckCircle2, Wifi, WifiOff, Smartphone, HelpCircle, FolderOpen } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface HeaderProps {
  documentName: string;
  hasDocument: boolean;
  signatureCount: number;
  onOpenSetupGuide: () => void;
  onOpenExport: () => void;
  onFileSelect?: (file: File) => void;
}

export const Header: React.FC<HeaderProps> = ({
  documentName,
  hasDocument,
  signatureCount,
  onOpenSetupGuide,
  onOpenExport,
  onFileSelect,
}) => {
  const { isInstallable, isInstalled, isIOS, isAndroid, install } = usePWAInstall();
  const [showInstallGuide, setShowInstallGuide] = useState(false);
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

  const handleInstallClick = async () => {
    if (isInstallable) {
      await install();
    } else {
      setShowInstallGuide(true);
    }
  };

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
              <p className="text-xs text-slate-500 truncate max-w-[200px] sm:max-w-xs md:max-w-md">
                {documentName} {signatureCount > 0 && `• ${signatureCount} signature${signatureCount > 1 ? 's' : ''}`}
              </p>
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

          {/* Setup Architecture guide button */}
          <button
            id="setup-guide-btn"
            onClick={onOpenSetupGuide}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg border border-slate-200 text-xs sm:text-sm font-medium text-slate-700 hover:bg-slate-100 active:bg-slate-200 transition"
            title="How this app works and runs on Android"
          >
            <HelpCircle className="w-4 h-4 text-blue-600 shrink-0" />
            <span className="hidden sm:inline">Setup Architecture</span>
            <span className="sm:hidden">Guide</span>
          </button>

          {/* PWA Install Button */}
          {!isInstalled && (
            <button
              id="pwa-install-header-btn"
              onClick={handleInstallClick}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-800 text-xs sm:text-sm font-medium shadow-xs transition"
              title="Install app to your Android home screen"
            >
              <Smartphone className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="hidden sm:inline">Install on Phone</span>
              <span className="sm:hidden">Install</span>
            </button>
          )}

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

          {/* Export PDF Button */}
          {hasDocument && (
            <button
              id="header-export-btn"
              onClick={onOpenExport}
              className="flex items-center gap-1.5 px-3 sm:px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-xs sm:text-sm font-medium shadow-xs transition"
            >
              <Download className="w-4 h-4 shrink-0" />
              <span>Export PDF</span>
            </button>
          )}
        </div>
      </div>

      {/* Android / iOS Install Guide Dialog if native prompt not triggered */}
      {showInstallGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in duration-150">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center font-bold">
                <Smartphone className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Install to Android / Phone</h3>
                <p className="text-xs text-slate-500">Run completely local & offline</p>
              </div>
            </div>

            <div className="space-y-2.5 text-xs sm:text-sm text-slate-600 my-4 bg-slate-50 p-3 rounded-xl border border-slate-200">
              <div className="flex items-start gap-2">
                <span className="font-bold text-blue-600">1.</span>
                <span>Tap the browser menu (<strong>⋮</strong> in Chrome on Android, or <strong>Share</strong> in Safari).</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="font-bold text-blue-600">2.</span>
                <span>Select <strong>"Install app"</strong> or <strong>"Add to Home screen"</strong>.</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="font-bold text-blue-600">3.</span>
                <span>Launch the app directly from your home screen anytime without an internet connection!</span>
              </div>
            </div>

            <button
              onClick={() => setShowInstallGuide(false)}
              className="w-full py-2.5 rounded-xl bg-blue-600 text-white font-medium text-sm hover:bg-blue-700 transition"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </header>
  );
};
