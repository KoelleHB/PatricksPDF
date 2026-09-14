import React, { useRef } from 'react';
import {
  Upload,
  FileText,
  Sparkles,
  Layers,
  Smartphone,
} from 'lucide-react';

interface EmptyStateProps {
  onFileSelect: (file: File) => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  onFileSelect,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isPdfFile = (file: File) => {
    return (
      file.type === 'application/pdf' ||
      file.type === 'application/x-pdf' ||
      file.type === 'application/acrobat' ||
      file.name.toLowerCase().endsWith('.pdf')
    );
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && isPdfFile(file)) {
      onFileSelect(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && isPdfFile(file)) {
      onFileSelect(file);
    } else if (file) {
      // Still attempt to pass if user picked it intentionally
      onFileSelect(file);
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-8 max-w-4xl mx-auto w-full">
      <div className="w-full max-w-xl flex flex-col gap-5">
        {/* Main Upload Area */}
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-slate-300 hover:border-blue-500 bg-white hover:bg-blue-50/20 rounded-3xl p-6 sm:p-10 text-center cursor-pointer transition shadow-xs flex flex-col items-center justify-center gap-3 group"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={handleInputChange}
          />

          <div className="w-14 h-14 rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center group-hover:scale-110 transition-transform shadow-xs">
            <FileText className="w-7 h-7" />
          </div>

          <div>
            <h2 className="text-lg sm:text-xl font-bold text-slate-900">
              Select or Drop a PDF File
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 mt-1 max-w-sm mx-auto">
              Tap here to pick any PDF from your Android phone or computer.
            </p>
          </div>

          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 group-hover:bg-blue-700 text-white font-semibold text-xs sm:text-sm shadow-xs transition mt-2">
            <Upload className="w-4 h-4" />
            <span>Browse Files</span>
          </div>
        </div>

        {/* Feature Highlights Bento */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
          <div className="bg-white p-3.5 rounded-2xl border border-slate-200 flex flex-col gap-1.5">
            <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
            <h3 className="text-xs font-bold text-slate-900">Transparent Background</h3>
            <p className="text-[11px] text-slate-500 leading-normal">
              Turns white paper on your signature photo completely transparent via canvas pixel filter.
            </p>
          </div>

          <div className="bg-white p-3.5 rounded-2xl border border-slate-200 flex flex-col gap-1.5">
            <div className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Layers className="w-4 h-4" />
            </div>
            <h3 className="text-xs font-bold text-slate-900">Choose Placement & Size</h3>
            <p className="text-[11px] text-slate-500 leading-normal">
              Drag, resize with touch handles, center, and fine-tune placement on any page.
            </p>
          </div>

          <div className="bg-white p-3.5 rounded-2xl border border-slate-200 flex flex-col gap-1.5">
            <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Smartphone className="w-4 h-4" />
            </div>
            <h3 className="text-xs font-bold text-slate-900">Runs Locally on Android</h3>
            <p className="text-[11px] text-slate-500 leading-normal">
              100% offline-ready PWA. Zero file uploads, strict privacy, and fast processing on device.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
