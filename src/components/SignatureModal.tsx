import React, { useState, useEffect, useRef } from 'react';
import {
  Upload,
  PenTool,
  Sliders,
  Check,
  X,
  RefreshCw,
  Crop,
  Layers,
  Sparkles,
  ArrowRight,
  Eye,
  FileImage,
} from 'lucide-react';
import { TransparencyOptions, SignatureItem } from '../types';
import { removeWhiteBackground, ProcessedImageResult } from '../utils/imageProcessor';
import { HandwrittenSignaturePad } from './HandwrittenSignaturePad';

interface SignatureModalProps {
  isOpen: boolean;
  currentPage: number;
  onClose: () => void;
  onAddSignature: (item: Omit<SignatureItem, 'id' | 'xPercent' | 'yPercent' | 'pageNumber'>) => void;
}

export const SignatureModal: React.FC<SignatureModalProps> = ({
  isOpen,
  currentPage,
  onClose,
  onAddSignature,
}) => {
  const [activeTab, setActiveTab] = useState<'upload' | 'draw'>('upload');
  const [rawImageSrc, setRawImageSrc] = useState<string>('');
  const [signatureName, setSignatureName] = useState<string>('Signature');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [processedResult, setProcessedResult] = useState<ProcessedImageResult | null>(null);

  // Transparency adjustment options
  const [options, setOptions] = useState<TransparencyOptions>({
    threshold: 230,
    feather: 4,
    inkMode: 'preserve',
    autoCrop: true,
  });

  // Drawn signature state
  const [drawnResult, setDrawnResult] = useState<ProcessedImageResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Process white background removal whenever rawImageSrc or options change
  useEffect(() => {
    if (!rawImageSrc) return;

    let isMounted = true;
    setIsProcessing(true);

    const timer = setTimeout(async () => {
      try {
        const result = await removeWhiteBackground(rawImageSrc, options);
        if (isMounted) {
          setProcessedResult(result);
          setIsProcessing(false);
        }
      } catch (err) {
        console.error('Failed to process image:', err);
        if (isMounted) setIsProcessing(false);
      }
    }, 80);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [rawImageSrc, options]);

  if (!isOpen) return null;

  // Handle file selection from phone camera or gallery
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      if (typeof event.target?.result === 'string') {
        setRawImageSrc(event.target.result);
        setSignatureName(file.name.replace(/\.[^/.]+$/, ''));
        setActiveTab('upload');
      }
    };
    reader.readAsDataURL(file);
  };

  const activeResult = activeTab === 'draw' ? drawnResult : processedResult;

  const handleApply = () => {
    if (!activeResult) return;

    onAddSignature({
      name: signatureName || (activeTab === 'draw' ? 'Handwritten Signature' : 'Signature'),
      transparentDataUrl: activeResult.transparentDataUrl,
      pngBytes: activeResult.pngBytes,
      originalDataUrl: activeTab === 'draw' ? activeResult.transparentDataUrl : rawImageSrc,
      widthPercent: 28, // Default comfortable signature width
      aspectRatio: activeResult.aspectRatio,
      opacity: 1.0,
      rotation: 0,
    });

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in zoom-in duration-150">
        {/* Header */}
        <div className="px-4 sm:px-6 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center font-bold">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900 leading-tight">
                Add Signature & Make Background Transparent
              </h2>
              <p className="text-xs text-slate-500">
                Removes white paper background and converts signature to high-res transparent PNG
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

        {/* Source Switcher Tabs */}
        <div className="flex border-b border-slate-200 bg-white px-4 pt-2 gap-2 text-xs sm:text-sm font-medium">
          <button
            onClick={() => setActiveTab('upload')}
            className={`pb-2 px-3 border-b-2 transition flex items-center gap-1.5 ${
              activeTab === 'upload'
                ? 'border-blue-600 text-blue-600 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Upload JPG Photo</span>
          </button>
          <button
            onClick={() => setActiveTab('draw')}
            className={`pb-2 px-3 border-b-2 transition flex items-center gap-1.5 ${
              activeTab === 'draw'
                ? 'border-blue-600 text-blue-600 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <PenTool className="w-3.5 h-3.5" />
            <span>Draw with Finger</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4">
          {/* Tab 1: Upload File */}
          {activeTab === 'upload' && (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-300 hover:border-blue-500 bg-slate-50/50 hover:bg-blue-50/30 rounded-xl p-5 text-center cursor-pointer transition flex flex-col items-center justify-center gap-2"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/webp"
                className="hidden"
                onChange={handleFileChange}
              />
              <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
                <FileImage className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800">
                  Tap to choose a signature JPG from your phone
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Takes any photo or scan of a signature on white paper
                </p>
              </div>
            </div>
          )}

          {/* Tab 2: Draw on Touch Screen */}
          {activeTab === 'draw' && (
            <div className="space-y-3">
              <HandwrittenSignaturePad onSignatureChange={setDrawnResult} />

              {/* Live Preview of the Drawn Signature */}
              {drawnResult && (
                <div className="space-y-2 pt-2 border-t border-slate-100">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                    <span className="flex items-center gap-1.5 text-emerald-700">
                      <Sparkles className="w-3.5 h-3.5" />
                      Handwritten Transparent PNG Preview
                    </span>
                    <span className="text-[11px] font-mono text-slate-500">
                      {drawnResult.width} × {drawnResult.height}px (300+ DPI Lossless)
                    </span>
                  </div>
                  <div
                    className="h-28 rounded-xl border border-emerald-300 p-2 flex items-center justify-center overflow-hidden shadow-inner relative"
                    style={{
                      backgroundImage: `
                        linear-gradient(45deg, #e2e8f0 25%, transparent 25%), 
                        linear-gradient(-45deg, #e2e8f0 25%, transparent 25%), 
                        linear-gradient(45deg, transparent 75%, #e2e8f0 75%), 
                        linear-gradient(-45deg, transparent 75%, #e2e8f0 75%)
                      `,
                      backgroundSize: '16px 16px',
                      backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
                      backgroundColor: '#f8fafc',
                    }}
                  >
                    <img
                      src={drawnResult.transparentDataUrl}
                      alt="Drawn Signature Preview"
                      className="max-h-full max-w-full object-contain drop-shadow-sm"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Empty state prompt for upload tab if no image uploaded yet */}
          {activeTab === 'upload' && !rawImageSrc && (
            <div className="py-6 px-4 text-center rounded-xl bg-slate-50 border border-slate-200">
              <p className="text-xs sm:text-sm font-medium text-slate-700">
                Select or drag an image of your signature above
              </p>
              <p className="text-[11px] text-slate-400 mt-1">
                The white paper background will be automatically removed to produce a clean transparent signature.
              </p>
            </div>
          )}

          {/* Before & After Interactive Preview for upload tab */}
          {activeTab === 'upload' && rawImageSrc && (
            <div className="space-y-3 pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  White Removal Live Preview
                </span>
                {isProcessing && (
                  <span className="text-xs text-blue-600 flex items-center gap-1">
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    Updating...
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Original (White Background) */}
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-[11px] text-slate-500 font-medium">
                    <span>Original (White JPG)</span>
                    <span className="px-1.5 py-0.2 bg-slate-100 text-slate-600 rounded text-[10px]">Solid White</span>
                  </div>
                  <div className="h-32 bg-white rounded-xl border border-slate-200 p-2 flex items-center justify-center overflow-hidden shadow-inner">
                    <img
                      src={rawImageSrc}
                      alt="Original"
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>
                </div>

                {/* Processed (Transparent Checkerboard) */}
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-[11px] text-slate-500 font-medium">
                    <span className="text-emerald-700 font-bold">Transparent Result (PNG)</span>
                    <span className="px-1.5 py-0.2 bg-emerald-100 text-emerald-800 rounded text-[10px]">Transparent</span>
                  </div>
                  {/* Checkerboard Pattern for transparent background visualization */}
                  <div
                    className="h-32 rounded-xl border border-emerald-300 p-2 flex items-center justify-center overflow-hidden shadow-inner relative"
                    style={{
                      backgroundImage: `
                        linear-gradient(45deg, #e2e8f0 25%, transparent 25%), 
                        linear-gradient(-45deg, #e2e8f0 25%, transparent 25%), 
                        linear-gradient(45deg, transparent 75%, #e2e8f0 75%), 
                        linear-gradient(-45deg, transparent 75%, #e2e8f0 75%)
                      `,
                      backgroundSize: '16px 16px',
                      backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
                      backgroundColor: '#f8fafc',
                    }}
                  >
                    {processedResult ? (
                      <img
                        src={processedResult.transparentDataUrl}
                        alt="Transparent Preview"
                        className="max-h-full max-w-full object-contain drop-shadow-sm"
                      />
                    ) : (
                      <div className="text-xs text-slate-400">Processing...</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Fine-Tuning Controls */}
              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-3">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                  <span className="flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5 text-blue-600" />
                    White Removal Sensitivity & Ink Tuning
                  </span>
                  <button
                    onClick={() =>
                      setOptions({
                        threshold: 230,
                        feather: 4,
                        inkMode: 'preserve',
                        autoCrop: true,
                      })
                    }
                    className="text-[11px] text-blue-600 hover:underline"
                  >
                    Reset Defaults
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  {/* Threshold Slider */}
                  <div>
                    <div className="flex justify-between text-[11px] text-slate-600 mb-1">
                      <span>White Removal Threshold</span>
                      <span className="font-mono font-bold text-slate-900">{options.threshold}</span>
                    </div>
                    <input
                      type="range"
                      min={180}
                      max={254}
                      value={options.threshold}
                      onChange={(e) =>
                        setOptions({ ...options, threshold: Number(e.target.value) })
                      }
                      className="w-full accent-blue-600 cursor-pointer"
                    />
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      Increase if paper shadows remain; decrease if pen ink gets erased.
                    </p>
                  </div>

                  {/* Feather Slider */}
                  <div>
                    <div className="flex justify-between text-[11px] text-slate-600 mb-1">
                      <span>Edge Softness / Feather</span>
                      <span className="font-mono font-bold text-slate-900">{options.feather}px</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={16}
                      value={options.feather}
                      onChange={(e) =>
                        setOptions({ ...options, feather: Number(e.target.value) })
                      }
                      className="w-full accent-blue-600 cursor-pointer"
                    />
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      Smooths stroke boundaries to avoid harsh pixel edges.
                    </p>
                  </div>
                </div>

                {/* Ink Mode and Auto-Crop */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-200/60 text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-600 text-[11px] font-medium">Ink Enhancement:</span>
                    <div className="inline-flex rounded-lg border border-slate-300 p-0.5 bg-white">
                      {(
                        [
                          { id: 'preserve', label: 'Original' },
                          { id: 'darken', label: 'Darken' },
                          { id: 'blue-ink', label: 'Blue Ink' },
                          { id: 'black-ink', label: 'Black Ink' },
                        ] as const
                      ).map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setOptions({ ...options, inkMode: m.id })}
                          className={`px-2 py-0.5 rounded-md text-[11px] transition ${
                            options.inkMode === m.id
                              ? 'bg-blue-600 text-white font-semibold shadow-xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <label className="flex items-center gap-1.5 cursor-pointer select-none text-[11px] text-slate-700 font-medium">
                    <input
                      type="checkbox"
                      checked={options.autoCrop}
                      onChange={(e) =>
                        setOptions({ ...options, autoCrop: e.target.checked })
                      }
                      className="rounded text-blue-600 focus:ring-blue-500"
                    />
                    <span>Trim empty white margins</span>
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-200 text-xs sm:text-sm font-medium transition"
          >
            Cancel
          </button>

          <button
            id="apply-signature-to-pdf-btn"
            disabled={!activeResult || (activeTab === 'upload' && isProcessing)}
            onClick={handleApply}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 text-white text-xs sm:text-sm font-semibold shadow-md transition"
          >
            <span>Place on Page {currentPage}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
