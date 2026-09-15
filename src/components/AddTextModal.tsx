import React, { useState } from 'react';
import {
  X,
  Type,
  Check,
  Palette,
  Sparkles,
} from 'lucide-react';
import { TextFontFamily, TextColor } from '../types';

interface AddTextModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddText: (text: string, fontFamily: TextFontFamily, color: TextColor, fontSize: number) => void;
}

export const AddTextModal: React.FC<AddTextModalProps> = ({
  isOpen,
  onClose,
  onAddText,
}) => {
  const [text, setText] = useState('');
  const [fontFamily, setFontFamily] = useState<TextFontFamily>('standard');
  const [color, setColor] = useState<TextColor>('black');
  const [fontSize, setFontSize] = useState<number>(14);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    onAddText(text, fontFamily, color, fontSize);
    setText('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-4">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center">
              <Type className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 leading-tight">
                Add Text to PDF
              </h3>
              <p className="text-xs text-slate-500">
                Place vector text in Regular or Script style
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

        {/* Content Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Text Input */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Text Content
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Enter text, name, date, notes..."
              rows={3}
              autoFocus
              className={`w-full px-3 py-2 text-sm rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-500 transition-all ${
                fontFamily === 'script' ? 'font-script text-lg' : 'font-sans'
              } ${
                color === 'red' ? 'text-red-600' : color === 'blue' ? 'text-blue-900' : 'text-slate-900'
              }`}
            />
          </div>

          {/* Font Selection */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Font Style
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setFontFamily('standard')}
                className={`py-2.5 px-3 rounded-xl border text-xs sm:text-sm font-medium flex items-center justify-center gap-2 transition ${
                  fontFamily === 'standard'
                    ? 'border-blue-600 bg-blue-50 text-blue-700 ring-1 ring-blue-600 font-sans'
                    : 'border-slate-200 text-slate-700 hover:bg-slate-50 font-sans'
                }`}
              >
                <Type className="w-4 h-4" />
                <span>Regular (Standard)</span>
              </button>

              <button
                type="button"
                onClick={() => setFontFamily('script')}
                className={`py-2.5 px-3 rounded-xl border text-sm font-medium flex items-center justify-center gap-2 transition ${
                  fontFamily === 'script'
                    ? 'border-blue-600 bg-blue-50 text-blue-700 ring-1 ring-blue-600 font-script text-base'
                    : 'border-slate-200 text-slate-700 hover:bg-slate-50 font-script text-base'
                }`}
              >
                <Sparkles className="w-4 h-4 text-amber-500" />
                <span>Script (Handwriting)</span>
              </button>
            </div>
          </div>

          {/* Color Selection */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Ink Color
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setColor('black')}
                className={`py-2 px-2.5 rounded-xl border text-xs font-medium flex items-center justify-center gap-1.5 transition ${
                  color === 'black'
                    ? 'border-slate-900 bg-slate-100 text-slate-900 ring-1 ring-slate-900 font-semibold'
                    : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span className="w-3.5 h-3.5 rounded-full bg-slate-950 border border-slate-300 shrink-0" />
                <span>Black</span>
                {color === 'black' && <Check className="w-3.5 h-3.5 ml-auto hidden sm:inline" />}
              </button>

              <button
                type="button"
                onClick={() => setColor('blue')}
                className={`py-2 px-2.5 rounded-xl border text-xs font-medium flex items-center justify-center gap-1.5 transition ${
                  color === 'blue'
                    ? 'border-blue-700 bg-blue-50 text-blue-800 ring-1 ring-blue-700 font-semibold'
                    : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span className="w-3.5 h-3.5 rounded-full bg-blue-700 border border-blue-400 shrink-0" />
                <span>Blue</span>
                {color === 'blue' && <Check className="w-3.5 h-3.5 ml-auto hidden sm:inline" />}
              </button>

              <button
                type="button"
                onClick={() => setColor('red')}
                className={`py-2 px-2.5 rounded-xl border text-xs font-medium flex items-center justify-center gap-1.5 transition ${
                  color === 'red'
                    ? 'border-red-600 bg-red-50 text-red-700 ring-1 ring-red-600 font-semibold'
                    : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span className="w-3.5 h-3.5 rounded-full bg-red-600 border border-red-400 shrink-0" />
                <span>Red</span>
                {color === 'red' && <Check className="w-3.5 h-3.5 ml-auto hidden sm:inline" />}
              </button>
            </div>
          </div>

          {/* Font Size */}
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-slate-700">
              Font Size: <span className="font-mono text-blue-600">{fontSize} pt</span>
            </label>
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200">
              {[11, 14, 18, 24].map((sz) => (
                <button
                  key={sz}
                  type="button"
                  onClick={() => setFontSize(sz)}
                  className={`px-2 py-0.5 rounded text-xs font-medium transition ${
                    fontSize === sz ? 'bg-white shadow-xs text-blue-600 font-bold' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {sz}
                </button>
              ))}
            </div>
          </div>

          {/* Live Preview Box */}
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
              Live Preview
            </span>
            <div
              className={`min-h-[36px] flex items-center ${
                fontFamily === 'script' ? 'font-script text-xl' : 'font-sans text-sm'
              } ${
                color === 'red' ? 'text-red-600' : color === 'blue' ? 'text-blue-800' : 'text-slate-950'
              }`}
            >
              {text || <span className="text-slate-400 italic">Your preview will appear here...</span>}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 font-medium text-xs sm:text-sm transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!text.trim()}
              className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 text-white font-semibold text-xs sm:text-sm shadow-md transition"
            >
              Place Text on Page
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
