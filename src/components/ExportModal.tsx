import React, { useState, useEffect } from 'react';
import {
  Download,
  Share2,
  CheckCircle2,
  X,
  FileCheck,
  Loader2,
  ExternalLink,
  Smartphone,
} from 'lucide-react';
import { SignatureItem, TextOverlayItem, FormValuesState, PdfDocumentState } from '../types';
import { embedSignaturesIntoPdf } from '../utils/pdfEngine';

interface ExportModalProps {
  isOpen: boolean;
  pdfState: PdfDocumentState;
  signatures: SignatureItem[];
  textOverlays?: TextOverlayItem[];
  formValues?: FormValuesState;
  hasFormFields?: boolean;
  onClose: () => void;
  onExportSuccess?: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  pdfState,
  signatures,
  textOverlays = [],
  formValues = {},
  hasFormFields = false,
  onClose,
  onExportSuccess,
}) => {
  const [fileName, setFileName] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [fileSizeStr, setFileSizeStr] = useState<string>('');
  const [shareSuccess, setShareSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [flattenForm, setFlattenForm] = useState(false);

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

  const handleDownload = () => {
    if (!pdfUrl) return;
    const a = document.createElement('a');
    a.href = pdfUrl;
    a.download = fileName || 'signed-document.pdf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    onExportSuccess?.();
  };

  const handleNativeShare = async () => {
    if (!pdfBlob) return;

    try {
      const file = new File([pdfBlob], fileName || 'signed-document.pdf', {
        type: 'application/pdf',
      });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: fileName,
          text: 'Here is the signed PDF document.',
        });
        setShareSuccess(true);
        onExportSuccess?.();
        setTimeout(() => setShareSuccess(false), 3000);
      } else {
        handleDownload();
      }
    } catch (err) {
      console.log('Share dismissed or failed:', err);
    }
  };

  const canShare = typeof navigator !== 'undefined' && !!navigator.share;

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
                Export Signed PDF
              </h3>
              <p className="text-xs text-slate-500">
                Transparent signatures embedded directly into vector PDF
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

        {/* Content */}
        <div className="p-5 space-y-4">
          {isGenerating ? (
            <div className="py-8 flex flex-col items-center justify-center gap-2">
              <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
              <p className="text-sm font-semibold text-slate-700">Compiling signed PDF...</p>
              <p className="text-xs text-slate-400">Embedding transparent signatures locally (Adobe Acrobat compliant)</p>
            </div>
          ) : errorMessage ? (
            <div className="py-6 space-y-3">
              <div className="p-3.5 bg-red-50 rounded-xl border border-red-200 text-xs text-red-700 space-y-1">
                <p className="font-bold">PDF Generation Failed</p>
                <p>{errorMessage}</p>
              </div>
              <button
                onClick={() => {
                  setErrorMessage(null);
                  setIsGenerating(true);
                  embedSignaturesIntoPdf(pdfState.arrayBuffer, signatures)
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
                className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs sm:text-sm transition"
              >
                Retry Export
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
                      Convert fields to permanent vector text (prevents further editing)
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
                  id="modal-download-btn"
                  onClick={handleDownload}
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold text-sm shadow-md transition"
                >
                  <Download className="w-4 h-4" />
                  <span>Download Signed PDF</span>
                </button>

                {canShare && (
                  <button
                    id="modal-share-btn"
                    onClick={handleNativeShare}
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-medium text-sm transition"
                  >
                    <Share2 className="w-4 h-4 text-emerald-400" />
                    <span>Share on Android (WhatsApp, Email, Drive)</span>
                  </button>
                )}

                {pdfUrl && (
                  <a
                    href={pdfUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-100 text-xs font-medium transition"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Open in Browser Tab for Inspection</span>
                  </a>
                )}

                {shareSuccess && (
                  <p className="text-xs text-emerald-600 font-medium text-center flex items-center justify-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Shared successfully!
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
