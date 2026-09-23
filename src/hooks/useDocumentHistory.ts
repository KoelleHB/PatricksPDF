import { useState, useRef, useCallback } from 'react';
import { SignatureItem, TextOverlayItem, FormValuesState } from '../types';

export interface DocumentSnapshot {
  signatures: SignatureItem[];
  textOverlays: TextOverlayItem[];
  formValues: FormValuesState;
  selectedSignatureId: string | null;
  selectedTextId: string | null;
}

export interface HistoryEntry {
  snapshot: DocumentSnapshot;
  pageNumber: number;
  action: string;
}

const MAX_HISTORY_LENGTH = 50;

export interface UseDocumentHistoryOptions {
  initialSignatures?: SignatureItem[];
  initialTextOverlays?: TextOverlayItem[];
  initialFormValues?: FormValuesState;
}

export function useDocumentHistory(options: UseDocumentHistoryOptions = {}) {
  // Current live state
  const [signatures, setSignatures] = useState<SignatureItem[]>(options.initialSignatures || []);
  const [textOverlays, setTextOverlays] = useState<TextOverlayItem[]>(options.initialTextOverlays || []);
  const [formValues, setFormValues] = useState<FormValuesState>(options.initialFormValues || {});
  const [selectedSignatureId, setSelectedSignatureId] = useState<string | null>(null);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);

  // Synchronized snapshot ref for race-free commits & debounce flushes
  const stateRef = useRef<DocumentSnapshot>({
    signatures: options.initialSignatures || [],
    textOverlays: options.initialTextOverlays || [],
    formValues: options.initialFormValues || {},
    selectedSignatureId: null,
    selectedTextId: null,
  });

  stateRef.current = {
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

  // History stack
  const [history, setHistory] = useState<HistoryEntry[]>([
    {
      snapshot: {
        signatures: options.initialSignatures || [],
        textOverlays: options.initialTextOverlays || [],
        formValues: options.initialFormValues || {},
        selectedSignatureId: null,
        selectedTextId: null,
      },
      pageNumber: 1,
      action: 'Initial Document',
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

  // Flush any pending form typing commit immediately
  const flushPendingFormCommit = useCallback(() => {
    if (pendingFormDebounceRef.current.timer) {
      clearTimeout(pendingFormDebounceRef.current.timer);
      pendingFormDebounceRef.current.timer = null;
      const fieldName = pendingFormDebounceRef.current.fieldName || 'Field';
      const pageNumber = pendingFormDebounceRef.current.pageNumber || 1;

      const current = { ...stateRef.current };
      setHistory((prev) => {
        const validHistory = prev.slice(0, historyIndex + 1);
        const newEntry: HistoryEntry = {
          snapshot: current,
          pageNumber,
          action: `Fill ${fieldName}`,
        };
        const updated = [...validHistory, newEntry];
        return updated.length > MAX_HISTORY_LENGTH
          ? updated.slice(updated.length - MAX_HISTORY_LENGTH)
          : updated;
      });
      setHistoryIndex((prev) => Math.min(prev + 1, MAX_HISTORY_LENGTH - 1));
    }
  }, [historyIndex]);

  // Commit a new discrete action to history
  const commitAction = useCallback(
    (
      newSnapshot: Partial<DocumentSnapshot>,
      action: string,
      pageNumber: number = 1
    ) => {
      // Clear any pending debounce
      if (pendingFormDebounceRef.current.timer) {
        clearTimeout(pendingFormDebounceRef.current.timer);
        pendingFormDebounceRef.current.timer = null;
      }

      const merged: DocumentSnapshot = {
        signatures: newSnapshot.signatures !== undefined ? newSnapshot.signatures : stateRef.current.signatures,
        textOverlays: newSnapshot.textOverlays !== undefined ? newSnapshot.textOverlays : stateRef.current.textOverlays,
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

      stateRef.current = merged;

      setHistory((prevHistory) => {
        const validHistory = prevHistory.slice(0, historyIndex + 1);
        const newEntry: HistoryEntry = {
          snapshot: merged,
          pageNumber,
          action,
        };
        const updated = [...validHistory, newEntry];
        if (updated.length > MAX_HISTORY_LENGTH) {
          return updated.slice(updated.length - MAX_HISTORY_LENGTH);
        }
        return updated;
      });

      setHistoryIndex((prevIndex) => Math.min(prevIndex + 1, MAX_HISTORY_LENGTH - 1));
    },
    [historyIndex]
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

      // Clear existing debounce timer and restart
      if (pendingFormDebounceRef.current.timer) {
        clearTimeout(pendingFormDebounceRef.current.timer);
      }
      pendingFormDebounceRef.current.fieldName = fieldName;
      pendingFormDebounceRef.current.pageNumber = pageNumber;
      pendingFormDebounceRef.current.timer = setTimeout(() => {
        pendingFormDebounceRef.current.timer = null;
        commitAction({ formValues: stateRef.current.formValues }, `Fill ${fieldName}`, pageNumber);
      }, 450);
    },
    [commitAction]
  );

  // Check if undo or redo are available
  const canUndo = historyIndex > 0 || !!pendingFormDebounceRef.current.timer;
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

    // If there was an uncommitted form typing debounce, flush it first so history has it, then undo rolls it back!
    if (pendingFormDebounceRef.current.timer) {
      clearTimeout(pendingFormDebounceRef.current.timer);
      pendingFormDebounceRef.current.timer = null;
      const fieldName = pendingFormDebounceRef.current.fieldName || 'Field';
      const pageNumber = pendingFormDebounceRef.current.pageNumber || 1;

      const currentSnapshot = { ...stateRef.current };
      const validHistory = history.slice(0, historyIndex + 1);
      const newEntry: HistoryEntry = {
        snapshot: currentSnapshot,
        pageNumber,
        action: `Fill ${fieldName}`,
      };
      currentHistory = [...validHistory, newEntry];
      if (currentHistory.length > MAX_HISTORY_LENGTH) {
        currentHistory = currentHistory.slice(currentHistory.length - MAX_HISTORY_LENGTH);
      }
      currentIdx = Math.min(historyIndex + 1, MAX_HISTORY_LENGTH - 1);
      setHistory(currentHistory);
    }

    if (currentIdx <= 0) return null;

    const targetIndex = currentIdx - 1;
    const targetEntry = currentHistory[targetIndex];
    const undoneEntry = currentHistory[currentIdx];

    setSignatures(targetEntry.snapshot.signatures);
    setTextOverlays(targetEntry.snapshot.textOverlays);
    setFormValues(targetEntry.snapshot.formValues);
    setSelectedSignatureId(targetEntry.snapshot.selectedSignatureId);
    setSelectedTextId(targetEntry.snapshot.selectedTextId);
    stateRef.current = { ...targetEntry.snapshot };

    setHistoryIndex(targetIndex);

    showNotice(`Undid: ${undoneEntry.action}`, 'undo');
    return undoneEntry.pageNumber || targetEntry.pageNumber;
  }, [historyIndex, history, showNotice]);

  // Perform Redo
  const redo = useCallback((): number | null => {
    if (historyIndex >= history.length - 1) return null;

    const targetIndex = historyIndex + 1;
    const targetEntry = history[targetIndex];

    setSignatures(targetEntry.snapshot.signatures);
    setTextOverlays(targetEntry.snapshot.textOverlays);
    setFormValues(targetEntry.snapshot.formValues);
    setSelectedSignatureId(targetEntry.snapshot.selectedSignatureId);
    setSelectedTextId(targetEntry.snapshot.selectedTextId);
    stateRef.current = { ...targetEntry.snapshot };

    setHistoryIndex(targetIndex);

    showNotice(`Redid: ${targetEntry.action}`, 'redo');
    return targetEntry.pageNumber;
  }, [historyIndex, history, showNotice]);

  // Reset history (e.g. on new document)
  const resetHistory = useCallback(
    (initial?: {
      signatures?: SignatureItem[];
      textOverlays?: TextOverlayItem[];
      formValues?: FormValuesState;
    }) => {
      if (pendingFormDebounceRef.current.timer) {
        clearTimeout(pendingFormDebounceRef.current.timer);
        pendingFormDebounceRef.current.timer = null;
      }

      const initialSnapshot: DocumentSnapshot = {
        signatures: initial?.signatures || [],
        textOverlays: initial?.textOverlays || [],
        formValues: initial?.formValues || {},
        selectedSignatureId: null,
        selectedTextId: null,
      };

      setSignatures(initialSnapshot.signatures);
      setTextOverlays(initialSnapshot.textOverlays);
      setFormValues(initialSnapshot.formValues);
      setSelectedSignatureId(null);
      setSelectedTextId(null);
      stateRef.current = initialSnapshot;

      setHistory([
        {
          snapshot: initialSnapshot,
          pageNumber: 1,
          action: 'Initial Document',
        },
      ]);
      setHistoryIndex(0);
      setHistoryNotice(null);
    },
    []
  );

  return {
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
  };
}
