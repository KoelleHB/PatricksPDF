import { useState, useRef, useCallback } from 'react';
import { SignatureItem } from '../types';

export interface HistoryEntry {
  signatures: SignatureItem[];
  selectedId: string | null;
  pageNumber: number;
  action: string;
}

const MAX_HISTORY_LENGTH = 50;

export function useSignatureHistory(initialSignatures: SignatureItem[] = []) {
  // Current state of signatures
  const [signatures, setSignatures] = useState<SignatureItem[]>(initialSignatures);
  const [selectedSignatureId, setSelectedSignatureId] = useState<string | null>(null);

  // History stack
  const [history, setHistory] = useState<HistoryEntry[]>([
    {
      signatures: initialSignatures,
      selectedId: null,
      pageNumber: 1,
      action: 'Initial',
    },
  ]);
  const [historyIndex, setHistoryIndex] = useState<number>(0);

  // Transient notification message for undo/redo actions
  const [historyNotice, setHistoryNotice] = useState<{ message: string; type: 'undo' | 'redo' } | null>(null);
  const noticeTimerRef = useRef<NodeJS.Timeout | null>(null);

  const showNotice = useCallback((message: string, type: 'undo' | 'redo') => {
    if (noticeTimerRef.current) {
      clearTimeout(noticeTimerRef.current);
    }
    setHistoryNotice({ message, type });
    noticeTimerRef.current = setTimeout(() => {
      setHistoryNotice(null);
    }, 1800);
  }, []);

  // Commit a new action to history
  const commitAction = useCallback(
    (
      newSignatures: SignatureItem[],
      action: string,
      pageNumber: number,
      newSelectedId: string | null
    ) => {
      setSignatures(newSignatures);
      setSelectedSignatureId(newSelectedId);

      setHistory((prevHistory) => {
        // Truncate any future redo history beyond current index
        const validHistory = prevHistory.slice(0, historyIndex + 1);
        const newEntry: HistoryEntry = {
          signatures: newSignatures,
          selectedId: newSelectedId,
          pageNumber,
          action,
        };

        const updatedHistory = [...validHistory, newEntry];
        if (updatedHistory.length > MAX_HISTORY_LENGTH) {
          // Keep within max history length
          return updatedHistory.slice(updatedHistory.length - MAX_HISTORY_LENGTH);
        }
        return updatedHistory;
      });

      setHistoryIndex((prevIndex) => Math.min(prevIndex + 1, MAX_HISTORY_LENGTH - 1));
    },
    [historyIndex]
  );

  // Live update during drag/resize without pushing to history stack yet
  const liveUpdate = useCallback((updatedSignatures: SignatureItem[]) => {
    setSignatures(updatedSignatures);
  }, []);

  // Check if undo or redo are available
  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  const undoActionName = canUndo ? history[historyIndex]?.action : null;
  const redoActionName = canRedo ? history[historyIndex + 1]?.action : null;

  // Perform Undo
  const undo = useCallback((): number | null => {
    if (historyIndex <= 0) return null;

    const targetIndex = historyIndex - 1;
    const targetEntry = history[targetIndex];
    const undoneEntry = history[historyIndex];

    setSignatures(targetEntry.signatures);
    setSelectedSignatureId(targetEntry.selectedId);
    setHistoryIndex(targetIndex);

    showNotice(`Undid: ${undoneEntry.action}`, 'undo');

    // Return the page number where the action took place so the viewer can navigate to it if needed
    return undoneEntry.pageNumber || targetEntry.pageNumber;
  }, [historyIndex, history, showNotice]);

  // Perform Redo
  const redo = useCallback((): number | null => {
    if (historyIndex >= history.length - 1) return null;

    const targetIndex = historyIndex + 1;
    const targetEntry = history[targetIndex];

    setSignatures(targetEntry.signatures);
    setSelectedSignatureId(targetEntry.selectedId);
    setHistoryIndex(targetIndex);

    showNotice(`Redid: ${targetEntry.action}`, 'redo');

    return targetEntry.pageNumber;
  }, [historyIndex, history, showNotice]);

  // Reset history (e.g. when loading a new document)
  const resetHistory = useCallback((newInitial: SignatureItem[] = []) => {
    setSignatures(newInitial);
    setSelectedSignatureId(null);
    setHistory([
      {
        signatures: newInitial,
        selectedId: null,
        pageNumber: 1,
        action: 'Initial',
      },
    ]);
    setHistoryIndex(0);
    setHistoryNotice(null);
  }, []);

  return {
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
  };
}
