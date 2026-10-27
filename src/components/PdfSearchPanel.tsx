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
  // The mobile results drawer is opt-in; desktop results remain inline.
  const [resultsExpanded, setResultsExpanded] = useState(false);
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
          setError(err?.message || 'Could not search the PDF.');
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
    // On phones, dismiss both the results drawer and virtual keyboard so the
    // highlighted hit is actually visible in the document.
    setResultsExpanded(false);
    inputRef.current?.blur();
    onNavigate(hits[next], query.trim());
  };

  return (
    <section
      role="search"
      aria-label="PDF full-text search"
      className="shrink-0 w-full z-40 bg-white border-b border-slate-200 shadow-xs sm:absolute sm:top-12 sm:right-2 sm:left-auto sm:w-[420px] sm:rounded-xl sm:border sm:border-slate-300 sm:shadow-2xl"
    >
      <div className="flex items-center gap-2 px-2.5 py-2 border-b border-slate-100 sm:p-2.5 sm:border-slate-200">
        <Search className="w-4 h-4 text-blue-600 shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setResultsExpanded(false);
          }}
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
          aria-label="Search entire PDF"
          placeholder="Search in PDF…"
          className="flex-1 min-w-0 outline-none text-base sm:text-sm bg-transparent text-slate-900"
        />
        {query.trim() && (
          <span className="sm:hidden text-xs tabular-nums text-slate-500 whitespace-nowrap" aria-live="polite">
            {activeIndex >= 0 ? `${activeIndex + 1}/${hits.length}` : hits.length}
          </span>
        )}
        <button
          type="button" onClick={() => selectResult(activeIndex - 1)}
          disabled={hits.length === 0}
          title="Previous match (Shift+Enter)"
          aria-label="Previous match"
          className="p-1 rounded hover:bg-slate-100 disabled:opacity-30"
        ><ChevronUp className="w-4 h-4" /></button>
        <button
          type="button" onClick={() => selectResult(activeIndex + 1)}
          disabled={hits.length === 0}
          title="Next match (Enter)"
          aria-label="Next match"
          className="p-1 rounded hover:bg-slate-100 disabled:opacity-30"
        ><ChevronDown className="w-4 h-4" /></button>
        <button
          type="button" onClick={onClose}
          aria-label="Close search"
          title="Close search"
          className="p-1 rounded hover:bg-slate-100"
        ><X className="w-4 h-4" /></button>
      </div>

      <div className="hidden sm:flex px-3 py-2 text-xs text-slate-600 border-b border-slate-100 items-center gap-2">
        {searching && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        {!query.trim()
          ? 'Enter search term · Ctrl+F'
          : error
            ? <span className="text-red-700">{error}</span>
            : searching
              ? `Searching ${progress?.scannedPages || 0} / ${progress?.totalPages || '…'} pages · ${hits.length} ${hits.length === 1 ? 'match' : 'matches'}`
              : `${hits.length} ${hits.length === 1 ? 'match' : 'matches'}${activeIndex >= 0 ? ` · ${activeIndex + 1} / ${hits.length}` : ''}`}
        {progress?.truncated && <span className="text-amber-700">First 1000 matches</span>}
      </div>

      {/* On Android the search field occupies its own small row above the PDF.
          The hit list is a separate, optional drawer anchored to the viewer
          bottom (not a fixed overlay covering the reading area by default). */}
      {query.trim() && (
        <div className="sm:hidden flex items-center justify-between gap-2 px-3 py-1 text-xs text-slate-600">
          <span role="status" className="min-w-0 truncate">
            {error ? <span className="text-red-700">{error}</span> : searching
              ? <><Loader2 className="inline-block w-3 h-3 mr-1 animate-spin" />{progress?.scannedPages || 0} / {progress?.totalPages || '…'} pages searched</>
              : hits.length === 0 ? 'No matches' : `${hits.length} ${hits.length === 1 ? 'match' : 'matches'}`}
          </span>
          <button
            type="button"
            onClick={() => setResultsExpanded((expanded) => !expanded)}
            disabled={hits.length === 0}
            aria-expanded={resultsExpanded}
            aria-controls="pdf-search-results"
            className="shrink-0 inline-flex items-center gap-1 text-blue-700 font-medium py-0.5 disabled:opacity-40 disabled:text-slate-500"
          >
            {resultsExpanded ? 'Hide list' : 'Show matches'}
            {resultsExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
        </div>
      )}

      {query.trim() && hits.length > 0 && (
        <div
          id="pdf-search-results"
          className={`${resultsExpanded ? 'flex' : 'hidden'} sm:flex absolute bottom-0 left-0 right-0 z-50 flex-col max-h-[40%] overflow-hidden rounded-t-xl border border-slate-200 bg-white shadow-2xl sm:static sm:max-h-none sm:rounded-none sm:border-0 sm:shadow-none`}
        >
          <div className="sm:hidden shrink-0 flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-200">
            <span className="text-sm font-semibold text-slate-800">{hits.length} {hits.length === 1 ? 'match' : 'matches'}</span>
            <button
              type="button" onClick={() => setResultsExpanded(false)}
              aria-label="Collapse match list"
              className="p-1 rounded hover:bg-slate-100"
            ><ChevronDown className="w-4 h-4" /></button>
          </div>
          <div className="min-h-0 overflow-y-auto overscroll-contain sm:max-h-[min(45vh,360px)]">
          {hits.map((hit, index) => (
            <button
              type="button"
              key={`${hit.pageNumber}-${hit.ordinal}`}
              onClick={() => selectResult(index)}
              className={`block text-left w-full px-3 py-2 border-b border-slate-100 hover:bg-blue-50 ${activeIndex === index ? 'bg-blue-100' : ''}`}
              aria-current={activeIndex === index ? 'true' : undefined}
            >
              <span className="text-xs font-semibold text-blue-700">Page {hit.pageNumber}</span>
              <span className="block text-xs leading-5 text-slate-700 break-words">
                {hit.before}<mark className="bg-amber-200 font-semibold text-slate-900 rounded-sm">{hit.match}</mark>{hit.after}
              </span>
            </button>
          ))}
          </div>
          <p className="shrink-0 hidden sm:block px-3 py-2 text-[11px] text-slate-400 border-t border-slate-100">
            Offline search in embedded PDF text. Scanned pages without a text layer require OCR.
          </p>
        </div>
      )}
      {!searching && query.trim() && hits.length === 0 && !error && (
        <div className="hidden sm:block px-3 py-4 text-sm text-slate-500">No matches found in PDF text.</div>
      )}
      {query.trim() && hits.length === 0 && (
        <p className="hidden sm:block px-3 py-2 text-[11px] text-slate-400 border-t border-slate-100">
          Offline search in embedded PDF text. Scanned pages without a text layer require OCR.
        </p>
      )}
    </section>
  );
};
