import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, Search, X } from 'lucide-react';
import {
  PdfSearchHit, PdfSearchProgress, searchPdfDocument,
} from '../utils/pdfSearch';

interface PdfSearchPanelProps {
  arrayBuffer: ArrayBuffer;
  onClose: () => void;
  onNavigate: (hit: PdfSearchHit, phrase: string) => void;
  diagnosticsEnabled: boolean;
  onToggleDiagnostics: () => void;
  diagnosticsText: string;
  fontCompensationOn: boolean;
  onToggleFontCompensation: () => void;
}

export const PdfSearchPanel: React.FC<PdfSearchPanelProps> = ({
  arrayBuffer, onClose, onNavigate,
  diagnosticsEnabled, onToggleDiagnostics, diagnosticsText,
  fontCompensationOn, onToggleFontCompensation,
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
    // On phones, dismiss both the results drawer and virtual keyboard so the
    // highlighted hit is actually visible in the document.
    setResultsExpanded(false);
    inputRef.current?.blur();
    onNavigate(hits[next], query.trim());
  };

  return (
    <section
      role="search"
      aria-label="PDF-Volltextsuche"
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
          aria-label="Im gesamten PDF suchen"
          placeholder="Im ganzen PDF suchen …"
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

      <div className="hidden sm:flex px-3 py-2 text-xs text-slate-600 border-b border-slate-100 items-center gap-2">
        {searching && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        {!query.trim()
          ? 'Suchbegriff eingeben · Strg+F'
          : error
            ? <span className="text-red-700">{error}</span>
            : searching
              ? `Durchsuche ${progress?.scannedPages || 0} / ${progress?.totalPages || '…'} Seiten · ${hits.length} Treffer`
              : `${hits.length} Treffer${activeIndex >= 0 ? ` · ${activeIndex + 1} / ${hits.length}` : ''}`}
        {progress?.truncated && <span className="text-amber-700">Erste 1000 Treffer</span>}
        <button
          type="button"
          onClick={onToggleDiagnostics}
          aria-pressed={diagnosticsEnabled}
          className="ml-auto text-xs font-medium text-indigo-700 hover:underline"
        >{diagnosticsEnabled ? 'Diagnose aus' : 'Diagnose'}</button>
      </div>

      {/* On Android the search field occupies its own small row above the PDF.
          The hit list is a separate, optional drawer anchored to the viewer
          bottom (not a fixed overlay covering the reading area by default). */}
      {query.trim() && (
        <div className="sm:hidden flex items-center justify-between gap-2 px-3 py-1 text-xs text-slate-600">
          <span role="status" className="min-w-0 truncate">
            {error ? <span className="text-red-700">{error}</span> : searching
              ? <><Loader2 className="inline-block w-3 h-3 mr-1 animate-spin" />{progress?.scannedPages || 0} / {progress?.totalPages || '…'} Seiten durchsucht</>
              : hits.length === 0 ? 'Keine Treffer' : `${hits.length} Treffer`}
          </span>
          <button
            type="button"
            onClick={onToggleDiagnostics}
            aria-pressed={diagnosticsEnabled}
            title="Textpositionen lokal prüfen – keine Dateidaten werden gesendet"
            className={`shrink-0 px-1.5 py-0.5 text-xs rounded border ${diagnosticsEnabled ? 'text-white bg-indigo-600 border-indigo-600' : 'text-indigo-700 border-indigo-200'}`}
          >Diagnose</button>
          <button
            type="button"
            onClick={() => setResultsExpanded((expanded) => !expanded)}
            disabled={hits.length === 0}
            aria-expanded={resultsExpanded}
            aria-controls="pdf-search-results"
            className="shrink-0 inline-flex items-center gap-1 text-blue-700 font-medium py-0.5 disabled:opacity-40 disabled:text-slate-500"
          >
            {resultsExpanded ? 'Liste schließen' : 'Treffer anzeigen'}
            {resultsExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
        </div>
      )}

      {diagnosticsEnabled && (
        <div className="px-3 py-2 text-[11px] border-t border-indigo-100 bg-indigo-50 text-slate-700">
          <div className="flex justify-between items-center gap-3 mb-1">
            <strong>Lokale Text-Diagnose</strong>
            <button
              type="button"
              onClick={() => { void navigator.clipboard?.writeText(diagnosticsText).catch(() => {}); }}
              className="font-semibold text-indigo-700 underline"
              title="Nur technische Zahlen kopieren – niemals Dokumenttexte"
            >Messwerte kopieren</button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
            <span>Android-Schriftkorrektur: <strong>{fontCompensationOn ? 'aktiv' : 'deaktiviert'}</strong></span>
            <button
              type="button"
              onClick={onToggleFontCompensation}
              aria-pressed={fontCompensationOn}
              className="rounded bg-indigo-100 text-indigo-800 font-semibold px-2 py-1"
              title="Korrigierte mit ursprünglicher Textdarstellung vergleichen"
            >{fontCompensationOn ? 'Zum Vergleich: AUS' : 'Korrektur AN'}</button>
          </div>
          <pre className="whitespace-pre-wrap break-words leading-4 font-mono">{diagnosticsText || 'Messung wird vorbereitet …'}</pre>
          <p className="mt-1 text-[10px] text-slate-500">Keine PDF-Texte, Dateinamen oder Inhalte werden übertragen oder protokolliert.</p>
        </div>
      )}

      {query.trim() && hits.length > 0 && (
        <div
          id="pdf-search-results"
          className={`${resultsExpanded ? 'flex' : 'hidden'} sm:flex absolute bottom-0 left-0 right-0 z-50 flex-col max-h-[40%] overflow-hidden rounded-t-xl border border-slate-200 bg-white shadow-2xl sm:static sm:max-h-none sm:rounded-none sm:border-0 sm:shadow-none`}
        >
          <div className="sm:hidden shrink-0 flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-200">
            <span className="text-sm font-semibold text-slate-800">{hits.length} Treffer</span>
            <button
              type="button" onClick={() => setResultsExpanded(false)}
              aria-label="Trefferliste einklappen"
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
              <span className="text-xs font-semibold text-blue-700">Seite {hit.pageNumber}</span>
              <span className="block text-xs leading-5 text-slate-700 break-words">
                {hit.before}<mark className="bg-amber-200 font-semibold text-slate-900 rounded-sm">{hit.match}</mark>{hit.after}
              </span>
            </button>
          ))}
          </div>
          <p className="shrink-0 hidden sm:block px-3 py-2 text-[11px] text-slate-400 border-t border-slate-100">
            Offline-Suche in eingebettetem PDF-Text. Scans ohne Textschicht erfordern OCR.
          </p>
        </div>
      )}
      {!searching && query.trim() && hits.length === 0 && !error && (
        <div className="hidden sm:block px-3 py-4 text-sm text-slate-500">Keine Treffer im PDF-Text gefunden.</div>
      )}
      {query.trim() && hits.length === 0 && (
        <p className="hidden sm:block px-3 py-2 text-[11px] text-slate-400 border-t border-slate-100">
          Offline-Suche in eingebettetem PDF-Text. Scans ohne Textschicht erfordern OCR.
        </p>
      )}
    </section>
  );
};
