import React, { useState, useEffect } from 'react';
import {
  Download,
  Share2,
  Printer,
  X,
  FileCheck,
  Loader2,
  ExternalLink,
  Check,
} from 'lucide-react';
import { SignatureItem, TextOverlayItem, FormValuesState, PdfDocumentState } from '../types';
import { embedSignaturesIntoPdf } from '../utils/pdfEngine';
import { sharePdfDocument, printPdfDocument, isNativeAndroid } from '../utils/nativeBridge';

export interface SaveModalProps {
  isOpen: boolean;
  pdfState: PdfDocumentState;
  signatures: SignatureItem[];
  textOverlays?: TextOverlayItem[];
  formValues?: FormValuesState;
  hasFormFields?: boolean;
  hasPageModifications?: boolean;
  onClose: () => void;
  onSaveSuccess?: () => void;
  onExportSuccess?: () => void; // backwards-compatible alias
}

export const SaveModal: React.FC<SaveModalProps> = ({
  isOpen,
  pdfState,
  signatures,
  textOverlays = [],
  formValues = {},
  hasFormFields = false,
  hasPageModifications = false,
  onClose,
  onSaveSuccess,
  onExportSuccess,
}) => {
  const [fileName, setFileName] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [fileSizeStr, setFileSizeStr] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [flattenForm, setFlattenForm] = useState(false);

  const notifySuccess = () => {
    onSaveSuccess?.();
    onExportSuccess?.();
  };

  useEffect(() => {
    if (!isOpen) {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
      setPdfBlob(null);
      setPdfUrl(null);
      setErrorMessage(null);
      return;
    }

    // Default output filename
    const baseName = pdfState.name.replace(/\.pdf$/i, '');
    setFileName(`${baseName}-completed.pdf`);
    setErrorMessage(null);

    const generatePdf = async () => {
      if (!pdfState.arrayBuffer) return;
      setIsGenerating(true);
      setErrorMessage(null);

      try {
        const modifiedBytes = await embedSignaturesIntoPdf(
          pdfState.arrayBuffer,
          signatures,
          textOverlays,
          formValues,
          { flattenForm }
        );

        const blob = new Blob([modifiedBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);

        setPdfBlob(blob);
        setPdfUrl(url);

        const sizeKb = Math.round(blob.size / 1024);
        setFileSizeStr(sizeKb > 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${sizeKb} KB`);
      } catch (err: any) {
        console.error('Failed to generate PDF:', err);
        setErrorMessage(err?.message || 'Failed to embed signatures/text into PDF document.');
      } finally {
        setIsGenerating(false);
      }
    };

    generatePdf();
  }, [isOpen, pdfState.arrayBuffer, signatures, textOverlays, formValues, flattenForm, pdfState.name]);

  if (!isOpen) return null;

  const [isPrinting, setIsPrinting] = useState(false);
  const [isSharing, setIsSharing] = useState(false);

  const handleDownload = () => {
    if (!pdfUrl) return;
    const a = document.createElement('a');
    a.href = pdfUrl;
    a.download = fileName || 'signed-document.pdf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    notifySuccess();
    onClose();
  };

  const handleNativeShare = async () => {
    if (!pdfBlob) return;
    setIsSharing(true);
    try {
      const res = await sharePdfDocument(fileName || 'signed-document.pdf', pdfBlob);
      if (res.success) {
        notifySuccess();
        onClose();
      }
    } catch (err) {
      console.warn('Share error in modal:', err);
    } finally {
      setIsSharing(false);
    }
  };

  const handlePrint = async () => {
    if (!pdfBlob) return;
    setIsPrinting(true);
    try {
      const res = await printPdfDocument(fileName || 'signed-document.pdf', pdfBlob);
      if (res.success) {
        notifySuccess();
      }
    } catch (err) {
      console.warn('Print error in modal:', err);
    } finally {
      setIsPrinting(false);
    }
  };

  const isAndroid = isNativeAndroid();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-4">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col animate-in fade-in zoom-in duration-150">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <FileCheck className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 leading-tight">
                Save PDF
              </h3>
              <p className="text-[11px] text-slate-500">
                {hasPageModifications
                  ? 'Includes your reorganized, rotated, or modified pages'
                  : 'Embedded locally with ISO 32000-1 compliance'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          {isGenerating ? (
            <div className="py-8 flex flex-col items-center justify-center gap-2">
              <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
              <p className="text-sm font-semibold text-slate-700">Compiling and saving signed PDF...</p>
              <p className="text-xs text-slate-400">Embedding transparent signatures locally (Adobe Acrobat compliant)</p>
            </div>
          ) : errorMessage ? (
            <div className="py-6 space-y-3">
              <div className="p-3.5 bg-red-50 rounded-xl border border-red-200 text-xs text-red-700 space-y-1">
                <p className="font-bold">PDF Save Failed</p>
                <p>{errorMessage}</p>
              </div>
              <button
                onClick={() => {
                  setErrorMessage(null);
                  setIsGenerating(true);
                  embedSignaturesIntoPdf(pdfState.arrayBuffer, signatures, textOverlays, formValues, { flattenForm })
                    .then((modifiedBytes) => {
                      const blob = new Blob([modifiedBytes], { type: 'application/pdf' });
                      setPdfBlob(blob);
                      setPdfUrl(URL.createObjectURL(blob));
                      const sizeKb = Math.round(blob.size / 1024);
                      setFileSizeStr(sizeKb > 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${sizeKb} KB`);
                    })
                    .catch((err: any) => setErrorMessage(err?.message || 'Retry failed'))
                    .finally(() => setIsGenerating(false));
                }}
                className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs sm:text-sm transition cursor-pointer"
              >
                Retry Save
              </button>
            </div>
          ) : (
            <>
              {/* Summary Card */}
              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span>Signatures Embedded:</span>
                  <span className="font-semibold text-slate-900">
                    {signatures.length} signature{signatures.length !== 1 ? 's' : ''}
                  </span>
                </div>
                {textOverlays.length > 0 && (
                  <div className="flex items-center justify-between text-xs text-slate-600">
                    <span>Text Overlays:</span>
                    <span className="font-semibold text-slate-900">
                      {textOverlays.length} item{textOverlays.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                )}
                {hasFormFields && (
                  <div className="flex items-center justify-between text-xs text-slate-600">
                    <span>Form Fields:</span>
                    <span className="font-semibold text-blue-700">Native AcroForm Filled</span>
                  </div>
                )}
                {hasPageModifications && (
                  <div className="flex items-center justify-between text-xs text-slate-600">
                    <span>Page Structure:</span>
                    <span className="font-semibold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded text-[11px] border border-blue-200">
                      Modified & Reorganized
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span>Total Pages:</span>
                  <span className="font-semibold text-slate-900">{pdfState.numPages} pages</span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span>File Size:</span>
                  <span className="font-semibold text-slate-900">{fileSizeStr}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span>Acrobat Compliance:</span>
                  <span className="font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded text-[11px] border border-emerald-200">
                    ISO 32000-1 (Standard XRef)
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span>Metadata & XRef:</span>
                  <span className="font-semibold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded text-[11px] border border-blue-200">
                    Preserved & Versioned (Trailer ID)
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span>Local Privacy:</span>
                  <span className="font-semibold text-emerald-600">Zero Server Uploads</span>
                </div>
              </div>

              {/* Form Flattening Toggle (if document has native form fields) */}
              {hasFormFields && (
                <div className="p-3 bg-blue-50/70 rounded-xl border border-blue-200 flex items-center justify-between gap-3">
                  <div className="text-xs">
                    <p className="font-bold text-blue-900">Flatten Form Fields</p>
                    <p className="text-blue-700 text-[11px]">
                      Convert fields to permanent vector text
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={flattenForm}
                      onChange={(e) => setFlattenForm(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>
              )}

              {/* Filename Input */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Output Filename
                </label>
                <input
                  type="text"
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-500 font-mono text-slate-800"
                  placeholder="document-signed.pdf"
                />
              </div>

              {/* Action Buttons */}
              <div className="space-y-2 pt-2">
                <button
                  id="modal-save-btn"
                  onClick={handleDownload}
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold text-sm shadow-md transition cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>PDF speichern / Download</span>
                </button>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    id="modal-share-btn"
                    onClick={handleNativeShare}
                    disabled={isSharing}
                    className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-medium text-xs sm:text-sm transition cursor-pointer disabled:opacity-50"
                  >
                    {isSharing ? (
                      <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                    ) : (
                      <Share2 className="w-4 h-4 text-emerald-400" />
                    )}
                    <span>{isAndroid ? 'Android Share' : 'Teilen'}</span>
                  </button>

                  <button
                    id="modal-print-btn"
                    onClick={handlePrint}
                    disabled={isPrinting}
                    className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-800 font-medium text-xs sm:text-sm transition cursor-pointer disabled:opacity-50"
                  >
                    {isPrinting ? (
                      <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                    ) : (
                      <Printer className="w-4 h-4 text-blue-600" />
                    )}
                    <span>{isAndroid ? 'Android Print' : 'Drucken'}</span>
                  </button>
                </div>

                {pdfUrl && (
                  <a
                    href={pdfUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 text-xs font-medium transition"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>In neuem Tab prüfen</span>
                  </a>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export { SaveModal as ExportModal };
