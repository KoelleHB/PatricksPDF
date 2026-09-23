import React, { useState } from 'react';
import {
  History,
  X,
  FileText,
  Share2,
  Printer,
  Trash2,
  FolderOpen,
  Calendar,
  Layers,
  HardDrive,
  AlertTriangle,
} from 'lucide-react';
import { RecentDocumentRecord } from '../types';
import { formatRelativeTime, formatFileSize } from '../utils/recentDocuments';
import { sharePdfDocument, printPdfDocument } from '../utils/nativeBridge';

interface RecentDocumentsModalProps {
  isOpen: boolean;
  onClose: () => void;
  recentDocs: RecentDocumentRecord[];
  currentDocName?: string;
  onSelectDoc: (record: RecentDocumentRecord) => void;
  onRemoveDoc: (id: string) => void;
  onClearAll: () => void;
}

export const RecentDocumentsModal: React.FC<RecentDocumentsModalProps> = ({
  isOpen,
  onClose,
  recentDocs,
  currentDocName,
  onSelectDoc,
  onRemoveDoc,
  onClearAll,
}) => {
  const [confirmClear, setConfirmClear] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  if (!isOpen) return null;

  const showFeedback = (msg: string) => {
    setActionFeedback(msg);
    setTimeout(() => setActionFeedback(null), 2500);
  };

  const handleShare = async (doc: RecentDocumentRecord, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await sharePdfDocument(doc.name, doc.pdfBuffer);
      if (res.success) {
        showFeedback(`"${doc.name}" bereitgestellt.`);
      }
    } catch (err) {
      console.error('Share error:', err);
    }
  };

  const handlePrint = async (doc: RecentDocumentRecord, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await printPdfDocument(doc.name, doc.pdfBuffer);
      if (res.success) {
        showFeedback(`Druckauftrag gestartet: ${doc.name}`);
      }
    } catch (err) {
      console.error('Print error:', err);
    }
  };

  const handleRemove = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onRemoveDoc(id);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-4 animate-in fade-in duration-150">
      <div className="bg-white w-full max-w-2xl max-h-[85vh] rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center">
              <History className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 leading-tight">
                Lokaler Dokumenten-Verlauf
              </h3>
              <p className="text-xs text-slate-500">
                100% offline in deinem Browser gespeichert • Direkt öffnen, drucken & teilen
              </p>
            </div>
          </div>
          <button
            id="recent-docs-close-btn"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition cursor-pointer"
            aria-label="Schließen"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action feedback toast */}
        {actionFeedback && (
          <div className="bg-emerald-50 text-emerald-800 border-b border-emerald-200 px-4 py-2 text-xs font-semibold flex items-center justify-between">
            <span>{actionFeedback}</span>
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          </div>
        )}

        {/* Content list */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
          {recentDocs.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center text-center text-slate-400 gap-2">
              <FileText className="w-12 h-12 text-slate-300 stroke-[1.5]" />
              <p className="font-semibold text-slate-700 text-sm">Noch keine Dokumente im Verlauf</p>
              <p className="text-xs text-slate-500 max-w-xs">
                Sobald du ein PDF öffnest oder bearbeitest, erscheint es automatisch hier zur schnellen Wiederverwendung.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {recentDocs.map((doc) => {
                const isCurrentlyActive = currentDocName === doc.name;
                return (
                  <div
                    key={doc.id}
                    onClick={() => {
                      onSelectDoc(doc);
                      onClose();
                    }}
                    className={`group relative flex items-center justify-between gap-3 p-3 sm:p-3.5 rounded-xl border transition cursor-pointer ${
                      isCurrentlyActive
                        ? 'bg-blue-50/60 border-blue-300 ring-1 ring-blue-300'
                        : 'bg-white hover:bg-slate-50 border-slate-200 hover:border-blue-300 shadow-2xs'
                    }`}
                  >
                    {/* Thumbnail & Title */}
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="w-12 h-16 sm:w-14 sm:h-18 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0 overflow-hidden shadow-2xs">
                        {doc.thumbnailDataUrl ? (
                          <img
                            src={doc.thumbnailDataUrl}
                            alt={doc.name}
                            className="w-full h-full object-cover object-top"
                          />
                        ) : (
                          <FileText className="w-6 h-6 text-slate-400" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h4
                            className="text-xs sm:text-sm font-bold text-slate-900 truncate max-w-[200px] sm:max-w-xs md:max-w-md"
                            title={doc.name}
                          >
                            {doc.name}
                          </h4>
                          {isCurrentlyActive && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">
                              Aktiv
                            </span>
                          )}
                        </div>

                        {/* Metadata tags */}
                        <div className="flex items-center gap-2 sm:gap-3 text-[11px] text-slate-500 mt-1 flex-wrap">
                          <span className="inline-flex items-center gap-1">
                            <Layers className="w-3 h-3 text-slate-400" />
                            {doc.numPages} {doc.numPages === 1 ? 'Seite' : 'Seiten'}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <HardDrive className="w-3 h-3 text-slate-400" />
                            {formatFileSize(doc.fileSize)}
                          </span>
                          <span className="inline-flex items-center gap-1 text-slate-400">
                            <Calendar className="w-3 h-3 text-slate-400" />
                            {formatRelativeTime(doc.lastOpened)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Quick action buttons */}
                    <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                      {/* Print button */}
                      <button
                        type="button"
                        onClick={(e) => handlePrint(doc, e)}
                        className="p-2 rounded-lg text-slate-600 hover:text-blue-600 hover:bg-blue-50 border border-slate-200 transition"
                        title="Dokument drucken"
                        aria-label="Drucken"
                      >
                        <Printer className="w-4 h-4" />
                      </button>

                      {/* Share button */}
                      <button
                        type="button"
                        onClick={(e) => handleShare(doc, e)}
                        className="p-2 rounded-lg text-slate-600 hover:text-emerald-600 hover:bg-emerald-50 border border-slate-200 transition"
                        title="Dokument teilen"
                        aria-label="Teilen"
                      >
                        <Share2 className="w-4 h-4" />
                      </button>

                      {/* Open button */}
                      <button
                        type="button"
                        onClick={() => {
                          onSelectDoc(doc);
                          onClose();
                        }}
                        className="hidden sm:inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-2xs transition"
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
                        <span>Öffnen</span>
                      </button>

                      {/* Delete button */}
                      <button
                        type="button"
                        onClick={(e) => handleRemove(doc.id, e)}
                        className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition ml-0.5"
                        title="Aus Verlauf entfernen"
                        aria-label="Entfernen"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer with Clear All */}
        {recentDocs.length > 0 && (
          <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
            <span className="text-xs text-slate-500">
              {recentDocs.length} {recentDocs.length === 1 ? 'Dokument' : 'Dokumente'} im Verlauf
            </span>

            {confirmClear ? (
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-red-600 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" /> Wirklich leeren?
                </span>
                <button
                  type="button"
                  onClick={() => {
                    onClearAll();
                    setConfirmClear(false);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 transition"
                >
                  Ja, alle löschen
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="px-2 py-1 rounded-lg border border-slate-300 text-slate-700 text-xs hover:bg-slate-200 transition"
                >
                  Abbrechen
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-red-600 transition"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Verlauf leeren</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
