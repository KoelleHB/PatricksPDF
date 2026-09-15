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
import { AlertCircle, X, Loader2 } from 'lucide-react';
import { UnsavedChangesModal } from './components/UnsavedChangesModal';

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

  // Export / unsaved changes tracking
  const [isExported, setIsExported] = useState(true);
  const markUnsaved = useCallback(() => {
    setIsExported(false);
  }, []);

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

  // Check if form values differ from initial document state
  const isFormModified = React.useMemo(() => {
    const initial = initialFormValuesRef.current;
    const currentKeys = Object.keys(formValues);
    for (const k of currentKeys) {
      if (formValues[k] !== initial[k]) return true;
    }
    return false;
  }, [formValues]);

  // Overall check: has user modified anything that has not been exported yet?
  const hasUnsavedChanges = Boolean(
    pdfState && (signatures.length > 0 || textOverlays.length > 0 || isFormModified) && !isExported
  );

  // Browser beforeunload event listener (triggers browser's native leave confirmation)
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [hasUnsavedChanges]);

  // Pending action for switching document or closing document with unsaved changes
  const [pendingAction, setPendingAction] = useState<{
    type: 'close' | 'switch';
    file?: File;
  } | null>(null);
  const [isUnsavedModalOpen, setIsUnsavedModalOpen] = useState(false);

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
      setIsExported(true);

      // Extract native PDF AcroForm fields if present
      try {
        const { fields, initialValues } = await extractPdfFormFields(arrayBuffer);
        setFormFields(fields);
        setFormValues(initialValues);
        initialFormValuesRef.current = { ...initialValues };
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
    markUnsaved();
  };

  // High-frequency live update during drag/resize (without pushing to history yet)
  const handleLiveUpdateSignature = (updated: SignatureItem) => {
    liveUpdate(signatures.map((s) => (s.id === updated.id ? updated : s)));
    markUnsaved();
  };

  // Commit update when drag finishes, resize ends, or precision tool is clicked
  const handleCommitUpdateSignature = (updated: SignatureItem, actionName: string) => {
    const updatedList = signatures.map((s) => (s.id === updated.id ? updated : s));
    commitAction(updatedList, actionName, updated.pageNumber, updated.id);
    markUnsaved();
  };

  // Delete a signature
  const handleDeleteSignature = useCallback((id: string) => {
    const targetSig = signatures.find((s) => s.id === id);
    const pageNum = targetSig?.pageNumber || pdfState?.currentPage || 1;
    const remaining = signatures.filter((s) => s.id !== id);
    commitAction(remaining, 'Delete signature', pageNum, null);
    markUnsaved();
  }, [signatures, pdfState, commitAction, markUnsaved]);

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
    markUnsaved();
  };

  // Undo action with automatic page navigation if the affected signature was on another page
  const handleUndo = useCallback(() => {
    const targetPage = undo();
    if (targetPage && pdfState && targetPage !== pdfState.currentPage) {
      setPdfState((prev) => (prev ? { ...prev, currentPage: targetPage } : null));
    }
    markUnsaved();
  }, [undo, pdfState, markUnsaved]);

  // Redo action with automatic page navigation
  const handleRedo = useCallback(() => {
    const targetPage = redo();
    if (targetPage && pdfState && targetPage !== pdfState.currentPage) {
      setPdfState((prev) => (prev ? { ...prev, currentPage: targetPage } : null));
    }
    markUnsaved();
  }, [redo, pdfState, markUnsaved]);

  const handleDeleteText = useCallback((id: string) => {
    setTextOverlays((prev) => prev.filter((t) => t.id !== id));
    setSelectedTextId(null);
    markUnsaved();
  }, [markUnsaved]);

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
    markUnsaved();
  };

  const handleUpdateText = (updated: TextOverlayItem) => {
    setTextOverlays((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    markUnsaved();
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
    markUnsaved();
  };

  const handleFormFieldChange = (fieldName: string, value: any) => {
    setFormValues((prev) => ({
      ...prev,
      [fieldName]: value,
    }));
    markUnsaved();
  };

  const handleResetForm = () => {
    setFormValues({ ...initialFormValuesRef.current });
    markUnsaved();
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
    setIsExported(true);
  };

  // Safe request to close document with unsaved changes verification
  const handleRequestCloseDocument = () => {
    if (hasUnsavedChanges) {
      setPendingAction({ type: 'close' });
      setIsUnsavedModalOpen(true);
    } else {
      handleClearDocument();
    }
  };

  // Safe request to open / switch document with unsaved changes verification
  const handleRequestFileSelect = (file: File) => {
    if (hasUnsavedChanges) {
      setPendingAction({ type: 'switch', file });
      setIsUnsavedModalOpen(true);
    } else {
      handleFileSelect(file);
    }
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-slate-100 text-slate-900 font-sans overflow-hidden">
      {/* Top Navigation & Status */}
      <Header
        documentName={pdfState?.name || ''}
        hasDocument={!!pdfState}
        signatureCount={signatures.length}
        hasUnsavedChanges={hasUnsavedChanges}
        onOpenSetupGuide={() => setIsSetupGuideModalOpen(true)}
        onOpenExport={() => setIsExportModalOpen(true)}
        onFileSelect={handleRequestFileSelect}
        onCloseDocument={handleRequestCloseDocument}
      />

      {/* Error Notification Toast/Banner */}
      {pdfErrorMessage && (
        <div className="shrink-0 bg-red-50 border-b border-red-200 px-4 py-2.5 flex items-center justify-between gap-3 text-red-800 text-xs sm:text-sm animate-in slide-in-from-top duration-150">
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
      <main className="flex-1 min-h-0 flex flex-col relative overflow-hidden">
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
          onChangeDocument={handleRequestCloseDocument}
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
          onExportSuccess={() => setIsExported(true)}
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

      {/* Unsaved Changes Confirmation Modal */}
      <UnsavedChangesModal
        isOpen={isUnsavedModalOpen}
        documentName={pdfState?.name || 'Document'}
        actionType={pendingAction?.type || 'close'}
        onKeepEditing={() => {
          setIsUnsavedModalOpen(false);
          setPendingAction(null);
        }}
        onDiscardChanges={() => {
          setIsUnsavedModalOpen(false);
          if (pendingAction?.type === 'switch' && pendingAction.file) {
            const nextFile = pendingAction.file;
            setPendingAction(null);
            handleFileSelect(nextFile);
          } else {
            setPendingAction(null);
            handleClearDocument();
          }
        }}
        onExportFirst={() => {
          setIsUnsavedModalOpen(false);
          setIsExportModalOpen(true);
        }}
      />
    </div>
  );
}
