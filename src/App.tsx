import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Header } from './components/Header';
import { EmptyState } from './components/EmptyState';
import { PdfViewer } from './components/PdfViewer';
import { SignatureModal } from './components/SignatureModal';
import { AddTextModal } from './components/AddTextModal';
import { SaveModal } from './components/SaveModal';
import { GeneralSetupGuideModal } from './components/GeneralSetupGuideModal';
import { PasswordPromptModal } from './components/PasswordPromptModal';
import { PageManagementModal } from './components/PageManagementModal';
import { MobileBottomBar } from './components/MobileBottomBar';
import { SignatureItem, TextOverlayItem, FormFieldItem, FormValuesState, PdfDocumentState, TextFontFamily, TextColor, PageSpec } from './types';
import { loadPdfJsDoc, extractPdfFormFields, applyPageModifications, clearThumbnailCache } from './utils/pdfEngine';
import { useDocumentHistory } from './hooks/useDocumentHistory';
import { AlertCircle, X, Loader2 } from 'lucide-react';
import { UnsavedChangesModal } from './components/UnsavedChangesModal';

export default function App() {
  const [pdfState, setPdfState] = useState<PdfDocumentState | null>(null);
  const [isLoadingPdf, setIsLoadingPdf] = useState(false);
  const [pdfErrorMessage, setPdfErrorMessage] = useState<string | null>(null);

  // Native Form Fields metadata (structural fields from PDF)
  const [formFields, setFormFields] = useState<FormFieldItem[]>([]);
  const initialFormValuesRef = useRef<FormValuesState>({});

  // Unified Document History Manager (Signatures, Text Overlays, and Form Values)
  const {
    signatures,
    textOverlays,
    formValues,
    selectedSignatureId,
    selectedTextId,
    setSelectedSignatureId,
    setSelectedTextId,
    commitAction,
    liveUpdateSignatures,
    liveUpdateTextOverlays,
    liveUpdateFormValue,
    flushPendingFormCommit,
    undo,
    redo,
    canUndo,
    canRedo,
    undoActionName,
    redoActionName,
    historyNotice,
    resetHistory,
  } = useDocumentHistory();

  // Save / unsaved changes tracking
  const [isSaved, setIsSaved] = useState(true);
  const [hasPageModifications, setHasPageModifications] = useState(false);
  const markUnsaved = useCallback(() => {
    setIsSaved(false);
  }, []);

  // Password-protected PDF support
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [passwordPendingDoc, setPasswordPendingDoc] = useState<{
    file: File;
    arrayBuffer: ArrayBuffer;
  } | null>(null);
  const [isPasswordIncorrect, setIsPasswordIncorrect] = useState(false);

  // Check if form values differ from initial document state
  const isFormModified = React.useMemo(() => {
    const initial = initialFormValuesRef.current;
    const currentKeys = Object.keys(formValues);
    for (const k of currentKeys) {
      if (formValues[k] !== initial[k]) return true;
    }
    return false;
  }, [formValues]);

  // Overall check: has user modified anything that has not been saved yet?
  const hasUnsavedChanges = Boolean(
    pdfState && (signatures.length > 0 || textOverlays.length > 0 || isFormModified || hasPageModifications) && !isSaved
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
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [isSetupGuideModalOpen, setIsSetupGuideModalOpen] = useState(false);
  const [isPageManagerOpen, setIsPageManagerOpen] = useState(false);
  const [isReaderMode, setIsReaderMode] = useState(false);

  // Load a user-selected PDF file with robust error handling and password detection
  const handleFileSelect = async (file: File, password?: string) => {
    setIsLoadingPdf(true);
    setPdfErrorMessage(null);
    setIsPasswordIncorrect(false);

    try {
      const arrayBuffer =
        passwordPendingDoc && passwordPendingDoc.file === file
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

      // Extract native PDF AcroForm fields if present
      let initialValues: FormValuesState = {};
      try {
        const { fields, initialValues: extractedVals } = await extractPdfFormFields(arrayBuffer);
        setFormFields(fields);
        initialValues = extractedVals;
        initialFormValuesRef.current = { ...extractedVals };
      } catch (err) {
        console.warn('Could not extract form fields:', err);
        setFormFields([]);
        initialFormValuesRef.current = {};
      }

      // Reset document history with clean initial state
      resetHistory({
        signatures: [],
        textOverlays: [],
        formValues: initialValues,
      });

      setIsPasswordModalOpen(false);
      setPasswordPendingDoc(null);
      setHasPageModifications(false);
      setIsSaved(true);
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

  // Listen for shared PDF files from Web Share Target (Android native Share Sheet)
  useEffect(() => {
    const checkSharedFile = async () => {
      if ('caches' in window) {
        try {
          const cache = await caches.open('shared-pdf-cache');
          const response = await cache.match('/_shared_pdf_file_');
          if (response) {
            const blob = await response.blob();
            const filename = decodeURIComponent(
              response.headers.get('x-filename') || 'shared_document.pdf'
            );
            await cache.delete('/_shared_pdf_file_');
            const file = new File([blob], filename, { type: 'application/pdf' });
            handleFileSelect(file);

            if (window.location.search.includes('shared=true')) {
              window.history.replaceState({}, document.title, window.location.pathname);
            }
          }
        } catch (err) {
          console.warn('Could not read shared PDF from cache:', err);
        }
      }
    };

    checkSharedFile();
  }, []);

  // Listen for file launch requests from OS (PWA File Handling API "Open With")
  useEffect(() => {
    if ('launchQueue' in window && typeof (window as any).launchQueue?.setConsumer === 'function') {
      (window as any).launchQueue.setConsumer(async (launchParams: any) => {
        if (!launchParams?.files || launchParams.files.length === 0) return;
        try {
          const fileHandle = launchParams.files[0];
          const file = await fileHandle.getFile();
          if (file && (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))) {
            handleFileSelect(file);
          }
        } catch (err) {
          console.error('Failed to open file from launchQueue:', err);
        }
      });
    }
  }, []);

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
      xPercent: 52,
      yPercent: 78,
    };

    commitAction(
      {
        signatures: [...signatures, newSignature],
        selectedSignatureId: newId,
        selectedTextId: null,
      },
      'Add Signature',
      pdfState.currentPage
    );
    markUnsaved();
  };

  // High-frequency live update during drag/resize (without pushing to history yet)
  const handleLiveUpdateSignature = (updated: SignatureItem) => {
    liveUpdateSignatures(signatures.map((s) => (s.id === updated.id ? updated : s)));
    markUnsaved();
  };

  // Commit update when drag finishes, resize ends, or precision tool is clicked
  const handleCommitUpdateSignature = (updated: SignatureItem, actionName: string) => {
    const updatedList = signatures.map((s) => (s.id === updated.id ? updated : s));
    commitAction(
      {
        signatures: updatedList,
        selectedSignatureId: updated.id,
      },
      actionName || 'Move Signature',
      updated.pageNumber
    );
    markUnsaved();
  };

  // Delete a signature
  const handleDeleteSignature = useCallback(
    (id: string) => {
      const targetSig = signatures.find((s) => s.id === id);
      const pageNum = targetSig?.pageNumber || pdfState?.currentPage || 1;
      const remaining = signatures.filter((s) => s.id !== id);
      commitAction(
        {
          signatures: remaining,
          selectedSignatureId: null,
        },
        'Delete Signature',
        pageNum
      );
      markUnsaved();
    },
    [signatures, pdfState, commitAction, markUnsaved]
  );

  // Duplicate an existing signature
  const handleDuplicateSignature = (sig: SignatureItem) => {
    const newId = `sig-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const cloned: SignatureItem = {
      ...sig,
      id: newId,
      xPercent: Math.min(80, sig.xPercent + 4),
      yPercent: Math.min(80, sig.yPercent + 4),
    };
    commitAction(
      {
        signatures: [...signatures, cloned],
        selectedSignatureId: newId,
      },
      'Duplicate Signature',
      sig.pageNumber
    );
    markUnsaved();
  };

  // Text Overlay Handlers with Undo/Redo tracking
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
    commitAction(
      {
        textOverlays: [...textOverlays, newTextItem],
        selectedTextId: newId,
        selectedSignatureId: null,
      },
      'Add Text',
      pdfState.currentPage
    );
    markUnsaved();
  };

  const handleLiveUpdateText = (updated: TextOverlayItem) => {
    liveUpdateTextOverlays(textOverlays.map((t) => (t.id === updated.id ? updated : t)));
    markUnsaved();
  };

  const handleCommitUpdateText = (updated: TextOverlayItem, actionName: string) => {
    const updatedList = textOverlays.map((t) => (t.id === updated.id ? updated : t));
    commitAction(
      {
        textOverlays: updatedList,
        selectedTextId: updated.id,
      },
      actionName || 'Edit Text',
      updated.pageNumber
    );
    markUnsaved();
  };

  const handleDeleteText = useCallback(
    (id: string) => {
      const targetText = textOverlays.find((t) => t.id === id);
      const pageNum = targetText?.pageNumber || pdfState?.currentPage || 1;
      const remaining = textOverlays.filter((t) => t.id !== id);
      commitAction(
        {
          textOverlays: remaining,
          selectedTextId: null,
        },
        'Delete Text',
        pageNum
      );
      markUnsaved();
    },
    [textOverlays, pdfState, commitAction, markUnsaved]
  );

  const handleDuplicateText = (item: TextOverlayItem) => {
    const newId = `txt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const cloned: TextOverlayItem = {
      ...item,
      id: newId,
      xPercent: Math.min(85, item.xPercent + 4),
      yPercent: Math.min(85, item.yPercent + 4),
    };
    commitAction(
      {
        textOverlays: [...textOverlays, cloned],
        selectedTextId: newId,
        selectedSignatureId: null,
      },
      'Duplicate Text',
      item.pageNumber
    );
    markUnsaved();
  };

  // Form Field Handlers with Undo/Redo tracking
  const handleFormFieldChange = (fieldName: string, value: any, isDirectChoice?: boolean) => {
    markUnsaved();
    if (isDirectChoice) {
      // Discrete interactive actions (checkbox toggle, radio option, dropdown, listbox, button)
      const actionLabel =
        typeof value === 'boolean'
          ? value
            ? `Check ${fieldName}`
            : `Uncheck ${fieldName}`
          : `Select ${fieldName}`;

      commitAction(
        {
          formValues: {
            ...formValues,
            [fieldName]: value,
          },
        },
        actionLabel,
        pdfState?.currentPage || 1
      );
    } else {
      // Continuous keyboard typing (text / textarea / comb): smooth live-update with debounced history commit
      liveUpdateFormValue(fieldName, value, pdfState?.currentPage || 1);
    }
  };

  const handleCommitFormField = (_fieldName: string, _value: any) => {
    flushPendingFormCommit();
    markUnsaved();
  };

  const handleResetForm = () => {
    commitAction(
      {
        formValues: { ...initialFormValuesRef.current },
      },
      'Reset Form',
      pdfState?.currentPage || 1
    );
    markUnsaved();
  };

  // Undo action with automatic page navigation if the affected item was on another page
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

  // Global keyboard shortcuts (Ctrl+Z, Ctrl+Y, Delete)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInputActive =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);

      const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
      const isCmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      if (isCmdOrCtrl && e.key.toLowerCase() === 'z') {
        if (!isInputActive) {
          if (e.shiftKey) {
            e.preventDefault();
            handleRedo();
          } else {
            e.preventDefault();
            handleUndo();
          }
        }
      } else if (isCmdOrCtrl && e.key.toLowerCase() === 'y') {
        if (!isInputActive) {
          e.preventDefault();
          handleRedo();
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (isInputActive) return;

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
    resetHistory({
      signatures: [],
      textOverlays: [],
      formValues: {},
    });
    setFormFields([]);
    initialFormValuesRef.current = {};
    setHasPageModifications(false);
    setIsSaved(true);
    setIsReaderMode(false);
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

  // Apply page management changes (add, delete, reorder, and 90° rotations)
  const handleApplyPageModifications = async (newPages: PageSpec[]) => {
    if (!pdfState || !pdfState.arrayBuffer) return;

    // Apply the modifications to the PDF arrayBuffer using pdf-lib
    const modifiedBytes = await applyPageModifications(pdfState.arrayBuffer, newPages);
    const newBuffer = modifiedBytes.buffer.slice(
      modifiedBytes.byteOffset,
      modifiedBytes.byteOffset + modifiedBytes.byteLength
    ) as ArrayBuffer;

    // Clear thumbnail cache to ensure updated previews for subsequent views
    clearThumbnailCache();

    // Reload PDF.js document to obtain updated page structure and counts
    const pdfJsDoc = await loadPdfJsDoc(newBuffer);
    const numPages = pdfJsDoc.numPages;

    // Map old page numbers of signatures and text overlays to new page positions
    const oldToNewPageMap = new Map<number, number>();
    newPages.forEach((spec, idx) => {
      if (spec.source === 'existing' && !oldToNewPageMap.has(spec.originalPageIndex + 1)) {
        oldToNewPageMap.set(spec.originalPageIndex + 1, idx + 1);
      }
    });

    const updatedSignatures = signatures
      .filter((s) => oldToNewPageMap.has(s.pageNumber))
      .map((s) => ({
        ...s,
        pageNumber: oldToNewPageMap.get(s.pageNumber)!,
      }));

    const updatedTextOverlays = textOverlays
      .filter((t) => oldToNewPageMap.has(t.pageNumber))
      .map((t) => ({
        ...t,
        pageNumber: oldToNewPageMap.get(t.pageNumber)!,
      }));

    // Target current page: stay on mapped current page or clamp to [1, numPages]
    let nextCurrentPage = oldToNewPageMap.get(pdfState.currentPage) || 1;
    if (nextCurrentPage > numPages) nextCurrentPage = numPages;

    // Get dimensions of target page
    const targetPage = await pdfJsDoc.getPage(nextCurrentPage);
    const viewport = targetPage.getViewport({ scale: 1.0 });

    // Extract any new or rearranged form fields
    let updatedFormFields: FormFieldItem[] = [];
    try {
      const { fields } = await extractPdfFormFields(newBuffer);
      updatedFormFields = fields;
    } catch {
      updatedFormFields = [];
    }

    setPdfState({
      ...pdfState,
      arrayBuffer: newBuffer,
      numPages,
      currentPage: nextCurrentPage,
      pageWidth: viewport.width,
      pageHeight: viewport.height,
    });

    setFormFields(updatedFormFields);

    commitAction(
      {
        signatures: updatedSignatures,
        textOverlays: updatedTextOverlays,
        selectedSignatureId: null,
        selectedTextId: null,
      },
      'Manage Pages',
      nextCurrentPage
    );

    setHasPageModifications(true);
    markUnsaved();
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-slate-100 text-slate-900 font-sans overflow-hidden">
      {/* Top Navigation & Status */}
      {!isReaderMode && (
        <Header
          documentName={pdfState?.name || ''}
          hasDocument={!!pdfState}
          signatureCount={signatures.length}
          hasUnsavedChanges={hasUnsavedChanges}
          hasPageModifications={hasPageModifications}
          onOpenSetupGuide={() => setIsSetupGuideModalOpen(true)}
          onOpenSave={() => setIsSaveModalOpen(true)}
          onOpenPageManager={() => setIsPageManagerOpen(true)}
          onFileSelect={handleRequestFileSelect}
          onCloseDocument={handleRequestCloseDocument}
        />
      )}

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
            onUpdateText={handleLiveUpdateText}
            onCommitUpdateText={handleCommitUpdateText}
            onDeleteText={handleDeleteText}
            onDuplicateText={handleDuplicateText}
            onFormFieldChange={handleFormFieldChange}
            onCommitFormField={handleCommitFormField}
            onResetForm={handleResetForm}
            onChangePage={handleChangePage}
            onOpenSignatureModal={() => setIsSignatureModalOpen(true)}
            onOpenTextModal={() => setIsTextModalOpen(true)}
            onOpenPageManager={() => setIsPageManagerOpen(true)}
            canUndo={canUndo}
            canRedo={canRedo}
            undoActionName={undoActionName}
            redoActionName={redoActionName}
            onUndo={handleUndo}
            onRedo={handleRedo}
            historyNotice={historyNotice}
            isReaderMode={isReaderMode}
            onToggleReaderMode={setIsReaderMode}
          />
        )}
      </main>

      {/* Mobile Bottom Navigation Bar (Visible on phones) */}
      {pdfState && !isReaderMode && (
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
          onOpenPageManager={() => setIsPageManagerOpen(true)}
          onSave={() => setIsSaveModalOpen(true)}
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
        <SaveModal
          isOpen={isSaveModalOpen}
          pdfState={pdfState}
          signatures={signatures}
          textOverlays={textOverlays}
          formValues={formValues}
          hasFormFields={formFields.length > 0}
          hasPageModifications={hasPageModifications}
          onClose={() => setIsSaveModalOpen(false)}
          onSaveSuccess={() => {
            setIsSaved(true);
            setHasPageModifications(false);
          }}
        />
      )}

      <GeneralSetupGuideModal
        isOpen={isSetupGuideModalOpen}
        onClose={() => setIsSetupGuideModalOpen(false)}
      />

      {/* Page Management Modal: Add, Delete, Reorder, and Rotate */}
      {pdfState && (
        <PageManagementModal
          isOpen={isPageManagerOpen}
          pdfState={pdfState}
          currentPage={pdfState.currentPage}
          onClose={() => setIsPageManagerOpen(false)}
          onApplyChanges={handleApplyPageModifications}
          onJumpToPage={(pageNum) => handleChangePage(pageNum)}
        />
      )}

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
        onSaveFirst={() => {
          setIsUnsavedModalOpen(false);
          setIsSaveModalOpen(true);
        }}
      />
    </div>
  );
}
