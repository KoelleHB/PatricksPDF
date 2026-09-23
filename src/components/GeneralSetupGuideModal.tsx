import React from 'react';
import { X, Cpu, Smartphone, Layers, ShieldCheck, Download, Sparkles, Check, ExternalLink } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface GeneralSetupGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const GeneralSetupGuideModal: React.FC<GeneralSetupGuideModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { isInstallable, isInstalled, isIOS, isAndroid, install } = usePWAInstall();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in zoom-in duration-150">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center font-bold">
              <Cpu className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 leading-tight">
                PatricksPDF Guide & Instructions
              </h3>
              <p className="text-xs text-slate-500">
                Installation, offline setup, and security architecture
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-5 text-sm text-slate-700">
          {/* Section 1: Step-by-Step App Installation */}
          <div className="p-4 rounded-xl bg-gradient-to-br from-blue-50/80 to-indigo-50/50 border border-blue-200/80 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center">
                  <Smartphone className="w-4 h-4" />
                </div>
                <h4 className="font-bold text-slate-900 text-sm sm:text-base">
                  How to Install PatricksPDF
                </h4>
              </div>
              {isInstalled ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
                  <Check className="w-3.5 h-3.5" /> Installed
                </span>
              ) : isInstallable ? (
                <button
                  onClick={async () => {
                    await install();
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs transition"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Install App Now</span>
                </button>
              ) : null}
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              PatricksPDF is a Progressive Web App (PWA) that installs directly on your device like a native application, with full offline functionality and zero data leaving your phone.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              {/* Android Instructions */}
              <div className="bg-white/90 p-3 rounded-xl border border-blue-100 shadow-2xs space-y-1.5">
                <span className="font-semibold text-xs text-blue-900 flex items-center gap-1.5">
                  <span className="w-4 h-4 rounded-full bg-blue-100 text-blue-700 text-[11px] font-bold inline-flex items-center justify-center">
                    A
                  </span>
                  On Android (Chrome / Firefox / Samsung)
                </span>
                <ol className="text-xs text-slate-600 space-y-1 list-decimal list-inside leading-normal">
                  <li>
                    Tap the <strong>three dots (⋮)</strong> menu in your browser.
                  </li>
                  <li>
                    Select <strong>"Install app"</strong> or <strong>"Add to Home screen"</strong>.
                  </li>
                  <li>
                    Tap <strong>Add / Install</strong> to place the icon on your screen.
                  </li>
                </ol>
              </div>

              {/* iOS / iPhone Instructions */}
              <div className="bg-white/90 p-3 rounded-xl border border-blue-100 shadow-2xs space-y-1.5">
                <span className="font-semibold text-xs text-blue-900 flex items-center gap-1.5">
                  <span className="w-4 h-4 rounded-full bg-blue-100 text-blue-700 text-[11px] font-bold inline-flex items-center justify-center">
                    B
                  </span>
                  On iPhone & iPad (Safari)
                </span>
                <ol className="text-xs text-slate-600 space-y-1 list-decimal list-inside leading-normal">
                  <li>
                    Tap the <strong>Share</strong> button (box with upward arrow).
                  </li>
                  <li>
                    Scroll down and tap <strong>"Add to Home Screen"</strong>.
                  </li>
                  <li>
                    Tap <strong>Add</strong> in the top-right corner.
                  </li>
                </ol>
              </div>
            </div>

            <div className="text-[11px] text-slate-500 bg-white/60 p-2 rounded-lg border border-blue-100">
              💡 <strong>On PC / Mac:</strong> Look for the small computer/install icon in your browser address bar on the right to install PatricksPDF as a desktop app.
            </div>
          </div>

          {/* Section 2: White Background to Transparent PNG */}
          <div className="flex items-start gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
            <Sparkles className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="font-bold text-slate-900 text-xs sm:text-sm">
                White-to-Transparent Chroma Engine
              </h4>
              <p className="text-xs text-slate-600 leading-relaxed">
                When you snap a photo or upload a picture of a handwritten signature on paper:
              </p>
              <ul className="text-xs text-slate-600 list-disc list-inside space-y-1 pl-1">
                <li>
                  The image is rendered on an offscreen canvas and inspected pixel-by-pixel.
                </li>
                <li>
                  Pixels exceeding the background luminance threshold are converted to pure transparency, preserving dark ink strokes cleanly.
                </li>
                <li>
                  The vector-level transparent PNG embeds cleanly without obscuring underlying document text.
                </li>
              </ul>
            </div>
          </div>

          {/* Section 3: PDF Placement & Coordinate Transformation */}
          <div className="flex items-start gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
            <Layers className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="font-bold text-slate-900 text-xs sm:text-sm">
                Interactive Placement & High-Res Embedding
              </h4>
              <p className="text-xs text-slate-600 leading-relaxed">
                Positioning is normalized into viewport percentages so your signatures and custom text overlays adapt fluidly across phones, tablets, and desktops. During PDF generation, coordinates are converted into precise 72-DPI PostScript points.
              </p>
            </div>
          </div>

          {/* Section 4: Privacy & Zero Server Upload */}
          <div className="flex items-start gap-3 p-3.5 rounded-xl bg-emerald-50/60 border border-emerald-200">
            <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="font-bold text-emerald-950 text-xs sm:text-sm">
                100% Client-Side Privacy (Zero Cloud Uploads)
              </h4>
              <p className="text-xs text-emerald-800 leading-relaxed">
                Your contracts, documents, and signatures never leave your browser memory. All parsing, rendering, and vector modification happens locally on your device.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-900 text-white font-medium text-xs sm:text-sm hover:bg-slate-800 transition"
          >
            Close Guide
          </button>
        </div>
      </div>
    </div>
  );
};
