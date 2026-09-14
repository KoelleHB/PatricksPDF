import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Header } from './components/Header';
import { EmptyState } from './components/EmptyState';
import { PdfViewer } from './components/PdfViewer';
import { SignatureModal } from './components/SignatureModal';
import { AddTextModal } from './components/AddTextModal';
import { ExportModal } from './components/ExportModal';
import { GeneralSetupGuideModal } from './components/GeneralSetupGuideModal';
import { PasswordPromptModal } from './components/PasswordPromptModal';
import { MobileBottomBar } from './components/MobileBottomBar';
import { SignatureItem, TextOverlayItem, FormFieldItem, FormValuesState, PdfDocumentState, TextFontFamily, TextColor } from './types';
import { loadPdfJsDoc, extractPdfFormFields } from './utils/pdfEngine';
import { useSignatureHistory } from './hooks/useSignatureHistory';
import { AlertCircle, X, Loader2, FileCheck, RotateCcw } from 'lucide-react';

export default function App() {
  const [pdfState, setPdfState] = useState<PdfDocumentState | null>(null);
  const [isLoadingPdf, setIsLoadingPdf] = useState(false);
  const [pdfErrorMessage, setPdfErrorMessage] = useState<string | null>(null);

  // Text Overlays & Native Form State
  const [textOverlays, setTextOverlays] = useState<TextOverlayItem[]>([]);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [formFields, setFormFields] = useState<FormFieldItem[]>([]);
  const [formValues, setFormValues] = useState<FormValuesState>({});
  const initialFormValuesRef = useRef<FormValuesState>({});
  const [hasFormNotice, setHasFormNotice] = useState(false);

  // Password-protected PDF support
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [passwordPendingDoc, setPasswordPendingDoc] = useState<{
    file: File;
    arrayBuffer: ArrayBuffer;
  } | null>(null);
  const [isPasswordIncorrect, setIsPasswordIncorrect] = useState(false);

  // Undo / Redo Signature History Manager
  const {
    signatures,
    selectedSignatureId,
    setSelectedSignatureId,
    commitAction,
    liveUpdate,
    undo,
    redo,
    canUndo,
    canRedo,
    undoActionName,
    redoActionName,
    historyNotice,
    resetHistory,
  } = useSignatureHistory([]);

  // Modals state
  const [isSignatureModalOpen, setIsSignatureModalOpen] = useState(false);
  const [isTextModalOpen, setIsTextModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isSetupGuideModalOpen, setIsSetupGuideModalOpen] = useState(false);

  // Load a user-selected PDF file with robust error handling and password detection
  const handleFileSelect = async (file: File, password?: string) => {
    setIsLoadingPdf(true);
    setPdfErrorMessage(null);
    setIsPasswordIncorrect(false);
    setHasFormNotice(false);

    try {
      // If we already have the arrayBuffer from a pending password attempt, reuse it; otherwise read it
      const arrayBuffer = passwordPendingDoc && passwordPendingDoc.file === file
        ? passwordPendingDoc.arrayBuffer
        : await file.arrayBuffer();

      const pdfJsDoc = await loadPdfJsDoc(arrayBuffer, password);
      const page1 = await pdfJsDoc.getPage(1);
      const viewport = page1.getViewport({ scale: 1.0 });

      setPdfState({
        file,
        name: file.name,
        arrayBuffer,
        numPages: pdfJsDoc.numPages,
        currentPage: 1,
        pageWidth: viewport.width,
        pageHeight: viewport.height,
      });

      // Reset signatures and undo/redo history on new document
      resetHistory([]);
      setTextOverlays([]);
      setSelectedTextId(null);
      setIsPasswordModalOpen(false);
      setPasswordPendingDoc(null);

      // Extract native PDF AcroForm fields if present
      try {
        const { fields, initialValues } = await extractPdfFormFields(arrayBuffer);
        setFormFields(fields);
        setFormValues(initialValues);
        initialFormValuesRef.current = { ...initialValues };
        if (fields.length > 0) {
          setHasFormNotice(true);
        }
      } catch (err) {
        console.warn('Could not extract form fields:', err);
        setFormFields([]);
        setFormValues({});
        initialFormValuesRef.current = {};
      }
    } catch (err: any) {
      console.error('Error loading PDF file:', err);

      // Check if document requires password or password was wrong
      if (err?.name === 'PasswordException' || err?.code === 1 || err?.code === 2) {
        setPasswordPendingDoc({
          file,
          arrayBuffer: passwordPendingDoc?.arrayBuffer || (await file.arrayBuffer()),
        });
        setIsPasswordIncorrect(err?.code === 2 || !!password);
        setIsPasswordModalOpen(true);
      } else {
        const errorDetail = err?.message || 'Unable to parse PDF structure.';
        setPdfErrorMessage(
          `Could not open "${file.name}": ${errorDetail}. Please ensure the file is an uncorrupted PDF.`
        );
      }
    } finally {
      setIsLoadingPdf(false);
    }
  };

  const handleUnlockPassword = (password: string) => {
    if (passwordPendingDoc) {
      handleFileSelect(passwordPendingDoc.file, password);
    }
  };

  // Add a newly processed transparent signature
  const handleAddSignature = (
    itemData: Omit<SignatureItem, 'id' | 'xPercent' | 'yPercent' | 'pageNumber'>
  ) => {
    if (!pdfState) return;

    const newId = `sig-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    // Default placement: nicely centered on the bottom half of the current page
    const newSignature: SignatureItem = {
      ...itemData,
      id: newId,
      pageNumber: pdfState.currentPage,
      xPercent: 52, // Placed near right signature column by default
      yPercent: 78,
    };

    commitAction([...signatures, newSignature], 'Add signature', pdfState.currentPage, newId);
  };

  // High-frequency live update during drag/resize (without pushing to history yet)
  const handleLiveUpdateSignature = (updated: SignatureItem) => {
    liveUpdate(signatures.map((s) => (s.id === updated.id ? updated : s)));
  };

  // Commit update when drag finishes, resize ends, or precision tool is clicked
  const handleCommitUpdateSignature = (updated: SignatureItem, actionName: string) => {
    const updatedList = signatures.map((s) => (s.id === updated.id ? updated : s));
    commitAction(updatedList, actionName, updated.pageNumber, updated.id);
  };

  // Delete a signature
  const handleDeleteSignature = useCallback((id: string) => {
    const targetSig = signatures.find((s) => s.id === id);
    const pageNum = targetSig?.pageNumber || pdfState?.currentPage || 1;
    const remaining = signatures.filter((s) => s.id !== id);
    commitAction(remaining, 'Delete signature', pageNum, null);
  }, [signatures, pdfState, commitAction]);

  // Duplicate an existing signature
  const handleDuplicateSignature = (sig: SignatureItem) => {
    const newId = `sig-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const cloned: SignatureItem = {
      ...sig,
      id: newId,
      xPercent: Math.min(80, sig.xPercent + 4),
      yPercent: Math.min(80, sig.yPercent + 4),
    };
    commitAction([...signatures, cloned], 'Duplicate signature', sig.pageNumber, newId);
  };

  // Undo action with automatic page navigation if the affected signature was on another page
  const handleUndo = useCallback(() => {
    const targetPage = undo();
    if (targetPage && pdfState && targetPage !== pdfState.currentPage) {
      setPdfState((prev) => (prev ? { ...prev, currentPage: targetPage } : null));
    }
  }, [undo, pdfState]);

  // Redo action with automatic page navigation
  const handleRedo = useCallback(() => {
    const targetPage = redo();
    if (targetPage && pdfState && targetPage !== pdfState.currentPage) {
      setPdfState((prev) => (prev ? { ...prev, currentPage: targetPage } : null));
    }
  }, [redo, pdfState]);

  const handleDeleteText = useCallback((id: string) => {
    setTextOverlays((prev) => prev.filter((t) => t.id !== id));
    setSelectedTextId(null);
  }, []);

  // Global keyboard shortcuts (Ctrl+Z, Ctrl+Y, Delete)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is currently typing in an input or textarea
      const target = e.target as HTMLElement;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
      const isCmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      if (isCmdOrCtrl && e.key.toLowerCase() === 'z') {
        if (e.shiftKey) {
          // Redo: Ctrl+Shift+Z or Cmd+Shift+Z
          e.preventDefault();
          handleRedo();
        } else {
          // Undo: Ctrl+Z or Cmd+Z
          e.preventDefault();
          handleUndo();
        }
      } else if (isCmdOrCtrl && e.key.toLowerCase() === 'y') {
        // Redo: Ctrl+Y
        e.preventDefault();
        handleRedo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        const activeTag = (document.activeElement?.tagName || '').toLowerCase();
        if (activeTag === 'input' || activeTag === 'textarea') return;

        if (selectedSignatureId) {
          e.preventDefault();
          handleDeleteSignature(selectedSignatureId);
        } else if (selectedTextId) {
          e.preventDefault();
          handleDeleteText(selectedTextId);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo, selectedSignatureId, selectedTextId, handleDeleteSignature, handleDeleteText]);

  // Text Overlay Handlers
  const handleAddText = (
    text: string,
    fontFamily: TextFontFamily,
    color: TextColor,
    fontSize: number
  ) => {
    if (!pdfState) return;
    const newId = `txt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const newTextItem: TextOverlayItem = {
      id: newId,
      pageNumber: pdfState.currentPage,
      text,
      xPercent: 35,
      yPercent: 40,
      widthPercent: 25,
      fontSize,
      fontFamily,
      color,
    };
    setTextOverlays((prev) => [...prev, newTextItem]);
    setSelectedTextId(newId);
    setSelectedSignatureId(null);
  };

  const handleUpdateText = (updated: TextOverlayItem) => {
    setTextOverlays((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  };

  const handleDuplicateText = (item: TextOverlayItem) => {
    const newId = `txt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const cloned: TextOverlayItem = {
      ...item,
      id: newId,
      xPercent: Math.min(85, item.xPercent + 4),
      yPercent: Math.min(85, item.yPercent + 4),
    };
    setTextOverlays((prev) => [...prev, cloned]);
    setSelectedTextId(newId);
    setSelectedSignatureId(null);
  };

  const handleFormFieldChange = (fieldName: string, value: any) => {
    setFormValues((prev) => ({
      ...prev,
      [fieldName]: value,
    }));
  };

  const handleResetForm = () => {
    setFormValues({ ...initialFormValuesRef.current });
  };

  const handleChangePage = (newPage: number) => {
    if (!pdfState) return;
    const boundedPage = Math.max(1, Math.min(pdfState.numPages, newPage));
    setPdfState({
      ...pdfState,
      currentPage: boundedPage,
    });
    setSelectedSignatureId(null);
    setSelectedTextId(null);
  };

  const handleClearDocument = () => {
    setPdfState(null);
    resetHistory([]);
    setTextOverlays([]);
    setSelectedTextId(null);
    setFormFields([]);
    setFormValues({});
    initialFormValuesRef.current = {};
    setHasFormNotice(false);
  };

  return (
    <div className="flex flex-col min-h-screen bg-slate-100 text-slate-900 font-sans">
      {/* Top Navigation & Status */}
      <Header
        documentName={pdfState?.name || ''}
        hasDocument={!!pdfState}
        signatureCount={signatures.length}
        onOpenSetupGuide={() => setIsSetupGuideModalOpen(true)}
        onOpenExport={() => setIsExportModalOpen(true)}
        onFileSelect={handleFileSelect}
      />

      {/* AcroForm Detected Notification Banner */}
      {hasFormNotice && formFields.length > 0 && (
        <div className="bg-blue-50 border-b border-blue-200 px-4 py-2.5 flex items-center justify-between gap-3 text-blue-900 text-xs sm:text-sm animate-in slide-in-from-top duration-150">
          <div className="flex items-center gap-2">
            <FileCheck className="w-4 h-4 text-blue-600 shrink-0" />
            <span>
              <strong>Fillable Form Detected:</strong> Found {formFields.length} interactive form fields. You can click and type directly on the document.
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleResetForm}
              className="px-2.5 py-1 text-xs font-semibold text-blue-700 bg-blue-100 hover:bg-blue-200 active:bg-blue-300 rounded transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
              title="Reset all form fields to their original values"
            >
              <RotateCcw className="w-3 h-3" />
              Reset Form
            </button>
            <button
              onClick={() => setHasFormNotice(false)}
              className="p-1 rounded text-blue-500 hover:text-blue-800 hover:bg-blue-100 transition cursor-pointer"
              title="Dismiss notification"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Error Notification Toast/Banner */}
      {pdfErrorMessage && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2.5 flex items-center justify-between gap-3 text-red-800 text-xs sm:text-sm animate-in slide-in-from-top duration-150">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{pdfErrorMessage}</span>
          </div>
          <button
            onClick={() => setPdfErrorMessage(null)}
            className="p-1 rounded text-red-500 hover:text-red-800 hover:bg-red-100 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main Workspace */}
      <main className="flex-1 flex flex-col min-h-0 relative">
        {isLoadingPdf && (
          <div className="absolute inset-0 z-40 bg-white/75 backdrop-blur-xs flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
            <div className="text-center">
              <p className="text-sm font-semibold text-slate-800">Opening PDF Document...</p>
              <p className="text-xs text-slate-500 mt-0.5">Verifying structure and loading CMaps</p>
            </div>
          </div>
        )}

        {!pdfState ? (
          <EmptyState onFileSelect={handleFileSelect} />
        ) : (
          <PdfViewer
            pdfState={pdfState}
            signatures={signatures}
            selectedSignatureId={selectedSignatureId}
            textOverlays={textOverlays}
            selectedTextId={selectedTextId}
            formFields={formFields}
            formValues={formValues}
            onSelectSignature={setSelectedSignatureId}
            onUpdateSignature={handleLiveUpdateSignature}
            onCommitUpdateSignature={handleCommitUpdateSignature}
            onDeleteSignature={handleDeleteSignature}
            onDuplicateSignature={handleDuplicateSignature}
            onSelectText={setSelectedTextId}
            onUpdateText={handleUpdateText}
            onDeleteText={handleDeleteText}
            onDuplicateText={handleDuplicateText}
            onFormFieldChange={handleFormFieldChange}
            onResetForm={handleResetForm}
            onChangePage={handleChangePage}
            onOpenSignatureModal={() => setIsSignatureModalOpen(true)}
            onOpenTextModal={() => setIsTextModalOpen(true)}
            canUndo={canUndo}
            canRedo={canRedo}
            undoActionName={undoActionName}
            redoActionName={redoActionName}
            onUndo={handleUndo}
            onRedo={handleRedo}
            historyNotice={historyNotice}
          />
        )}
      </main>

      {/* Mobile Bottom Navigation Bar (Visible on phones) */}
      {pdfState && (
        <MobileBottomBar
          pdfState={pdfState}
          signatureCount={signatures.length}
          textCount={textOverlays.length}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onAddSignature={() => setIsSignatureModalOpen(true)}
          onAddText={() => setIsTextModalOpen(true)}
          onExport={() => setIsExportModalOpen(true)}
          onChangePage={handleChangePage}
          onChangeDocument={handleClearDocument}
        />
      )}

      {/* Modals */}
      <SignatureModal
        isOpen={isSignatureModalOpen}
        currentPage={pdfState?.currentPage || 1}
        onClose={() => setIsSignatureModalOpen(false)}
        onAddSignature={handleAddSignature}
      />

      <AddTextModal
        isOpen={isTextModalOpen}
        onClose={() => setIsTextModalOpen(false)}
        onAddText={handleAddText}
      />

      {pdfState && (
        <ExportModal
          isOpen={isExportModalOpen}
          pdfState={pdfState}
          signatures={signatures}
          textOverlays={textOverlays}
          formValues={formValues}
          hasFormFields={formFields.length > 0}
          onClose={() => setIsExportModalOpen(false)}
        />
      )}

      <GeneralSetupGuideModal
        isOpen={isSetupGuideModalOpen}
        onClose={() => setIsSetupGuideModalOpen(false)}
      />

      {/* Password Prompt Modal for Encrypted PDFs */}
      <PasswordPromptModal
        isOpen={isPasswordModalOpen}
        fileName={passwordPendingDoc?.file.name || 'Document'}
        isIncorrect={isPasswordIncorrect}
        onUnlock={handleUnlockPassword}
        onClose={() => {
          setIsPasswordModalOpen(false);
          setPasswordPendingDoc(null);
        }}
      />
    </div>
  );
}
