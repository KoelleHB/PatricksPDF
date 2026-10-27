import { useState, useRef, useCallback, useMemo } from 'react';
import { SignatureItem, TextOverlayItem, FormValuesState, FormFieldItem } from '../types';

export interface PageDocumentSnapshot {
  arrayBuffer: ArrayBuffer;
  numPages: number;
  currentPage: number;
  pageWidth: number;
  pageHeight: number;
  formFields: FormFieldItem[];
}

export interface DocumentSnapshot {
  pageDocument: PageDocumentSnapshot | null;
  signatures: SignatureItem[];
  textOverlays: TextOverlayItem[];
  formValues: FormValuesState;
  selectedSignatureId: string | null;
  selectedTextId: string | null;
}

/**
 * Compact history entry:
 * Instead of duplicating heavy PageDocumentSnapshot / ArrayBuffer instances per step,
 * each entry references a deduplicated binary revision ID (`docRevisionId`) stored in
 * `docRevisionsRef` and stores lightweight overlay/form statedeltas.
 */
export interface HistoryDeltaOperation {
  type: 'initial' | 'signatures' | 'textOverlays' | 'formValues' | 'pageDocument' | 'composite';
  changedKeys?: string[];
}

export interface HistoryEntry {
  docRevisionId: string | null;
  signatures: SignatureItem[];
  textOverlays: TextOverlayItem[];
  formValues: FormValuesState;
  selectedSignatureId: string | null;
  selectedTextId: string | null;
  delta: HistoryDeltaOperation;
  pageNumber: number;
  action: string;
  stateSignature: string;
}

const MAX_HISTORY_LENGTH = 50;

export interface UseDocumentHistoryOptions {
  initialSignatures?: SignatureItem[];
  initialTextOverlays?: TextOverlayItem[];
  initialFormValues?: FormValuesState;
}

/**
 * Computes a deterministic, fast content signature for the current document state
 * (binary revision ID + signatures + text overlays + form values).
 * Ignores transient UI selection (`selectedSignatureId`, `selectedTextId`) so selecting
 * or deselecting an element never marks the document as unsaved.
 */
export function computeDocumentStateSignature(
  docRevisionId: string | null,
  signatures: SignatureItem[],
  textOverlays: TextOverlayItem[],
  formValues: FormValuesState
): string {
  const sigPart = signatures
    .map(
      (s) =>
        `${s.id}:${s.name || ''}:${s.pngBytes?.byteLength ?? 0}:${s.pageNumber}:${s.xPercent.toFixed(3)}:${s.yPercent.toFixed(3)}:${s.widthPercent.toFixed(3)}:${s.aspectRatio.toFixed(3)}:${(s.opacity ?? 1).toFixed(2)}:${s.rotation ?? 0}`
    )
    .join('|');

  const textPart = textOverlays
    .map(
      (t) =>
        `${t.id}:${t.pageNumber}:${t.xPercent.toFixed(3)}:${t.yPercent.toFixed(3)}:${t.widthPercent.toFixed(3)}:${t.fontSize}:${t.fontFamily}:${t.color}:${t.text}`
    )
    .join('|');

  const formKeys = Object.keys(formValues).sort();
  const formPart = formKeys
    .map((k) => {
      const val = formValues[k];
      if (Array.isArray(val)) return `${k}=[${val.join(',')}]`;
      return `${k}=${String(val ?? '')}`;
    })
    .join('|');

  return `rev:${docRevisionId ?? 'none'}#sig:${sigPart}#txt:${textPart}#frm:${formPart}`;
}

