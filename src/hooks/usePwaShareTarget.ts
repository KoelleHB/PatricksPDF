import { useEffect } from 'react';

export type ShareIssueNotice = {
  title: string;
  message: string;
  details?: any;
  attemptedFile?: string;
};

/**
 * PWA Share Target lifecycle. Kept separate from the Android native
 * share intent receiver so each platform retains its own transport.
 */
export function usePwaShareTarget({
  onFile,
  onReceivingState,
  onShareIssue,
}: {
  onFile: (file: File) => void;
  onReceivingState: (receiving: boolean) => void;
  onShareIssue: (notice: ShareIssueNotice | null) => void;
}) {
  // Listen for shared PDF files from Web Share Target (Android native Share Sheet)
  useEffect(() => {
    let isCancelled = false;
    const pollTimeouts: number[] = [];

    // 1. Retrieve from IndexedDB (fastest & most reliable across Android Chromium WebAPKs)
    const getFromIndexedDB = (): Promise<File | null> => {
      return new Promise((resolve) => {
        if (!('indexedDB' in window)) return resolve(null);
        try {
          const request = indexedDB.open('PatricksPDFSharedFilesDB', 2);
          request.onupgradeneeded = (e: any) => {
            const db = e.target?.result;
            if (db && !db.objectStoreNames.contains('shared_files')) {
              db.createObjectStore('shared_files', { keyPath: 'id' });
            }
            if (db && !db.objectStoreNames.contains('share_diagnostics')) {
              db.createObjectStore('share_diagnostics', { keyPath: 'id' });
            }
          };
          request.onsuccess = (e: any) => {
            const db = e.target?.result;
            if (!db || !db.objectStoreNames.contains('shared_files')) {
              db?.close();
              return resolve(null);
            }
            try {
              const tx = db.transaction('shared_files', 'readwrite');
              const store = tx.objectStore('shared_files');
              const getReq = store.get('latest_shared_pdf');

              getReq.onsuccess = () => {
                const record = getReq.result;
                if (record && record.buffer) {
                  store.delete('latest_shared_pdf');
                  tx.oncomplete = () => {
                    db.close();
                    // Consume if fresh (within 30 mins)
                    if (Date.now() - (record.timestamp || 0) < 30 * 60 * 1000) {
                      const blob = new Blob([record.buffer], { type: record.type || 'application/pdf' });
                      const file = new File([blob], record.name || 'shared_document.pdf', {
                        type: record.type || 'application/pdf',
                      });
                      resolve(file);
                    } else {
                      resolve(null);
                    }
                  };
                } else {
                  db.close();
                  resolve(null);
                }
              };
              getReq.onerror = () => {
                db.close();
                resolve(null);
              };
            } catch {
              db.close();
              resolve(null);
            }
          };
          request.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
    };

    // 2. Retrieve from Cache Storage
    const getFromCache = async (): Promise<File | null> => {
      if (!('caches' in window)) return null;
      try {
        const cache = await caches.open('shared-pdf-cache');
        const response = await cache.match('/_shared_pdf_file_');
        if (response) {
          const blob = await response.blob();
          const filename = decodeURIComponent(
            response.headers.get('x-filename') || 'shared_document.pdf'
          );
          await cache.delete('/_shared_pdf_file_');
          return new File([blob], filename, { type: 'application/pdf' });
        }
      } catch (err) {
        console.warn('[PWA Share] Error reading Cache Storage:', err);
      }
      return null;
    };

    // 3. Retrieve diagnostics from IndexedDB
    const getDiagnosticsFromIDB = (): Promise<any> => {
      return new Promise((resolve) => {
        if (!('indexedDB' in window)) return resolve(null);
        try {
          const request = indexedDB.open('PatricksPDFSharedFilesDB', 2);
          request.onsuccess = (e: any) => {
            const db = e.target?.result;
            if (!db || !db.objectStoreNames.contains('share_diagnostics')) {
              db?.close();
              return resolve(null);
            }
            try {
              const tx = db.transaction('share_diagnostics', 'readonly');
              const store = tx.objectStore('share_diagnostics');
              const req = store.get('last_share_attempt');
              req.onsuccess = () => {
                const res = req.result;
                db.close();
                resolve(res || null);
              };
              req.onerror = () => {
                db.close();
                resolve(null);
              };
            } catch {
              db.close();
              resolve(null);
            }
          };
          request.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
    };

    const handleShareFailure = async (reason?: string, attemptedFile?: string) => {
      if (isCancelled) return;
      onReceivingState(false);
      const diag = await getDiagnosticsFromIDB();

      let message = 'Android forwarded data to PatricksPDF, but Chrome did not provide a readable PDF file stream.';
      if (reason === 'timeout_or_empty') {
        message = 'The share request timed out or received an empty form payload from Android Chrome.';
      } else if (reason === 'no_file_found') {
        if (attemptedFile) {
          message = `Android shared "${attemptedFile}", but the app you shared from (e.g. Google Drive or cloud viewer) provided only the title or link instead of binary file bytes. (Tip: In Google Drive, choose "Send a copy" -> "Share" to send full file bytes).`;
        } else {
          message = 'The shared intent contained text, URLs, or metadata, but no binary PDF file stream. (Tip: When sharing from Google Drive or cloud storage, choose "Send a copy" instead of "Share link").';
        }
      }

      onShareIssue({
        title: attemptedFile ? `Shared File: ${attemptedFile}` : 'Shared PDF Transfer Incomplete',
        message,
        details: diag,
        attemptedFile,
      });

      if (window.location.search.includes('shared')) {
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    };

    // Unified fetch attempt
    const retrieveAndOpenSharedFile = async (): Promise<boolean> => {
      if (isCancelled) return false;

      // Try IndexedDB first
      let file = await getFromIndexedDB();

      // If not in IndexedDB, try Cache Storage
      if (!file) {
        file = await getFromCache();
      }

      if (file && !isCancelled) {
        onReceivingState(false);
        onShareIssue(null);
        onFile(file);

        if (window.location.search.includes('shared')) {
          window.history.replaceState({}, document.title, window.location.pathname);
        }
        return true;
      }
      return false;
    };

    const searchParams = new URLSearchParams(window.location.search);
    if (searchParams.get('shared_status') === 'failed') {
      const reason = searchParams.get('reason') || undefined;
      const attemptedFile = searchParams.get('attempted_file') || undefined;
      handleShareFailure(reason, attemptedFile);
      return;
    }

    // Trigger initial check immediately
    retrieveAndOpenSharedFile().then((found) => {
      if (!found) {
        const isSharedParamPresent = window.location.search.includes('shared=true');
        const delays = isSharedParamPresent
          ? [100, 250, 500, 850, 1400, 2200, 3200]
          : [150, 450, 1200];

        delays.forEach((delay, idx) => {
          const tid = window.setTimeout(async () => {
            const ok = await retrieveAndOpenSharedFile();
            if (ok) {
              pollTimeouts.forEach((t) => clearTimeout(t));
            } else if (idx === delays.length - 1) {
              if (isSharedParamPresent) {
                handleShareFailure('no_file_found');
              } else {
                onReceivingState(false);
              }
            }
          }, delay);
          pollTimeouts.push(tid);
        });
      } else {
        onReceivingState(false);
      }
    });

    // Listen for Service Worker postMessage notification
    const handleSwMessage = (event: MessageEvent) => {
      if (event.data?.type === 'SHARED_PDF_AVAILABLE') {
        retrieveAndOpenSharedFile();
      }
    };
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleSwMessage);
    }

    // Re-check when user focuses window or returns to the PWA
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        retrieveAndOpenSharedFile();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleVisibilityChange);

    return () => {
      isCancelled = true;
      pollTimeouts.forEach((t) => clearTimeout(t));
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleSwMessage);
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleVisibilityChange);
    };
  }, []);


}
