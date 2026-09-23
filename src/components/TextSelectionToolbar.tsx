import React, { useState, useEffect } from 'react';
import { Copy, Check, X, Highlighter } from 'lucide-react';

export const TextSelectionToolbar: React.FC = () => {
  const [selectedText, setSelectedText] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    const handleSelectionChange = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        // Debounce clearing slightly to prevent flickering during clicks
        if (!copied) {
          setSelectedText('');
        }
        return;
      }

      const text = selection.toString().trim();
      if (text.length > 0) {
        setSelectedText(text);
      } else if (!copied) {
        setSelectedText('');
      }
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, [copied]);

  const handleCopy = async () => {
    if (!selectedText) return;

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(selectedText);
      } else {
        // Fallback for older browsers
        const textarea = document.createElement('textarea');
        textarea.value = selectedText;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }

      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch (err) {
      console.warn('Failed to copy text:', err);
    }
  };

  const handleClearSelection = () => {
    try {
      window.getSelection()?.removeAllRanges();
    } catch {
      // ignore
    }
    setSelectedText('');
    setCopied(false);
  };

  if (!selectedText && !copied) return null;

  const charCount = selectedText.length;
  const wordCount = selectedText.split(/\s+/).filter(Boolean).length;

  return (
    <div
      id="text-selection-toolbar"
      role="toolbar"
      aria-label="Marked Text Actions"
      className="fixed bottom-20 sm:bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-slate-900/95 text-white px-3 sm:px-4 py-2 rounded-full shadow-2xl backdrop-blur-md border border-slate-700/60 transition-all duration-200 animate-in fade-in slide-in-from-bottom-3"
    >
      {/* Icon & Count */}
      <div className="flex items-center gap-1.5 text-xs text-slate-300 pr-1 border-r border-slate-700 select-none">
        <Highlighter className="w-3.5 h-3.5 text-blue-400 shrink-0" />
        <span className="font-mono font-medium text-[11px] sm:text-xs">
          {charCount} {charCount === 1 ? 'char' : 'chars'}
          <span className="hidden sm:inline text-slate-400 ml-1">
            ({wordCount} {wordCount === 1 ? 'word' : 'words'})
          </span>
        </span>
      </div>

      {/* Copy Button */}
      <button
        id="copy-selected-text-btn"
        onClick={handleCopy}
        className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold shadow-xs transition-all cursor-pointer ${
          copied
            ? 'bg-emerald-600 text-white'
            : 'bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white'
        }`}
        title="Copy marked text to clipboard (Ctrl+C)"
      >
        {copied ? (
          <>
            <Check className="w-3.5 h-3.5 animate-in zoom-in" />
            <span>Copied!</span>
          </>
        ) : (
          <>
            <Copy className="w-3.5 h-3.5" />
            <span>Copy</span>
          </>
        )}
      </button>

      {/* Clear Button */}
      <button
        onClick={handleClearSelection}
        className="p-1 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
        title="Clear selection (Esc)"
        aria-label="Clear selection"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