export function useDocumentHistory(options: UseDocumentHistoryOptions = {}) {
  // Deduplicated map of PageDocumentSnapshots keyed by revision ID
  // Prevents ArrayBuffer duplication across history steps and allows GC of unreferenced revisions
  const docRevisionsRef = useRef<Map<string, PageDocumentSnapshot>>(new Map());
  const bufferToRevisionIdRef = useRef<WeakMap<ArrayBuffer, string>>(new WeakMap());
  const revisionCounterRef = useRef<number>(0);

  const registerPageDocument = useCallback((doc: PageDocumentSnapshot | null): string | null => {
    if (!doc) return null;
    let revId = bufferToRevisionIdRef.current.get(doc.arrayBuffer);
    if (!revId) {
      revisionCounterRef.current += 1;
      revId = `docrev_${revisionCounterRef.current}_${doc.arrayBuffer.byteLength}`;
      bufferToRevisionIdRef.current.set(doc.arrayBuffer, revId);
    }
    docRevisionsRef.current.set(revId, doc);
    return revId;
  }, []);

  const pruneUnreferencedRevisions = useCallback(
    (entries: HistoryEntry[], activeRevId: string | null) => {
      const referenced = new Set<string>();
      if (activeRevId) referenced.add(activeRevId);
      for (const entry of entries) {
        if (entry.docRevisionId) referenced.add(entry.docRevisionId);
      }
      for (const key of Array.from(docRevisionsRef.current.keys())) {
        if (!referenced.has(key)) {
          docRevisionsRef.current.delete(key);
        }
      }
    },
    []
  );

  // Current live state
  const pageDocumentRef = useRef<PageDocumentSnapshot | null>(null);
  const currentDocRevisionIdRef = useRef<string | null>(null);
  const [currentDocRevisionId, setCurrentDocRevisionId] = useState<string | null>(null);

  const [signatures, setSignatures] = useState<SignatureItem[]>(options.initialSignatures || []);
  const [textOverlays, setTextOverlays] = useState<TextOverlayItem[]>(options.initialTextOverlays || []);
  const [formValues, setFormValues] = useState<FormValuesState>(options.initialFormValues || {});
  const [selectedSignatureId, setSelectedSignatureId] = useState<string | null>(null);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [hasPendingFormEdit, setHasPendingFormEdit] = useState<boolean>(false);

  const initialSigString = useMemo(
    () =>
      computeDocumentStateSignature(
        null,
        options.initialSignatures || [],
        options.initialTextOverlays || [],
        options.initialFormValues || {}
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Saved state signature: when current state signature matches savedStateSignature, isSaved is true!
  const [savedStateSignature, setSavedStateSignature] = useState<string>(initialSigString);

  // Synchronized snapshot ref for race-free commits & debounce flushes
  const stateRef = useRef<DocumentSnapshot>({
    pageDocument: null,
    signatures: options.initialSignatures || [],
    textOverlays: options.initialTextOverlays || [],
    formValues: options.initialFormValues || {},
    selectedSignatureId: null,
    selectedTextId: null,
  });

  stateRef.current = {
    pageDocument: pageDocumentRef.current,
    signatures,
    textOverlays,
    formValues,
    selectedSignatureId,
    selectedTextId,
  };

  // Pending debounce timer for form field typing
  const pendingFormDebounceRef = useRef<{
    timer: any;
    fieldName: string;
    pageNumber: number;
  }>({
    timer: null,
    fieldName: '',
    pageNumber: 1,
  });

  // Compact History stack
  const [history, setHistory] = useState<HistoryEntry[]>([
    {
      docRevisionId: null,
      signatures: options.initialSignatures || [],
      textOverlays: options.initialTextOverlays || [],
      formValues: options.initialFormValues || {},
      selectedSignatureId: null,
      selectedTextId: null,
      delta: { type: 'initial' },
      pageNumber: 1,
      action: 'Initial Document',
      stateSignature: initialSigString,
    },
  ]);
  const [historyIndex, setHistoryIndex] = useState<number>(0);

  // Transient notification message for undo/redo actions
  const [historyNotice, setHistoryNotice] = useState<{ message: string; type: 'undo' | 'redo' } | null>(null);
  const noticeTimerRef = useRef<any>(null);

  const showNotice = useCallback((message: string, type: 'undo' | 'redo') => {
    if (noticeTimerRef.current) {
      clearTimeout(noticeTimerRef.current);
    }
    setHistoryNotice({ message, type });
    noticeTimerRef.current = setTimeout(() => {
      setHistoryNotice(null);
    }, 1800);
  }, []);

  // Classify delta operation for compact diagnostics & tracking
  const buildDeltaDescriptor = useCallback((partial: Partial<DocumentSnapshot>): HistoryDeltaOperation => {
    const keys: string[] = [];
    if (partial.pageDocument !== undefined) keys.push('pageDocument');
    if (partial.signatures !== undefined) keys.push('signatures');
    if (partial.textOverlays !== undefined) keys.push('textOverlays');
    if (partial.formValues !== undefined) keys.push('formValues');
    if (keys.length === 1) {
      return { type: keys[0] as HistoryDeltaOperation['type'], changedKeys: keys };
    }
    return { type: 'composite', changedKeys: keys };
  }, []);

  // Flush any pending form typing commit immediately
  const flushPendingFormCommit = useCallback(() => {
    if (pendingFormDebounceRef.current.timer) {
      clearTimeout(pendingFormDebounceRef.current.timer);
      pendingFormDebounceRef.current.timer = null;
      setHasPendingFormEdit(false);
      const fieldName = pendingFormDebounceRef.current.fieldName || 'Field';
      const pageNumber = pendingFormDebounceRef.current.pageNumber || 1;

      const current = stateRef.current;
      const revId = registerPageDocument(current.pageDocument);
      currentDocRevisionIdRef.current = revId;
      setCurrentDocRevisionId(revId);
      const sigStr = computeDocumentStateSignature(
        revId,
        current.signatures,
        current.textOverlays,
        current.formValues
      );

      setHistory((prev) => {
        const validHistory = prev.slice(0, historyIndex + 1);
        const newEntry: HistoryEntry = {
          docRevisionId: revId,
          signatures: current.signatures,
          textOverlays: current.textOverlays,
          formValues: current.formValues,
          selectedSignatureId: current.selectedSignatureId,
          selectedTextId: current.selectedTextId,
          delta: { type: 'formValues', changedKeys: [fieldName] },
          pageNumber,
          action: `Fill ${fieldName}`,
          stateSignature: sigStr,
        };
        const updated = [...validHistory, newEntry];
        const sliced =
          updated.length > MAX_HISTORY_LENGTH
            ? updated.slice(updated.length - MAX_HISTORY_LENGTH)
            : updated;
        pruneUnreferencedRevisions(sliced, revId);
        return sliced;
      });
      setHistoryIndex((prev) => Math.min(prev + 1, MAX_HISTORY_LENGTH - 1));
    }
  }, [historyIndex, pruneUnreferencedRevisions, registerPageDocument]);

  // Commit a new discrete action to history
  const commitAction = useCallback(
    (
      newSnapshot: Partial<DocumentSnapshot>,
      action: string,
      pageNumber: number = 1
    ) => {
      if (pendingFormDebounceRef.current.timer) {
        clearTimeout(pendingFormDebounceRef.current.timer);
        pendingFormDebounceRef.current.timer = null;
        setHasPendingFormEdit(false);
      }

      const nextPageDoc =
        newSnapshot.pageDocument !== undefined ? newSnapshot.pageDocument : pageDocumentRef.current;
      const revId = registerPageDocument(nextPageDoc);
      currentDocRevisionIdRef.current = revId;
      setCurrentDocRevisionId(revId);

      const merged: DocumentSnapshot = {
        pageDocument: nextPageDoc,
        signatures: newSnapshot.signatures !== undefined ? newSnapshot.signatures : stateRef.current.signatures,
        textOverlays:
          newSnapshot.textOverlays !== undefined ? newSnapshot.textOverlays : stateRef.current.textOverlays,
        formValues: newSnapshot.formValues !== undefined ? newSnapshot.formValues : stateRef.current.formValues,
        selectedSignatureId:
          newSnapshot.selectedSignatureId !== undefined
            ? newSnapshot.selectedSignatureId
            : stateRef.current.selectedSignatureId,
        selectedTextId:
          newSnapshot.selectedTextId !== undefined ? newSnapshot.selectedTextId : stateRef.current.selectedTextId,
      };

      if (newSnapshot.signatures !== undefined) setSignatures(merged.signatures);
      if (newSnapshot.textOverlays !== undefined) setTextOverlays(merged.textOverlays);
      if (newSnapshot.formValues !== undefined) setFormValues(merged.formValues);
      if (newSnapshot.selectedSignatureId !== undefined) setSelectedSignatureId(merged.selectedSignatureId);
      if (newSnapshot.selectedTextId !== undefined) setSelectedTextId(merged.selectedTextId);

      pageDocumentRef.current = merged.pageDocument;
      stateRef.current = merged;

      const delta = buildDeltaDescriptor(newSnapshot);
      const sigStr = computeDocumentStateSignature(
        revId,
        merged.signatures,
        merged.textOverlays,
        merged.formValues
      );

      setHistory((prevHistory) => {
        const validHistory = prevHistory.slice(0, historyIndex + 1);
        const newEntry: HistoryEntry = {
          docRevisionId: revId,
          signatures: merged.signatures,
          textOverlays: merged.textOverlays,
          formValues: merged.formValues,
          selectedSignatureId: merged.selectedSignatureId,
          selectedTextId: merged.selectedTextId,
          delta,
          pageNumber,
          action,
          stateSignature: sigStr,
        };
        const updated = [...validHistory, newEntry];
        const sliced =
          updated.length > MAX_HISTORY_LENGTH
            ? updated.slice(updated.length - MAX_HISTORY_LENGTH)
            : updated;
        pruneUnreferencedRevisions(sliced, revId);
        return sliced;
      });

      setHistoryIndex((prevIndex) => Math.min(prevIndex + 1, MAX_HISTORY_LENGTH - 1));
    },
    [buildDeltaDescriptor, historyIndex, pruneUnreferencedRevisions, registerPageDocument]
  );

  // Live updates without committing to history stack immediately
  const liveUpdateSignatures = useCallback((updated: SignatureItem[]) => {
    setSignatures(updated);
    stateRef.current.signatures = updated;
  }, []);

  const liveUpdateTextOverlays = useCallback((updated: TextOverlayItem[]) => {
    setTextOverlays(updated);
    stateRef.current.textOverlays = updated;
  }, []);

  const liveUpdateFormValue = useCallback(
    (fieldName: string, value: any, pageNumber: number = 1) => {
      setFormValues((prev) => {
        const next = { ...prev, [fieldName]: value };
        stateRef.current.formValues = next;
        return next;
      });
      setHasPendingFormEdit(true);

      if (pendingFormDebounceRef.current.timer) {
        clearTimeout(pendingFormDebounceRef.current.timer);
      }
      pendingFormDebounceRef.current.fieldName = fieldName;
      pendingFormDebounceRef.current.pageNumber = pageNumber;
      pendingFormDebounceRef.current.timer = setTimeout(() => {
        pendingFormDebounceRef.current.timer = null;
        setHasPendingFormEdit(false);
        commitAction({ formValues: stateRef.current.formValues }, `Fill ${fieldName}`, pageNumber);
      }, 450);
    },
    [commitAction]
  );

  // Check if undo or redo are available
  const canUndo = historyIndex > 0 || !!pendingFormDebounceRef.current.timer || hasPendingFormEdit;
  const canRedo = historyIndex < history.length - 1;

  const undoActionName = canUndo
    ? pendingFormDebounceRef.current.timer
      ? `Fill ${pendingFormDebounceRef.current.fieldName}`
      : history[historyIndex]?.action
    : null;
  const redoActionName = canRedo ? history[historyIndex + 1]?.action : null;

  // Perform Undo
  const undo = useCallback((): number | null => {
    let currentIdx = historyIndex;
    let currentHistory = history;

    if (pendingFormDebounceRef.current.timer) {
      clearTimeout(pendingFormDebounceRef.current.timer);
      pendingFormDebounceRef.current.timer = null;
      setHasPendingFormEdit(false);
      const fieldName = pendingFormDebounceRef.current.fieldName || 'Field';
      const pageNumber = pendingFormDebounceRef.current.pageNumber || 1;

      const currentSnapshot = stateRef.current;
      const revId = registerPageDocument(currentSnapshot.pageDocument);
      const sigStr = computeDocumentStateSignature(
        revId,
        currentSnapshot.signatures,
        currentSnapshot.textOverlays,
        currentSnapshot.formValues
      );
      const validHistory = history.slice(0, historyIndex + 1);
      const newEntry: HistoryEntry = {
        docRevisionId: revId,
        signatures: currentSnapshot.signatures,
        textOverlays: currentSnapshot.textOverlays,
        formValues: currentSnapshot.formValues,
        selectedSignatureId: currentSnapshot.selectedSignatureId,
        selectedTextId: currentSnapshot.selectedTextId,
        delta: { type: 'formValues', changedKeys: [fieldName] },
        pageNumber,
        action: `Fill ${fieldName}`,
        stateSignature: sigStr,
      };
      currentHistory = [...validHistory, newEntry];
      if (currentHistory.length > MAX_HISTORY_LENGTH) {
        currentHistory = currentHistory.slice(currentHistory.length - MAX_HISTORY_LENGTH);
      }
      currentIdx = Math.min(historyIndex + 1, MAX_HISTORY_LENGTH - 1);
      pruneUnreferencedRevisions(currentHistory, revId);
      setHistory(currentHistory);
    }

    if (currentIdx <= 0) return null;

    const targetIndex = currentIdx - 1;
    const targetEntry = currentHistory[targetIndex];
    const undoneEntry = currentHistory[currentIdx];

    const restoredDoc = targetEntry.docRevisionId
      ? docRevisionsRef.current.get(targetEntry.docRevisionId) || null
      : null;

    setSignatures(targetEntry.signatures);
    setTextOverlays(targetEntry.textOverlays);
    setFormValues(targetEntry.formValues);
    setSelectedSignatureId(targetEntry.selectedSignatureId);
    setSelectedTextId(targetEntry.selectedTextId);

    currentDocRevisionIdRef.current = targetEntry.docRevisionId;
    setCurrentDocRevisionId(targetEntry.docRevisionId);
    pageDocumentRef.current = restoredDoc;
    stateRef.current = {
      pageDocument: restoredDoc,
      signatures: targetEntry.signatures,
      textOverlays: targetEntry.textOverlays,
      formValues: targetEntry.formValues,
      selectedSignatureId: targetEntry.selectedSignatureId,
      selectedTextId: targetEntry.selectedTextId,
    };

    setHistoryIndex(targetIndex);

    showNotice(`Undid: ${undoneEntry.action}`, 'undo');
    return undoneEntry.pageNumber || targetEntry.pageNumber;
  }, [historyIndex, history, pruneUnreferencedRevisions, registerPageDocument, showNotice]);

  // Perform Redo
  const redo = useCallback((): number | null => {
    if (historyIndex >= history.length - 1) return null;

    const targetIndex = historyIndex + 1;
    const targetEntry = history[targetIndex];

    const restoredDoc = targetEntry.docRevisionId
      ? docRevisionsRef.current.get(targetEntry.docRevisionId) || null
      : null;

    setSignatures(targetEntry.signatures);
    setTextOverlays(targetEntry.textOverlays);
    setFormValues(targetEntry.formValues);
    setSelectedSignatureId(targetEntry.selectedSignatureId);
    setSelectedTextId(targetEntry.selectedTextId);

    currentDocRevisionIdRef.current = targetEntry.docRevisionId;
    setCurrentDocRevisionId(targetEntry.docRevisionId);
    pageDocumentRef.current = restoredDoc;
    stateRef.current = {
      pageDocument: restoredDoc,
      signatures: targetEntry.signatures,
      textOverlays: targetEntry.textOverlays,
      formValues: targetEntry.formValues,
      selectedSignatureId: targetEntry.selectedSignatureId,
      selectedTextId: targetEntry.selectedTextId,
    };

    setHistoryIndex(targetIndex);

    showNotice(`Redid: ${targetEntry.action}`, 'redo');
    return targetEntry.pageNumber;
  }, [historyIndex, history, showNotice]);

  // Reset history (e.g. on new document or when restoring a saved/unsaved working draft)
  const resetHistory = useCallback(
    (initial?: {
      signatures?: SignatureItem[];
      textOverlays?: TextOverlayItem[];
      formValues?: FormValuesState;
      pageDocument?: PageDocumentSnapshot;
      markAsUnsavedDraft?: boolean;
      baselinePageDocument?: PageDocumentSnapshot;
      baselineFormValues?: FormValuesState;
    }) => {
      if (pendingFormDebounceRef.current.timer) {
        clearTimeout(pendingFormDebounceRef.current.timer);
        pendingFormDebounceRef.current.timer = null;
      }
      setHasPendingFormEdit(false);

      docRevisionsRef.current.clear();
      const pageDoc = initial?.pageDocument || null;
      const revId = registerPageDocument(pageDoc);
      currentDocRevisionIdRef.current = revId;
      setCurrentDocRevisionId(revId);

      const initSignatures = initial?.signatures || [];
      const initTexts = initial?.textOverlays || [];
      const initForms = initial?.formValues || {};

      const initialSnapshot: DocumentSnapshot = {
        pageDocument: pageDoc,
        signatures: initSignatures,
        textOverlays: initTexts,
        formValues: initForms,
        selectedSignatureId: null,
        selectedTextId: null,
      };

      const initSigStr = computeDocumentStateSignature(revId, initSignatures, initTexts, initForms);

      setSignatures(initSignatures);
      setTextOverlays(initTexts);
      setFormValues(initForms);
      setSelectedSignatureId(null);
      setSelectedTextId(null);
      stateRef.current = initialSnapshot;
      pageDocumentRef.current = pageDoc;

      if (initial?.markAsUnsavedDraft) {
        const baselineRevId = initial.baselinePageDocument
          ? registerPageDocument(initial.baselinePageDocument)
          : revId;
        const baselineSigStr = computeDocumentStateSignature(
          baselineRevId,
          [],
          [],
          initial.baselineFormValues || {}
        );
        // Ensure savedStateSignature differs from initSigStr so isSaved is false for unsaved drafts
        setSavedStateSignature(
          baselineSigStr === initSigStr ? `${baselineSigStr}#unsaved_draft` : baselineSigStr
        );
      } else {
        setSavedStateSignature(initSigStr);
      }

      setHistory([
        {
          docRevisionId: revId,
          signatures: initSignatures,
          textOverlays: initTexts,
          formValues: initForms,
          selectedSignatureId: null,
          selectedTextId: null,
          delta: { type: 'initial' },
          pageNumber: pageDoc?.currentPage || 1,
          action: 'Initial Document',
          stateSignature: initSigStr,
        },
      ]);
      setHistoryIndex(0);
      setHistoryNotice(null);
    },
    [registerPageDocument]
  );

  const getPageDocument = useCallback(() => pageDocumentRef.current, []);

  const setPageDocument = useCallback(
    (next: PageDocumentSnapshot) => {
      const revId = registerPageDocument(next);
      currentDocRevisionIdRef.current = revId;
      setCurrentDocRevisionId(revId);
      pageDocumentRef.current = next;
      stateRef.current.pageDocument = next;

      // If we are still on the initial history entry without any edits yet, bind the initial entry
      // and savedStateSignature to this loaded document revision so isSaved remains true.
      setHistory((prev) => {
        if (prev.length === 1 && prev[0].action === 'Initial Document') {
          const updatedSig = computeDocumentStateSignature(
            revId,
            prev[0].signatures,
            prev[0].textOverlays,
            prev[0].formValues
          );
          setSavedStateSignature(updatedSig);
          return [
            {
              ...prev[0],
              docRevisionId: revId,
              stateSignature: updatedSig,
            },
          ];
        }
        return prev;
      });
    },
    [registerPageDocument]
  );

  // Deterministic current state signature
  const currentStateSignature = useMemo(
    () =>
      computeDocumentStateSignature(
        currentDocRevisionId,
        signatures,
        textOverlays,
        formValues
      ),
    [currentDocRevisionId, signatures, textOverlays, formValues]
  );

  const isSaved = !hasPendingFormEdit && currentStateSignature === savedStateSignature;

  const markCurrentStateSaved = useCallback(() => {
    flushPendingFormCommit();
    const sig = computeDocumentStateSignature(
      currentDocRevisionIdRef.current,
      stateRef.current.signatures,
      stateRef.current.textOverlays,
      stateRef.current.formValues
    );
    setSavedStateSignature(sig);
  }, [flushPendingFormCommit]);

  return {
    getPageDocument,
    setPageDocument,
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
    isSaved,
    markCurrentStateSaved,
    currentStateSignature,
  };
}
