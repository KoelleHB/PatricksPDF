import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Header } from './components/Header';
import { EmptyState } from './components/EmptyState';
import { PdfViewer } from './components/PdfViewer';
import { SignatureModal } from './components/SignatureModal';
import { AddTextModal } from './components/AddTextModal';
import { SaveModal } from './components/SaveModal';
import { PasswordPromptModal } from './components/PasswordPromptModal';
import { PageManagementModal } from './components/PageManagementModal';
import { MobileBottomBar } from './components/MobileBottomBar';
import { RecentDocumentsModal } from './components/RecentDocumentsModal';
import { SignatureItem, TextOverlayItem, FormFieldItem, FormValuesState, PdfDocumentState, TextFontFamily, TextColor, PageSpec, RecentDocumentRecord } from './types';
import { loadPdfJsDoc, extractPdfFormFields, applyPageModifications, buildStagedPageExportSnapshot, type StagedPageExportSnapshot, clearThumbnailCache, disposePdfJsResources, generatePageThumbnail, embedSignaturesIntoPdf } from './utils/pdfEngine';
import { getRecentDocuments, getRecentDocumentBlob, saveRecentDocument, removeRecentDocument, clearRecentDocuments } from './utils/recentDocuments';
import { sharePdfDocument, printPdfDocument } from './utils/nativeBridge';
import { useDocumentHistory } from './hooks/useDocumentHistory';
import { usePwaShareTarget } from './hooks/usePwaShareTarget';
import { AlertCircle, X, Loader2, Share2, FileQuestion, HelpCircle } from 'lucide-react';
import { UnsavedChangesModal } from './components/UnsavedChangesModal';
import { AppError, createAppError } from './utils/appError';
import { ErrorDiagnosticsModal } from './components/ErrorDiagnosticsModal';
import {
  computeSignaturePlacement,
  computeTextPlacement,
  type ViewportPageSnapshot,
} from './utils/pdfPlacement';
import { useIsMobile } from './hooks/useIsMobile';

