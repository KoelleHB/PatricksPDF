import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Download,
  Share2,
  Printer,
  X,
  FileCheck,
  Loader2,
  ExternalLink,
  Check,
  FolderOpen,
  Settings2,
} from 'lucide-react';
import { SignatureItem, TextOverlayItem, FormValuesState, PdfDocumentState } from '../types';
import { embedSignaturesIntoPdf } from '../utils/pdfEngine';
import {
  savePdfDocument,
  savePdfDocumentAs,
  sharePdfDocument,
  printPdfDocument,
  isNativeAndroid,
} from '../utils/nativeBridge';
import {
  ExportSettings,
  NamingPreset,
  loadExportSettings,
  saveExportSettings,
  buildExportFileName,
  parsePageRangeInput,
  formatPageNumbersToRangeString,
} from '../utils/exportSettings';

export type PageExportScope = 'all' | 'current' | 'custom';

export interface SaveSuccessInfo {
  isSubsetExport: boolean;
}

export interface SaveModalProps {
  isOpen: boolean;
  pdfState: PdfDocumentState;
  signatures: SignatureItem[];
  textOverlays?: TextOverlayItem[];
  formValues?: FormValuesState;
  hasFormFields?: boolean;
  isFormModified?: boolean;
  hasPageModifications?: boolean;
  initialSelectedPages?: number[] | null;
  onClose: () => void;
  onSaveSuccess?: (info: SaveSuccessInfo) => void;
  onExportSuccess?: (info: SaveSuccessInfo) => void; // backwards-compatible alias
}

