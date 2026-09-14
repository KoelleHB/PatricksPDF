import React from 'react';
import { X, Cpu, Smartphone, Layers, ShieldCheck, FileCheck, ArrowRight, Sparkles } from 'lucide-react';

interface GeneralSetupGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const GeneralSetupGuideModal: React.FC<GeneralSetupGuideModalProps> = ({
  isOpen,
  onClose,
}) => {
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
                General Architecture & Setup Guide
              </h3>
              <p className="text-xs text-slate-500">
                How this local web app is structured to run on Android phones
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
          {/* Section 1: Running Locally on Android */}
          <div className="flex items-start gap-3 p-3.5 rounded-xl bg-blue-50/50 border border-blue-100">
            <Smartphone className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="font-bold text-slate-900 text-xs sm:text-sm">
                1. Progressive Web App (PWA) on Android
              </h4>
              <p className="text-xs text-slate-600 leading-relaxed">
                By packaging the app as a PWA (with a Web App Manifest and Service Worker caching via <code>vite-plugin-pwa</code>), you can tap <strong>"Install app"</strong> or <strong>"Add to Home Screen"</strong> in Chrome on Android. Once installed, it behaves just like a native Android APK: it launches full-screen without browser address bars, functions 100% offline, and integrates directly with Android's system file picker and share drawer.
              </p>
            </div>
          </div>

          {/* Section 2: White Background to Transparent PNG */}
          <div className="flex items-start gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
            <Sparkles className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="font-bold text-slate-900 text-xs sm:text-sm">
                2. White-to-Transparent Chroma Engine (HTML5 Canvas)
              </h4>
              <p className="text-xs text-slate-600 leading-relaxed">
                When you choose a signature JPG:
              </p>
              <ul className="text-xs text-slate-600 list-disc list-inside space-y-1 pl-1">
                <li>
                  The image is drawn to an offscreen <code>&lt;canvas&gt;</code> and inspected via <code>getImageData()</code>.
                </li>
                <li>
                  For every pixel, its perceptual luminance is computed (<code>0.299R + 0.587G + 0.114B</code>).
                </li>
                <li>
                  Pixels exceeding the white threshold (e.g. &gt; 230) have their alpha set to <code>0</code> (transparent), with a feathered gradient to prevent jagged halos around pen strokes.
                </li>
                <li>
                  The processed signature is converted to a lossless transparent PNG (data URL + raw bytes) for insertion into the PDF.
                </li>
              </ul>
            </div>
          </div>

          {/* Section 3: PDF Placement & Coordinate Transformation */}
          <div className="flex items-start gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
            <Layers className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="font-bold text-slate-900 text-xs sm:text-sm">
                3. Interactive Placement & PDF Vector Embedding
              </h4>
              <p className="text-xs text-slate-600 leading-relaxed">
                Positioning is normalized into viewport percentages (0% to 100%) so responsiveness is guaranteed across phone screens, tablets, and desktop. During export, <code>pdf-lib</code> maps these percentages to exact PDF typographic points (72 points/inch), inverting the vertical axis to match the PDF coordinate system (where origin 0,0 is at the bottom-left).
              </p>
            </div>
          </div>

          {/* Section 4: Privacy & Zero Server Upload */}
          <div className="flex items-start gap-3 p-3.5 rounded-xl bg-emerald-50/60 border border-emerald-200">
            <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="font-bold text-emerald-950 text-xs sm:text-sm">
                4. Absolute Privacy (No Server Processing)
              </h4>
              <p className="text-xs text-emerald-800 leading-relaxed">
                Traditional PDF editors upload your sensitive legal contracts and signatures to external cloud servers. In this setup, <strong>100% of the byte parsing, image processing, and PDF compilation occurs in your device's memory</strong>. Nothing leaves your phone.
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
