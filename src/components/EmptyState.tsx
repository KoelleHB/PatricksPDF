import React, { useRef } from 'react';
import {
  Upload,
  FileText,
  Sparkles,
  Layers,
  Smartphone,
  History,
  ArrowRight,
  Share2,
  Printer,
  Calendar,
} from 'lucide-react';
import { RecentDocumentRecord } from '../types';
import { formatRelativeTime, formatFileSize } from '../utils/recentDocuments';

interface EmptyStateProps {
  onFileSelect: (file: File) => void;
  recentDocs?: RecentDocumentRecord[];
  onSelectRecentDoc?: (record: RecentDocumentRecord) => void;
  onOpenRecentModal?: () => void;
  onShareRecentDoc?: (record: RecentDocumentRecord) => void;
  onPrintRecentDoc?: (record: RecentDocumentRecord) => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  onFileSelect,
  recentDocs = [],
  onSelectRecentDoc,
  onOpenRecentModal,
  onShareRecentDoc,
  onPrintRecentDoc,
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
      onFileSelect(file);
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-3 sm:p-8 max-w-4xl mx-auto w-full">
      <div className="w-full max-w-xl flex flex-col gap-4 sm:gap-5">
        {/* Main Upload Area */}
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-slate-300 hover:border-blue-500 bg-white hover:bg-blue-50/20 rounded-3xl p-6 sm:p-9 text-center cursor-pointer transition shadow-xs flex flex-col items-center justify-center gap-3 group"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={handleInputChange}
          />

          <div className="w-13 h-13 sm:w-14 sm:h-14 rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center group-hover:scale-110 transition-transform shadow-xs">
            <FileText className="w-6 h-6 sm:w-7 sm:h-7" />
          </div>

          <div>
            <h2 className="text-base sm:text-xl font-bold text-slate-900">
              PDF-Dokument auswählen oder ablegen
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 mt-1 max-w-sm mx-auto">
              Tippe hier, um eine Datei vom Smartphone oder Computer zu öffnen.
            </p>
          </div>

          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 group-hover:bg-blue-700 text-white font-semibold text-xs sm:text-sm shadow-xs transition mt-1">
            <Upload className="w-4 h-4" />
            <span>PDF auswählen</span>
          </div>
        </div>

        {/* Lokaler Dokumenten-Verlauf (Zuletzt geöffnet) */}
        {recentDocs.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 p-3.5 sm:p-4 shadow-xs space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <History className="w-4 h-4 text-blue-600" />
                <h3 className="text-xs sm:text-sm font-bold text-slate-900">
                  Zuletzt geöffnet
                </h3>
                <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded-full bg-slate-100 text-slate-600">
                  {recentDocs.length}
                </span>
              </div>
              {onOpenRecentModal && recentDocs.length > 2 && (
                <button
                  type="button"
                  onClick={onOpenRecentModal}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-700 inline-flex items-center gap-0.5"
                >
                  <span>Alle anzeigen</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              )}
            </div>

            <div className="space-y-1.5">
              {recentDocs.slice(0, 3).map((doc) => (
                <div
                  key={doc.id}
                  onClick={() => onSelectRecentDoc?.(doc)}
                  className="group flex items-center justify-between gap-2.5 p-2 sm:p-2.5 rounded-xl border border-slate-100 hover:border-blue-200 hover:bg-slate-50/80 transition cursor-pointer"
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <div className="w-9 h-12 rounded bg-slate-100 border border-slate-200 shrink-0 overflow-hidden flex items-center justify-center">
                      {doc.thumbnailDataUrl ? (
                        <img
                          src={doc.thumbnailDataUrl}
                          alt={doc.name}
                          className="w-full h-full object-cover object-top"
                        />
                      ) : (
                        <FileText className="w-4 h-4 text-slate-400" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4
                        className="text-xs font-semibold text-slate-800 truncate group-hover:text-blue-600 transition"
                        title={doc.name}
                      >
                        {doc.name}
                      </h4>
                      <p className="text-[10px] text-slate-400 flex items-center gap-2 mt-0.5">
                        <span>{doc.numPages} {doc.numPages === 1 ? 'Seite' : 'Seiten'}</span>
                        <span>•</span>
                        <span>{formatFileSize(doc.fileSize)}</span>
                        <span>•</span>
                        <span className="inline-flex items-center gap-0.5">
                          <Calendar className="w-2.5 h-2.5 text-slate-400" />
                          {formatRelativeTime(doc.lastOpened)}
                        </span>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    {onPrintRecentDoc && (
                      <button
                        type="button"
                        onClick={() => onPrintRecentDoc(doc)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition"
                        title="Drucken"
                        aria-label="Drucken"
                      >
                        <Printer className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {onShareRecentDoc && (
                      <button
                        type="button"
                        onClick={() => onShareRecentDoc(doc)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition"
                        title="Teilen"
                        aria-label="Teilen"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onSelectRecentDoc?.(doc)}
                      className="px-2 py-1 rounded-lg bg-slate-100 group-hover:bg-blue-600 text-slate-700 group-hover:text-white text-[11px] font-semibold transition ml-1"
                    >
                      Öffnen
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Feature Highlights Bento */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
          <div className="bg-white p-3 rounded-2xl border border-slate-200 flex flex-col gap-1">
            <div className="w-6 h-6 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5" />
            </div>
            <h3 className="text-xs font-bold text-slate-900">Transparente Signatur</h3>
            <p className="text-[11px] text-slate-500 leading-normal">
              Entfernt weißes Papier auf Unterschriften-Fotos automatisch via Canvas-Filter.
            </p>
          </div>

          <div className="bg-white p-3 rounded-2xl border border-slate-200 flex flex-col gap-1">
            <div className="w-6 h-6 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Layers className="w-3.5 h-3.5" />
            </div>
            <h3 className="text-xs font-bold text-slate-900">Touch & Platzierung</h3>
            <p className="text-[11px] text-slate-500 leading-normal">
              Verschieben, Skalieren mit Touch-Griffen und pixelgenaue Drehung auf jeder Seite.
            </p>
          </div>

          <div className="bg-white p-3 rounded-2xl border border-slate-200 flex flex-col gap-1">
            <div className="w-6 h-6 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Smartphone className="w-3.5 h-3.5" />
            </div>
            <h3 className="text-xs font-bold text-slate-900">Android Print & Share</h3>
            <p className="text-[11px] text-slate-500 leading-normal">
              Direktes Drucken über Android PrintManager und Teilen via WhatsApp, E-Mail & Drive.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