export const SaveModal: React.FC<SaveModalProps> = ({
  isOpen,
  pdfState,
  signatures,
  textOverlays = [],
  formValues = {},
  hasFormFields = false,
  isFormModified = false,
  hasPageModifications = false,
  initialSelectedPages = null,
  onClose,
  onSaveSuccess,
  onExportSuccess,
}) => {
  // Persisted export preferences
  const [exportSettings, setExportSettings] = useState<ExportSettings>(() => loadExportSettings());
  const [fileName, setFileName] = useState('');
  const [isCustomFileNameEdited, setIsCustomFileNameEdited] = useState(false);

  // Page subset export scope
  const [pageScope, setPageScope] = useState<PageExportScope>('all');
  const [customPageRangeInput, setCustomPageRangeInput] = useState<string>('');

  const [isGenerating, setIsGenerating] = useState(false);
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [fileSizeStr, setFileSizeStr] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [flattenForm, setFlattenForm] = useState<boolean>(() => loadExportSettings().defaultFlattenForms);
  const [isPrinting, setIsPrinting] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingAs, setIsSavingAs] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  const activeSessionRef = useRef<number>(0);

  const notifySuccess = (isSubsetExport: boolean) => {
    const info: SaveSuccessInfo = { isSubsetExport };
    onSaveSuccess?.(info);
    onExportSuccess?.(info);
  };

  // Release superseded previews and free the browser's retained PDF Blob URLs.
  useEffect(
    () => () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    },
    [pdfUrl]
  );

  // Initialize modal state when opened
  useEffect(() => {
    if (!isOpen) {
      setPdfBlob(null);
      setPdfUrl(null);
      setErrorMessage(null);
      setSaveSuccessMsg(null);
      return;
    }

    const stored = loadExportSettings();
    setExportSettings(stored);
    setFlattenForm(stored.defaultFlattenForms);
    setIsCustomFileNameEdited(false);

    if (initialSelectedPages && initialSelectedPages.length > 0) {
      setPageScope('custom');
      setCustomPageRangeInput(formatPageNumbersToRangeString(initialSelectedPages));
    } else {
      setPageScope('all');
      setCustomPageRangeInput(
        pdfState?.numPages ? `1-${pdfState.numPages}` : '1'
      );
    }
  }, [isOpen, initialSelectedPages, pdfState?.numPages]);

  // Compute target 1-based page numbers for export
  const resolvedPageSelection = React.useMemo((): {
    selectedPages: number[] | undefined;
    subsetSuffix: string | undefined;
    rangeError: string | null;
    exportedPageCount: number;
  } => {
    const total = pdfState?.numPages || 1;
    if (pageScope === 'all') {
      return {
        selectedPages: undefined,
        subsetSuffix: undefined,
        rangeError: null,
        exportedPageCount: total,
      };
    }
    if (pageScope === 'current') {
      const cur = Math.max(1, Math.min(total, pdfState?.currentPage || 1));
      return {
        selectedPages: [cur],
        subsetSuffix: `S${cur}`,
        rangeError: null,
        exportedPageCount: 1,
      };
    }
    const parsed = parsePageRangeInput(customPageRangeInput, total);
    if (parsed.error) {
      return {
        selectedPages: undefined,
        subsetSuffix: undefined,
        rangeError: parsed.error,
        exportedPageCount: 0,
      };
    }
    const isFullDoc = parsed.pages.length === total;
    const tag =
      parsed.pages.length === 1
        ? `S${parsed.pages[0]}`
        : `S${parsed.pages[0]}-${parsed.pages[parsed.pages.length - 1]}`;
    return {
      selectedPages: isFullDoc ? undefined : parsed.pages,
      subsetSuffix: isFullDoc ? undefined : tag,
      rangeError: null,
      exportedPageCount: parsed.pages.length,
    };
  }, [pageScope, customPageRangeInput, pdfState?.numPages, pdfState?.currentPage]);

  // Auto-update filename when naming preset, custom suffix, or page scope changes (unless manually edited)
  useEffect(() => {
    if (!isOpen || isCustomFileNameEdited) return;
    const baseDocName = pdfState?.name || 'document.pdf';
    const generated = buildExportFileName(
      baseDocName,
      exportSettings,
      resolvedPageSelection.subsetSuffix
    );
    setFileName(`${generated}.pdf`);
  }, [
    isOpen,
    isCustomFileNameEdited,
    pdfState?.name,
    exportSettings,
    resolvedPageSelection.subsetSuffix,
  ]);

  // Unified, idempotent PDF generation function used for both initial load and Retry
  const compileExportPdf = useCallback(async () => {
    if (!isOpen) return;
    const sessionId = ++activeSessionRef.current;

    if (!pdfState?.arrayBuffer) {
      setErrorMessage('Keine Dokumentdaten vorhanden.');
      setPdfBlob(null);
      setPdfUrl(null);
      return;
    }

    if (resolvedPageSelection.rangeError) {
      setErrorMessage(resolvedPageSelection.rangeError);
      setPdfBlob(null);
      setPdfUrl(null);
      return;
    }

    setIsGenerating(true);
    setErrorMessage(null);

    try {
      const selectedPages = resolvedPageSelection.selectedPages;
      const isSubset = Boolean(selectedPages && selectedPages.length > 0);
      const unchangedContents =
        !isSubset &&
        signatures.length === 0 &&
        textOverlays.length === 0 &&
        !isFormModified &&
        !flattenForm;

      const modifiedBytes = unchangedContents
        ? new Uint8Array(pdfState.arrayBuffer)
        : await embedSignaturesIntoPdf(
            pdfState.arrayBuffer,
            signatures,
            textOverlays,
            formValues,
            { flattenForm, selectedPages }
          );

      if (activeSessionRef.current !== sessionId) return;

      const blob = new Blob([modifiedBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);

      setPdfBlob(blob);
      setPdfUrl(url);

      const sizeKb = Math.max(1, Math.round(blob.size / 1024));
      setFileSizeStr(sizeKb > 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${sizeKb} KB`);
    } catch (err: any) {
      console.error('Failed to generate PDF:', err);
      if (activeSessionRef.current === sessionId) {
        setPdfBlob(null);
        setPdfUrl(null);
        setErrorMessage(err?.message || 'Failed to embed signatures/text into PDF document.');
      }
    } finally {
      if (activeSessionRef.current === sessionId) {
        setIsGenerating(false);
      }
    }
  }, [
    isOpen,
    pdfState?.arrayBuffer,
    signatures,
    textOverlays,
    formValues,
    isFormModified,
    flattenForm,
    resolvedPageSelection.rangeError,
    resolvedPageSelection.selectedPages,
  ]);

  useEffect(() => {
    if (!isOpen) return;
    void compileExportPdf();
    return () => {
      activeSessionRef.current += 1;
    };
  }, [isOpen, compileExportPdf]);

  if (!isOpen) return null;

  const isAndroid = isNativeAndroid();

  const handleUpdatePreset = (preset: NamingPreset) => {
    const next: ExportSettings = { ...exportSettings, namingPreset: preset };
    setExportSettings(next);
    saveExportSettings(next);
    setIsCustomFileNameEdited(false);
  };

  const handleUpdateCustomSuffix = (suffix: string) => {
    const next: ExportSettings = { ...exportSettings, customSuffix: suffix };
    setExportSettings(next);
    saveExportSettings(next);
    setIsCustomFileNameEdited(false);
  };

  const handleToggleFlatten = (checked: boolean) => {
    setFlattenForm(checked);
    const next: ExportSettings = { ...exportSettings, defaultFlattenForms: checked };
    setExportSettings(next);
    saveExportSettings(next);
  };

  const isSubsetExport = Boolean(
    resolvedPageSelection.selectedPages &&
      resolvedPageSelection.selectedPages.length < pdfState.numPages
  );

  const selectedPageSet = React.useMemo(
    () =>
      resolvedPageSelection.selectedPages
        ? new Set(resolvedPageSelection.selectedPages)
        : null,
    [resolvedPageSelection.selectedPages]
  );

  const exportedSignaturesCount = React.useMemo(
    () =>
      selectedPageSet
        ? signatures.filter((s) => selectedPageSet.has(s.pageNumber)).length
        : signatures.length,
    [signatures, selectedPageSet]
  );

  const exportedTextCount = React.useMemo(
    () =>
      selectedPageSet
        ? textOverlays.filter((t) => selectedPageSet.has(t.pageNumber)).length
        : textOverlays.length,
    [textOverlays, selectedPageSet]
  );

  const handleDownload = async () => {
    if (!pdfBlob) return;
    setIsSaving(true);
    setSaveSuccessMsg(null);
    try {
      const targetName = fileName.trim() || 'signed-document.pdf';
      const res = await savePdfDocument(targetName, pdfBlob);
      if (res.success) {
        const feedback =
          res.method === 'native-android'
            ? 'In Downloads gespeichert!'
            : 'Erfolgreich gespeichert!';
        setSaveSuccessMsg(feedback);
        notifySuccess(isSubsetExport);
        setTimeout(() => {
          onClose();
        }, 1200);
      }
    } catch (err: any) {
      console.error('Save error:', err);
      setErrorMessage(err?.message || 'PDF konnte nicht gespeichert werden.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveAsLocation = async () => {
    if (!pdfBlob) return;
    setIsSavingAs(true);
    setSaveSuccessMsg(null);
    try {
      const targetName = fileName.trim() || 'signed-document.pdf';
      const res = await savePdfDocumentAs(targetName, pdfBlob);
      if (res.success) {
        setSaveSuccessMsg('Am gewählten Speicherort gespeichert!');
        notifySuccess(isSubsetExport);
        setTimeout(() => {
          onClose();
        }, 1200);
      }
    } catch (err: any) {
      console.error('Save As error:', err);
      setErrorMessage(err?.message || 'Speicherort-Dialog konnte nicht geöffnet werden.');
    } finally {
      setIsSavingAs(false);
    }
  };

  const handleNativeShare = async () => {
    if (!pdfBlob) return;
    setIsSharing(true);
    try {
      const res = await sharePdfDocument(fileName || 'signed-document.pdf', pdfBlob);
      if (res.success) {
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
      await printPdfDocument(fileName || 'signed-document.pdf', pdfBlob);
    } catch (err) {
      console.warn('Print error in modal:', err);
    } finally {
      setIsPrinting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in zoom-in duration-150">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50 shrink-0">
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
        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Page Export Scope Selection (when document has > 1 page) */}
          {pdfState.numPages > 1 && (
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-700">
                Seitenauswahl für Export
              </label>
              <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-xl border border-slate-200 text-xs">
                <button
                  type="button"
                  onClick={() => setPageScope('all')}
                  className={`py-1.5 px-2 rounded-lg font-medium transition cursor-pointer ${
                    pageScope === 'all'
                      ? 'bg-white text-blue-700 font-bold shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Alle ({pdfState.numPages})
                </button>
                <button
                  type="button"
                  onClick={() => setPageScope('current')}
                  className={`py-1.5 px-2 rounded-lg font-medium transition cursor-pointer ${
                    pageScope === 'current'
                      ? 'bg-white text-blue-700 font-bold shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Aktuelle (S. {pdfState.currentPage})
                </button>
                <button
                  type="button"
                  onClick={() => setPageScope('custom')}
                  className={`py-1.5 px-2 rounded-lg font-medium transition cursor-pointer ${
                    pageScope === 'custom'
                      ? 'bg-white text-blue-700 font-bold shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Seitenbereich
                </button>
              </div>

              {pageScope === 'custom' && (
                <div>
                  <input
                    type="text"
                    value={customPageRangeInput}
                    onChange={(e) => setCustomPageRangeInput(e.target.value)}
                    placeholder={`z. B. 1-3, 5 (max. ${pdfState.numPages})`}
                    className="w-full px-3 py-1.5 text-xs rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-500 font-mono"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Einzelne Seiten oder Bereiche getrennt durch Komma (z. B. 1-3, 5). Das geöffnete Dokument bleibt unverändert.
                  </p>
                </div>
              )}
            </div>
          )}

          {isGenerating ? (
            <div className="py-8 flex flex-col items-center justify-center gap-2">
              <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
              <p className="text-sm font-semibold text-slate-700">Compiling and saving signed PDF...</p>
              <p className="text-xs text-slate-400">Embedding transparent signatures locally (Adobe Acrobat compliant)</p>
            </div>
          ) : errorMessage ? (
            <div className="py-4 space-y-3">
              <div className="p-3.5 bg-red-50 rounded-xl border border-red-200 text-xs text-red-700 space-y-1">
                <p className="font-bold">PDF Save Failed</p>
                <p>{errorMessage}</p>
              </div>
              <button
                type="button"
                onClick={() => void compileExportPdf()}
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
                    {exportedSignaturesCount} signature{exportedSignaturesCount !== 1 ? 's' : ''}
                  </span>
                </div>
                {exportedTextCount > 0 && (
                  <div className="flex items-center justify-between text-xs text-slate-600">
                    <span>Text Overlays:</span>
                    <span className="font-semibold text-slate-900">
                      {exportedTextCount} item{exportedTextCount !== 1 ? 's' : ''}
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
                  <span>Exported Pages:</span>
                  <span className="font-semibold text-slate-900">
                    {resolvedPageSelection.exportedPageCount} of {pdfState.numPages} pages
                  </span>
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
              </div>

              {/* Form Flattening Toggle (persisted in exportSettings) */}
              {hasFormFields && (
                <div className="p-3 bg-blue-50/70 rounded-xl border border-blue-200 flex items-center justify-between gap-3">
                  <div className="text-xs">
                    <p className="font-bold text-blue-900">Flatten Form Fields (Standard merken)</p>
                    <p className="text-blue-700 text-[11px]">
                      Formularwerte dauerhaft und schreibgeschützt einbetten
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={flattenForm}
                      onChange={(e) => handleToggleFlatten(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>
              )}

              {/* Persistent Naming Preset & Output Filename */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold text-slate-700 flex items-center gap-1">
                    <Settings2 className="w-3.5 h-3.5 text-slate-500" />
                    <span>Dateinamens-Vorlage (wird gespeichert)</span>
                  </label>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-[11px]">
                  {(
                    [
                      { id: 'signed', label: '_unterschrieben' },
                      { id: 'date_prefix', label: 'JJJJ-MM-TT_' },
                      { id: 'custom_suffix', label: 'Eigenes Suffix' },
                      { id: 'original', label: 'Originalname' },
                    ] as const
                  ).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleUpdatePreset(p.id)}
                      className={`py-1.5 px-2 rounded-lg border font-medium truncate transition cursor-pointer ${
                        exportSettings.namingPreset === p.id
                          ? 'border-blue-600 bg-blue-50 text-blue-700 font-semibold'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                {exportSettings.namingPreset === 'custom_suffix' && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 shrink-0">Suffix:</span>
                    <input
                      type="text"
                      value={exportSettings.customSuffix}
                      onChange={(e) => handleUpdateCustomSuffix(e.target.value)}
                      placeholder="_bearbeitet"
                      className="flex-1 px-2.5 py-1 text-xs rounded-lg border border-slate-300 font-mono"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Output Filename
                  </label>
                  <input
                    type="text"
                    value={fileName}
                    onChange={(e) => {
                      setFileName(e.target.value);
                      setIsCustomFileNameEdited(true);
                    }}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-500 font-mono text-slate-800"
                    placeholder="document-signed.pdf"
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="space-y-2 pt-2">
                {saveSuccessMsg && (
                  <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-semibold flex items-center gap-2 animate-in fade-in">
                    <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>{saveSuccessMsg}</span>
                  </div>
                )}

                <button
                  id="modal-save-btn"
                  type="button"
                  onClick={handleDownload}
                  disabled={isSaving || isSavingAs || isGenerating || !pdfBlob}
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold text-sm shadow-md transition cursor-pointer disabled:opacity-60"
                >
                  {isSaving ? (
                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  <span>
                    {isSaving
                      ? 'Wird gespeichert...'
                      : isAndroid
                      ? 'In Downloads speichern'
                      : 'PDF speichern / Download'}
                  </span>
                </button>

                {isAndroid && (
                  <button
                    id="modal-save-as-btn"
                    type="button"
                    onClick={handleSaveAsLocation}
                    disabled={isSaving || isSavingAs || isGenerating || !pdfBlob}
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-blue-300 bg-blue-50 hover:bg-blue-100 text-blue-800 font-semibold text-xs sm:text-sm transition cursor-pointer disabled:opacity-60"
                  >
                    {isSavingAs ? (
                      <Loader2 className="w-4 h-4 animate-spin text-blue-700" />
                    ) : (
                      <FolderOpen className="w-4 h-4 text-blue-700" />
                    )}
                    <span>Speicherort wählen… (Ordner-Dialog)</span>
                  </button>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <button
                    id="modal-share-btn"
                    type="button"
                    onClick={handleNativeShare}
                    disabled={isSharing || isGenerating || !pdfBlob}
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
                    type="button"
                    onClick={handlePrint}
                    disabled={isPrinting || isGenerating || !pdfBlob}
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
