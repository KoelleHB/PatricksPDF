import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, Search, X } from 'lucide-react';
import {
  PdfSearchHit, PdfSearchProgress, searchPdfDocument,
} from '../utils/pdfSearch';

interface PdfSearchPanelProps {
  arrayBuffer: ArrayBuffer;
  onClose: () => void;
  onNavigate: (hit: PdfSearchHit, phrase: string) => void;
}

export const PdfSearchPanel: React.FC<PdfSearchPanelProps> = ({
  arrayBuffer, onClose, onNavigate,
}) => {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<PdfSearchHit[]>([]);
  const [progress, setProgress] = useState<PdfSearchProgress | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    let cancelled = false;
    setHits([]);
    setProgress(null);
    setActiveIndex(-1);
    setError(null);
    setSearching(Boolean(query.trim()));

    if (!query.trim()) return () => { cancelled = true; };

    const timer = setTimeout(() => {
      searchPdfDocument(
        arrayBuffer, query.trim(),
        (status, nextHits) => {
          if (!cancelled) {
            setProgress(status);
            setHits(nextHits);
          }
        },
        () => cancelled,
      ).then(({ hits: completed, progress: status }) => {
        if (!cancelled) {
          setHits(completed);
          setProgress(status);
          setSearching(false);
        }
      }).catch((err: any) => {
        if (!cancelled) {
          setError(err?.message || 'Die PDF konnte nicht durchsucht werden.');
          setSearching(false);
        }
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [arrayBuffer, query]);

  const selectResult = (index: number) => {
    if (!hits.length) return;
    const next = (index + hits.length) % hits.length;
    setActiveIndex(next);
    onNavigate(hits[next], query.trim());
  };

  return (
    <section
      role="search"
      aria-label="PDF-Volltextsuche"
      className="absolute top-12 right-2 left-2 sm:left-auto sm:w-[420px] z-40 bg-white rounded-xl border border-slate-300 shadow-2xl overflow-hidden"
    >
      <div className="flex items-center gap-2 p-2.5 border-b border-slate-200">
        <Search className="w-4 h-4 text-blue-600 shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              selectResult(activeIndex + (event.shiftKey ? -1 : 1));
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
            }
          }}
          type="search"
          aria-label="Im gesamten PDF suchen"
          placeholder="Im ganzen PDF suchen …"
          className="flex-1 min-w-0 outline-none text-sm bg-transparent text-slate-900"
        />
        <button
          type="button" onClick={() => selectResult(activeIndex - 1)}
          disabled={hits.length === 0}
          title="Vorheriger Treffer (Umschalt+Enter)"
          aria-label="Vorheriger Treffer"
          className="p-1 rounded hover:bg-slate-100 disabled:opacity-30"
        ><ChevronUp className="w-4 h-4" /></button>
        <button
          type="button" onClick={() => selectResult(activeIndex + 1)}
          disabled={hits.length === 0}
          title="Nächster Treffer (Enter)"
          aria-label="Nächster Treffer"
          className="p-1 rounded hover:bg-slate-100 disabled:opacity-30"
        ><ChevronDown className="w-4 h-4" /></button>
        <button
          type="button" onClick={onClose}
          aria-label="Suche schließen"
          title="Suche schließen"
          className="p-1 rounded hover:bg-slate-100"
        ><X className="w-4 h-4" /></button>
      </div>

      <div className="px-3 py-2 text-xs text-slate-600 border-b border-slate-100 flex items-center gap-2">
        {searching && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        {!query.trim()
          ? 'Suchbegriff eingeben · Strg+F'
          : error
            ? <span className="text-red-700">{error}</span>
            : searching
              ? `Durchsuche ${progress?.scannedPages || 0} / ${progress?.totalPages || '…'} Seiten · ${hits.length} Treffer`
              : `${hits.length} Treffer${activeIndex >= 0 ? ` · ${activeIndex + 1} / ${hits.length}` : ''}`}
        {progress?.truncated && <span className="text-amber-700">Erste 1000 Treffer</span>}
      </div>

      {query.trim() && hits.length > 0 && (
        <div className="max-h-[min(45vh,360px)] overflow-y-auto overscroll-contain">
          {hits.map((hit, index) => (
            <button
              type="button"
              key={`${hit.pageNumber}-${hit.ordinal}`}
              onClick={() => selectResult(index)}
              className={`block text-left w-full px-3 py-2 border-b border-slate-100 hover:bg-blue-50 ${activeIndex === index ? 'bg-blue-100' : ''}`}
              aria-current={activeIndex === index ? 'true' : undefined}
            >
              <span className="text-xs font-semibold text-blue-700">Seite {hit.pageNumber}</span>
              <span className="block text-xs leading-5 text-slate-700 break-words">
                {hit.before}<mark className="bg-amber-200 font-semibold text-slate-900 rounded-sm">{hit.match}</mark>{hit.after}
              </span>
            </button>
          ))}
        </div>
      )}
      {!searching && query.trim() && hits.length === 0 && !error && (
        <div className="px-3 py-4 text-sm text-slate-500">Keine Treffer im PDF-Text gefunden.</div>
      )}
      <p className="px-3 py-2 text-[11px] text-slate-400 border-t border-slate-100">
        Offline-Suche in eingebettetem PDF-Text. Scans ohne Textschicht erfordern OCR.
      </p>
    </section>
  );
};