export default function App() {
  const [pdfState, setPdfState] = useState<PdfDocumentState | null>(null);
  const [isLoadingPdf, setIsLoadingPdf] = useState(false);
  const [isReceivingSharedPdf, setIsReceivingSharedPdf] = useState(() => 
    typeof window !== 'undefined' && window.location.search.includes('shared=true')
  );
  const [pdfErrorMessage, setPdfErrorMessage] = useState<string | null>(null);
  const [activeAppError, setActiveAppError] = useState<AppError | null>(null);
  const [shareIssueNotice, setShareIssueNotice] = useState<{
    title: string;
    message: string;
    details?: any;
    attemptedFile?: string;
  } | null>(null);
  const [showDiagnosticsModal, setShowDiagnosticsModal] = useState(false);
  const manualFileInputRef = useRef<HTMLInputElement>(null);
  const originalPdfBufferRef = useRef<ArrayBuffer | null>(null);
  const viewportSnapshotGetterRef = useRef<(() => ViewportPageSnapshot | null) | null>(null);
  const pendingPlacementSnapshotRef = useRef<ViewportPageSnapshot | null>(null);

  const handleRegisterViewportSnapshotGetter = useCallback(
    (getter: (() => ViewportPageSnapshot | null) | null) => {
      viewportSnapshotGetterRef.current = getter;
    },
    []
  );

  // Native Form Fields metadata (structural fields from PDF)
  const [formFields, setFormFields] = useState<FormFieldItem[]>([]);
  const initialFormValuesRef = useRef<FormValuesState>({});

  // Unified Document History Manager (Signatures, Text Overlays, Form Values, and deterministic Saved State)
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
    getPageDocument,
    isSaved,
    markCurrentStateSaved,
  } = useDocumentHistory();

  // Structural page modification indicator
  const [hasPageModifications, setHasPageModifications] = useState(false);
  const markUnsaved = useCallback(() => {
    // Saved status is deterministically derived from state signatures in useDocumentHistory
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
  // Do not infer safety from remaining overlays: edits such as removing an
  // existing signature or resetting a field still require an explicit save.
  const hasUnsavedChanges = Boolean(pdfState && !isSaved);

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

  // Local Document History (Zuletzt geöffnet)
  const [recentDocs, setRecentDocs] = useState<RecentDocumentRecord[]>([]);
  const [isRecentModalOpen, setIsRecentModalOpen] = useState(false);
  const [isQuickProcessing, setIsQuickProcessing] = useState(false);

  // Load recent documents on initial mount
  useEffect(() => {
    getRecentDocuments()
      .then((docs) => setRecentDocs(docs))
      .catch((err) => console.warn('Failed to load recent documents:', err));
  }, []);

  // Modals state
  const [isSignatureModalOpen, setIsSignatureModalOpen] = useState(false);
  const [isTextModalOpen, setIsTextModalOpen] = useState(false);
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [exportSelectedPages, setExportSelectedPages] = useState<number[] | null>(null);
  const [exportOverrideSnapshot, setExportOverrideSnapshot] = useState<StagedPageExportSnapshot | null>(null);
  const [isPageManagerOpen, setIsPageManagerOpen] = useState(false);
  const [isReaderMode, setIsReaderMode] = useState(false);

  // Mobile environment & bottom bar visibility state
  const isMobile = useIsMobile();
  const [isMobileBottomBarVisible, setIsMobileBottomBarVisible] = useState(true);

  // Load a user-selected PDF file with robust error handling and password detection
  const handleFileSelect = async (file: File, password?: string) => {
    setIsLoadingPdf(true);
    setPdfErrorMessage(null);
    setActiveAppError(null);
    setIsPasswordIncorrect(false);

    try {
      const arrayBuffer =
        passwordPendingDoc && passwordPendingDoc.file === file
          ? passwordPendingDoc.arrayBuffer
          : await file.arrayBuffer();

      if (pdfState?.arrayBuffer && pdfState.file !== file) {
        clearThumbnailCache();
        try {
          await disposePdfJsResources();
        } catch (disposeErr) {
          console.warn('PDF resource disposal warning:', disposeErr);
        }
      }
      const pdfJsDoc = await loadPdfJsDoc(arrayBuffer, password);
      const page1 = await pdfJsDoc.getPage(1);
      const viewport = page1.getViewport({ scale: 1.0 });

      originalPdfBufferRef.current = arrayBuffer;
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
      let initialFields: FormFieldItem[] = [];
      try {
        const { fields, initialValues: extractedVals } = await extractPdfFormFields(arrayBuffer);
        setFormFields(fields);
        initialFields = fields;
        initialValues = extractedVals;
        initialFormValuesRef.current = { ...extractedVals };
      } catch (err) {
        console.warn('Could not extract form fields:', err);
        setFormFields([]);
        initialFormValuesRef.current = {};
      }

      // Reset document history with clean initial state
      resetHistory({
        pageDocument: {
          arrayBuffer, numPages: pdfJsDoc.numPages, currentPage: 1,
          pageWidth: viewport.width, pageHeight: viewport.height,
          formFields: initialFields,
        },
        signatures: [],
        textOverlays: [],
        formValues: initialValues,
      });

      setIsPasswordModalOpen(false);
      setPasswordPendingDoc(null);
      setHasPageModifications(false);

      // Non-blocking background generation of page 1 thumbnail for local document history
      const scheduleRecentDocPersist = () => {
        generatePageThumbnail(arrayBuffer, 1, 160, password)
          .then(async (thumbnail) => {
            await saveRecentDocument({
              name: file.name,
              buffer: arrayBuffer,
              numPages: pdfJsDoc.numPages,
              thumbnailDataUrl: thumbnail || undefined,
            });
            const updatedRecent = await getRecentDocuments();
            setRecentDocs(updatedRecent);
          })
          .catch((err) => console.warn('Recent doc thumbnail save warning:', err));
      };

      if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        (window as any).requestIdleCallback(scheduleRecentDocPersist, { timeout: 1500 });
      } else {
        setTimeout(scheduleRecentDocPersist, 350);
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
        const msg = `Could not open "${file.name}": ${errorDetail}. Please ensure the file is an uncorrupted PDF.`;
        setPdfErrorMessage(msg);
        setActiveAppError(
          createAppError('PDF_LOAD_FAILED', 'PDF konnte nicht geöffnet werden', msg, err, {
            fileName: file.name,
            fileSize: file.size,
          })
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

  usePwaShareTarget({
    onFile: (file) => { void handleFileSelect(file); },
    onReceivingState: setIsReceivingSharedPdf,
    onShareIssue: setShareIssueNotice,
  });

  // Listen for file launch requests from OS (PWA File Handling API "Open With")
  useEffect(() => {
    if (window.location.pathname === '/openFile' || window.location.pathname === '/openFile/') {
      window.history.replaceState({}, document.title, '/');
    }

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

  // Listen for native Android "Open with" and Share Sheet intents from Capacitor BridgeActivity
  useEffect(() => {
    const processNativePdf = async (data: { name: string; token?: string; size?: number; base64?: string }) => {
      if (!data) return;
      const bridge = (window as any).NativePdfBridge;
      try {
        let bytes: Uint8Array;
        if (data.token && typeof bridge?.readIncomingPdfChunk === 'function') {
          const size = Number(data.size);
          if (!Number.isSafeInteger(size) || size <= 0 || size > 512 * 1024 * 1024) {
            throw new Error('Unsupported incoming PDF size');
          }
          bytes = new Uint8Array(size);
          const chunkSize = 48 * 1024;
          for (let offset = 0; offset < size; offset += chunkSize) {
            const encoded = bridge.readIncomingPdfChunk(data.token, offset);
            if (!encoded) throw new Error('Incoming PDF transfer interrupted');
            const binary = atob(encoded);
            if (binary.length > size - offset) throw new Error('Invalid PDF chunk');
            for (let i = 0; i < binary.length; i++) bytes[offset + i] = binary.charCodeAt(i);
          }
        } else if (data.base64) {
          // Compatibility with an older installed Android bridge.
          const binary = atob(data.base64);
          bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        } else return;
        const file = new File([bytes as any], data.name || 'document.pdf', { type: 'application/pdf' });
        setIsReceivingSharedPdf(false);
        setShareIssueNotice(null);
        await handleFileSelect(file);
      } catch (err) {
        console.error('[Native Bridge] Error reading incoming PDF:', err);
        setShareIssueNotice({ title: 'Android-Dateiübertragung', message: 'PDF konnte nicht aus Android übernommen werden.' });
      } finally {
        if (data.token) bridge?.releaseIncomingPdf?.(data.token);
      }
    };

    // 1. Check if there was an intent waiting from cold start
    const bridge = (window as any).NativePdfBridge;
    if (bridge && typeof bridge.getPendingPdf === 'function') {
      try {
        const pendingJson = bridge.getPendingPdf();
        if (pendingJson) {
          const parsed = JSON.parse(pendingJson);
          processNativePdf(parsed);
        }
      } catch (e) {
        console.warn('[Native Bridge] Error retrieving pending PDF:', e);
      }
    }

    // 2. Register global receiver for runtime / warm start intents
    (window as any).onNativePdfReceived = (data: any) => {
      processNativePdf(data);
    };

    return () => {
      delete (window as any).onNativePdfReceived;
    };
  }, []);

  // Add a newly processed transparent signature centered in the currently visible viewport
  const handleAddSignature = (
    itemData: Omit<SignatureItem, 'id' | 'xPercent' | 'yPercent' | 'pageNumber'>
  ) => {
    if (!pdfState) return;

    const newId = `sig-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const snapshot =
      pendingPlacementSnapshotRef.current ?? viewportSnapshotGetterRef.current?.() ?? null;
    pendingPlacementSnapshotRef.current = null;

    const existingPlacements = [
      ...signatures.map((s) => ({
        pageNumber: s.pageNumber,
        xPercent: s.xPercent,
        yPercent: s.yPercent,
      })),
      ...textOverlays.map((t) => ({
        pageNumber: t.pageNumber,
        xPercent: t.xPercent,
        yPercent: t.yPercent,
      })),
    ];

    const placement = computeSignaturePlacement({
      snapshot,
      fallbackPageNumber: pdfState.currentPage,
      defaultWidthPercent: itemData.widthPercent || 28,
      aspectRatio: itemData.aspectRatio || 2.2,
      existingPlacements,
    });

    const newSignature: SignatureItem = {
      ...itemData,
      id: newId,
      pageNumber: placement.pageNumber,
      xPercent: placement.xPercent,
      yPercent: placement.yPercent,
      widthPercent: placement.widthPercent,
    };

    if (placement.pageNumber !== pdfState.currentPage) {
      setPdfState((prev) => (prev ? { ...prev, currentPage: placement.pageNumber } : prev));
    }

    commitAction(
      {
        signatures: [...signatures, newSignature],
        selectedSignatureId: newId,
        selectedTextId: null,
      },
      'Add Signature',
      placement.pageNumber
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

  // Text Overlay Handlers with Undo/Redo tracking and viewport-centered placement
  const handleAddText = (
    text: string,
    fontFamily: TextFontFamily,
    color: TextColor,
    fontSize: number
  ) => {
    if (!pdfState) return;
    const newId = `txt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const snapshot =
      pendingPlacementSnapshotRef.current ?? viewportSnapshotGetterRef.current?.() ?? null;
    pendingPlacementSnapshotRef.current = null;

    const existingPlacements = [
      ...signatures.map((s) => ({
        pageNumber: s.pageNumber,
        xPercent: s.xPercent,
        yPercent: s.yPercent,
      })),
      ...textOverlays.map((t) => ({
        pageNumber: t.pageNumber,
        xPercent: t.xPercent,
        yPercent: t.yPercent,
      })),
    ];

    const placement = computeTextPlacement({
      snapshot,
      fallbackPageNumber: pdfState.currentPage,
      text,
      fontSize,
      fontFamily,
      defaultWidthPercent: 25,
      existingPlacements,
      basePageWidthPt: pdfState.pageWidth || 595,
      basePageHeightPt: pdfState.pageHeight || 842,
    });

    const newTextItem: TextOverlayItem = {
      id: newId,
      pageNumber: placement.pageNumber,
      text,
      xPercent: placement.xPercent,
      yPercent: placement.yPercent,
      widthPercent: placement.widthPercent,
      fontSize,
      fontFamily,
      color,
    };

    if (placement.pageNumber !== pdfState.currentPage) {
      setPdfState((prev) => (prev ? { ...prev, currentPage: placement.pageNumber } : prev));
    }

    commitAction(
      {
        textOverlays: [...textOverlays, newTextItem],
        selectedTextId: newId,
        selectedSignatureId: null,
      },
      'Add Text',
      placement.pageNumber
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
    const doc = getPageDocument();
    if (doc && pdfState && targetPage !== null) {
      clearThumbnailCache();
      setPdfState(prev => prev ? {
        ...prev, arrayBuffer: doc.arrayBuffer, numPages: doc.numPages,
        currentPage: Math.max(1, Math.min(targetPage || doc.currentPage, doc.numPages)),
        pageWidth: doc.pageWidth, pageHeight: doc.pageHeight,
      } : null);
      setFormFields(doc.formFields);
      setHasPageModifications(doc.arrayBuffer !== originalPdfBufferRef.current);
    }
    if (targetPage !== null) markUnsaved();
  }, [undo, getPageDocument, pdfState, markUnsaved]);

  // Redo action with automatic page navigation
  const handleRedo = useCallback(() => {
    const targetPage = redo();
    const doc = getPageDocument();
    if (doc && pdfState && targetPage !== null) {
      clearThumbnailCache();
      setPdfState(prev => prev ? {
        ...prev, arrayBuffer: doc.arrayBuffer, numPages: doc.numPages,
        currentPage: Math.max(1, Math.min(targetPage || doc.currentPage, doc.numPages)),
        pageWidth: doc.pageWidth, pageHeight: doc.pageHeight,
      } : null);
      setFormFields(doc.formFields);
      setHasPageModifications(doc.arrayBuffer !== originalPdfBufferRef.current);
    }
    if (targetPage !== null) markUnsaved();
  }, [redo, getPageDocument, pdfState, markUnsaved]);

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

  const handleChangePage = useCallback(
    (newPage: number) => {
      setPdfState((prev) => {
        if (!prev) return null;
        const boundedPage = Math.max(1, Math.min(prev.numPages, newPage));
        if (prev.currentPage === boundedPage) return prev;
        return {
          ...prev,
          currentPage: boundedPage,
        };
      });
      setSelectedSignatureId(null);
      setSelectedTextId(null);
    },
    [setSelectedSignatureId, setSelectedTextId]
  );

  const handleClearDocument = () => {
    clearThumbnailCache();
    void disposePdfJsResources().catch((err) => {
      console.warn('PDF resource disposal warning on clear:', err);
    });
    setPdfState(null);
    resetHistory({
      signatures: [],
      textOverlays: [],
      formValues: {},
    });
    setFormFields([]);
    initialFormValuesRef.current = {};
    setHasPageModifications(false);
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

  // Recent Documents Actions (load binary blob on demand from IndexedDB v2)
  const handleSelectRecentDoc = async (record: RecentDocumentRecord) => {
    const buffer = record.pdfBuffer || (await getRecentDocumentBlob(record.id));
    if (!buffer) {
      const msg = `Das Dokument „${record.name}“ konnte nicht aus dem lokalen Speicher geladen werden.`;
      setPdfErrorMessage(msg);
      setActiveAppError(
        createAppError('RECENT_DOC_LOAD_FAILED', 'Verlaufsdokument nicht verfügbar', msg, undefined, {
          docId: record.id,
          name: record.name,
        })
      );
      return;
    }
    const file = new File([buffer], record.name, {
      type: 'application/pdf',
    });
    handleRequestFileSelect(file);
  };

  const handleRemoveRecentDoc = async (id: string) => {
    await removeRecentDocument(id);
    const updated = await getRecentDocuments();
    setRecentDocs(updated);
  };

  const handleClearAllRecentDocs = async () => {
    await clearRecentDocuments();
    setRecentDocs([]);
  };

  const handlePrintRecentDoc = async (record: RecentDocumentRecord) => {
    const buffer = record.pdfBuffer || (await getRecentDocumentBlob(record.id));
    if (!buffer) return;
    await printPdfDocument(record.name, buffer);
  };

  const handleShareRecentDoc = async (record: RecentDocumentRecord) => {
    const buffer = record.pdfBuffer || (await getRecentDocumentBlob(record.id));
    if (!buffer) return;
    await sharePdfDocument(record.name, buffer);
  };

  // Helper to compile current modified document (signatures, text overlays, form values)
  const generateCurrentCompositePdf = async (): Promise<Uint8Array | null> => {
    if (!pdfState || !pdfState.arrayBuffer) return null;
    try {
      // Directly transfer the final document when it contains no pending
      // signatures, text, or form fields. Avoid a costly full re-serialization.
      if (signatures.length === 0 && textOverlays.length === 0 &&
          !isFormModified && formFields.length === 0) {
        return new Uint8Array(pdfState.arrayBuffer);
      }
      return await embedSignaturesIntoPdf(
        pdfState.arrayBuffer,
        signatures,
        textOverlays,
        formValues,
        { flattenForm: true } // flatten for reliable printing / sharing
      );
    } catch (err) {
      console.error('Error generating composite PDF for print/share:', err);
      // Never share or print the original after edited output has failed.
      throw err;
    }
  };

  // Quick Print active document via Android PrintManager / Browser Spooler
  const handleQuickPrint = async () => {
    if (!pdfState) return;
    flushPendingFormCommit();
    setIsQuickProcessing(true);
    try {
      const bytes = await generateCurrentCompositePdf();
      if (bytes) {
        await printPdfDocument(pdfState.name, bytes);
      }
    } catch (err: any) {
      const msg = `Drucken fehlgeschlagen: ${err?.message || 'PDF konnte nicht erzeugt werden.'}`;
      setPdfErrorMessage(msg);
      setActiveAppError(
        createAppError('PDF_EXPORT_FAILED', 'Drucken fehlgeschlagen', msg, err, {
          document: pdfState.name,
        })
      );
    } finally {
      setIsQuickProcessing(false);
    }
  };

  // Quick Share active document via Android Share Sheet / Web Share
  const handleQuickShare = async () => {
    if (!pdfState) return;
    flushPendingFormCommit();
    setIsQuickProcessing(true);
    try {
      const bytes = await generateCurrentCompositePdf();
      if (bytes) {
        await sharePdfDocument(pdfState.name, bytes);
      }
    } catch (err: any) {
      const msg = `Teilen fehlgeschlagen: ${err?.message || 'PDF konnte nicht erzeugt werden.'}`;
      setPdfErrorMessage(msg);
      setActiveAppError(
        createAppError('PDF_EXPORT_FAILED', 'Teilen fehlgeschlagen', msg, err, {
          document: pdfState.name,
        })
      );
    } finally {
      setIsQuickProcessing(false);
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

    // Map annotations to every surviving copy of their source page.
    // Duplicated pages must receive independent overlay IDs.
    const updatedSignatures = newPages.flatMap((spec, idx) => {
      if (spec.source !== 'existing') return [];
      return signatures.filter(s => s.pageNumber === spec.originalPageIndex + 1)
        .map(s => ({
          ...s,
          id: idx + 1 === oldToNewPageMap.get(s.pageNumber)
            ? s.id : `${s.id}-copy-${spec.id}`,
          pageNumber: idx + 1,
        }));
    });

    const updatedTextOverlays = newPages.flatMap((spec, idx) => {
      if (spec.source !== 'existing') return [];
      return textOverlays.filter(t => t.pageNumber === spec.originalPageIndex + 1)
        .map(t => ({
          ...t,
          id: idx + 1 === oldToNewPageMap.get(t.pageNumber)
            ? t.id : `${t.id}-copy-${spec.id}`,
          pageNumber: idx + 1,
        }));
    });

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
        pageDocument: {
          arrayBuffer: newBuffer, numPages, currentPage: nextCurrentPage,
          pageWidth: viewport.width, pageHeight: viewport.height, formFields: updatedFormFields,
        },
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
      {!isReaderMode && (!isMobile || !pdfState) && (
        <Header
          documentName={pdfState?.name || ''}
          hasDocument={!!pdfState}
          signatureCount={signatures.length}
          hasUnsavedChanges={hasUnsavedChanges}
          hasPageModifications={hasPageModifications}
          recentCount={recentDocs.length}
          onOpenSave={() => {
            flushPendingFormCommit();
            setIsSaveModalOpen(true);
          }}
          onOpenPageManager={() => setIsPageManagerOpen(true)}
          onOpenRecent={() => setIsRecentModalOpen(true)}
          onQuickPrint={handleQuickPrint}
          onQuickShare={handleQuickShare}
          onFileSelect={handleRequestFileSelect}
          onCloseDocument={handleRequestCloseDocument}
          onOpenDiagnostics={() => setShowDiagnosticsModal(true)}
        />
      )}



      {/* Error Notification Toast/Banner */}
      {pdfErrorMessage && (
        <div className="shrink-0 bg-red-50 border-b border-red-200 px-4 py-2.5 flex items-center justify-between gap-3 text-red-800 text-xs sm:text-sm animate-in slide-in-from-top duration-150">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{pdfErrorMessage}</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {activeAppError && (
              <button
                type="button"
                onClick={() => setShowDiagnosticsModal(true)}
                className="px-2.5 py-1 rounded-lg bg-red-100 hover:bg-red-200 text-red-900 text-xs font-semibold transition"
              >
                Diagnose
              </button>
            )}
            <button
              onClick={() => {
                setPdfErrorMessage(null);
                setActiveAppError(null);
              }}
              className="p-1 rounded text-red-500 hover:text-red-800 hover:bg-red-100 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Shared PDF Issue Notification Banner */}
      {shareIssueNotice && (
        <div className="shrink-0 bg-amber-50 border-b border-amber-200 px-4 py-3 text-amber-900 text-xs sm:text-sm animate-in slide-in-from-top duration-150">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start sm:items-center gap-2.5">
              <Share2 className="w-5 h-5 text-amber-600 shrink-0 mt-0.5 sm:mt-0" />
              <div>
                <span className="font-semibold">{shareIssueNotice.title}: </span>
                <span>{shareIssueNotice.message}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
              <button
                type="button"
                onClick={() => manualFileInputRef.current?.click()}
                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white font-medium text-xs rounded-lg transition shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                <FileQuestion className="w-3.5 h-3.5" />
                <span>
                  {shareIssueNotice.attemptedFile
                    ? `Pick ${shareIssueNotice.attemptedFile}`
                    : 'Select File Manually'}
                </span>
              </button>
              {shareIssueNotice.details && (
                <button
                  type="button"
                  onClick={() => setShowDiagnosticsModal(true)}
                  className="px-2.5 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-900 text-xs rounded-lg transition font-medium"
                >
                  Diagnostics
                </button>
              )}
              <button
                type="button"
                onClick={() => setShareIssueNotice(null)}
                className="p-1 rounded text-amber-700 hover:text-amber-950 hover:bg-amber-100 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Workspace */}
      <main className="flex-1 min-h-0 flex flex-col relative overflow-hidden">
        {(isLoadingPdf || isReceivingSharedPdf) && (
          <div className="absolute inset-0 z-40 bg-white/85 backdrop-blur-xs flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
            <div className="text-center">
              <p className="text-sm font-semibold text-slate-800">
                {isReceivingSharedPdf && !isLoadingPdf ? 'Receiving Shared PDF...' : 'Opening PDF Document...'}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                {isReceivingSharedPdf && !isLoadingPdf ? 'Transferring file from Android share sheet' : 'Verifying structure and loading CMaps'}
              </p>
            </div>
          </div>
        )}

        {!pdfState ? (
          <EmptyState
            onFileSelect={handleFileSelect}
            recentDocs={recentDocs}
            onSelectRecentDoc={handleSelectRecentDoc}
            onOpenRecentModal={() => setIsRecentModalOpen(true)}
            onPrintRecentDoc={handlePrintRecentDoc}
            onShareRecentDoc={handleShareRecentDoc}
          />
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
            onOpenSignatureModal={() => {
              pendingPlacementSnapshotRef.current = viewportSnapshotGetterRef.current?.() ?? null;
              setIsSignatureModalOpen(true);
            }}
            onOpenTextModal={() => {
              pendingPlacementSnapshotRef.current = viewportSnapshotGetterRef.current?.() ?? null;
              setIsTextModalOpen(true);
            }}
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
            onRegisterViewportSnapshotGetter={handleRegisterViewportSnapshotGetter}
            isMobile={isMobile}
            isSaved={isSaved}
            onBack={handleRequestCloseDocument}
            onQuickPrint={handleQuickPrint}
            onQuickShare={handleQuickShare}
            onOpenFile={() => manualFileInputRef.current?.click()}
            onOpenRecent={() => setIsRecentModalOpen(true)}
            onOpenDiagnostics={() => setShowDiagnosticsModal(true)}
            onControlsVisibilityChange={setIsMobileBottomBarVisible}
          />
        )}
      </main>

      {/* Mobile Bottom Navigation Bar (Visible on phones & Android APK) */}
      {pdfState && isMobile && !isReaderMode && (
        <MobileBottomBar
          pdfState={pdfState}
          signatureCount={signatures.length}
          textCount={textOverlays.length}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={handleUndo}
          onRedo={handleRedo}
          isVisible={isMobileBottomBarVisible}
          onAddSignature={() => {
            pendingPlacementSnapshotRef.current = viewportSnapshotGetterRef.current?.() ?? null;
            setIsSignatureModalOpen(true);
          }}
          onAddText={() => {
            pendingPlacementSnapshotRef.current = viewportSnapshotGetterRef.current?.() ?? null;
            setIsTextModalOpen(true);
          }}
          onOpenPageManager={() => setIsPageManagerOpen(true)}
          onSave={() => {
            flushPendingFormCommit();
            setIsSaveModalOpen(true);
          }}
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
          pdfState={exportOverrideSnapshot?.pdfState || pdfState}
          signatures={exportOverrideSnapshot?.signatures || signatures}
          textOverlays={exportOverrideSnapshot?.textOverlays || textOverlays}
          formValues={formValues}
          hasFormFields={formFields.length > 0}
          isFormModified={isFormModified}
          hasPageModifications={exportOverrideSnapshot ? true : hasPageModifications}
          initialSelectedPages={exportSelectedPages}
          onClose={() => {
            setIsSaveModalOpen(false);
            setExportSelectedPages(null);
            setExportOverrideSnapshot(null);
          }}
          onSaveSuccess={(info) => {
            if (!info?.isSubsetExport && !exportOverrideSnapshot) {
              markCurrentStateSaved();
            }
            getRecentDocuments().then(setRecentDocs).catch(() => {});
          }}
        />
      )}

      {/* Recent Documents History Modal */}
      <RecentDocumentsModal
        isOpen={isRecentModalOpen}
        onClose={() => setIsRecentModalOpen(false)}
        recentDocs={recentDocs}
        currentDocName={pdfState?.name}
        onSelectDoc={handleSelectRecentDoc}
        onRemoveDoc={handleRemoveRecentDoc}
        onClearAll={handleClearAllRecentDocs}
      />

      {/* Page Management Modal: Add, Delete, Reorder, Rotate, Multi-Select, and Export Selected */}
      {pdfState && (
        <PageManagementModal
          isOpen={isPageManagerOpen}
          pdfState={pdfState}
          currentPage={pdfState.currentPage}
          onClose={() => setIsPageManagerOpen(false)}
          onApplyChanges={handleApplyPageModifications}
          onJumpToPage={(pageNum) => handleChangePage(pageNum)}
          onExportSelectedPages={async (selectedPageNumbers, stagedPages) => {
            flushPendingFormCommit();
            if (stagedPages && stagedPages.length > 0) {
              const snapshot = await buildStagedPageExportSnapshot(
                pdfState,
                signatures,
                textOverlays,
                stagedPages
              );
              setExportOverrideSnapshot(snapshot);
            } else {
              setExportOverrideSnapshot(null);
            }
            setExportSelectedPages(selectedPageNumbers);
            setIsSaveModalOpen(true);
          }}
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
          flushPendingFormCommit();
          setIsUnsavedModalOpen(false);
          setIsSaveModalOpen(true);
        }}
      />

      {/* Hidden manual file input for direct fallback */}
      <input
        ref={manualFileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            handleRequestFileSelect(file);
            setShareIssueNotice(null);
          }
          e.target.value = '';
        }}
      />

      {/* Unified App Info & Technical Error Diagnostics Modal */}
      {showDiagnosticsModal && (
        <ErrorDiagnosticsModal
          error={
            activeAppError ||
            (shareIssueNotice
              ? createAppError(
                  'ANDROID_SHARE_FAILED',
                  shareIssueNotice.title || 'Android Share Technical Diagnostic',
                  shareIssueNotice.message || 'PDF konnte nicht über das Share-Target geladen werden.',
                  shareIssueNotice.details,
                  shareIssueNotice.attemptedFile
                    ? { attemptedFile: shareIssueNotice.attemptedFile }
                    : undefined
                )
              : null)
          }
          onClose={() => setShowDiagnosticsModal(false)}
        />
      )}
    </div>
  );
}
