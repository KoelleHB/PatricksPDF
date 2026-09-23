/**
 * Local Document History Manager for PatricksPDF
 * Stores recently opened/edited documents in IndexedDB for 100% offline, privacy-first access.
 */
import { RecentDocumentRecord } from '../types';

const DB_NAME = 'PatricksPDFRecentDB';
const DB_VERSION = 1;
const STORE_NAME = 'recent_docs';
const MAX_RECENT_DOCS = 15;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024; // 50 MB cache limit

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB is not available in this browser environment.'));
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event: any) => {
      const db = event.target?.result as IDBDatabase;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('lastOpened', 'lastOpened', { unique: false });
      }
    };

    request.onsuccess = (event: any) => {
      resolve(event.target.result);
    };

    request.onerror = (event: any) => {
      reject(event.target.error || new Error('Failed to open recent documents database.'));
    };
  });
}

/**
 * Creates a unique reproducible ID for a document based on its name and size.
 */
export function generateDocId(name: string, byteLength: number): string {
  const cleanName = name.replace(/\s+/g, '_').toLowerCase();
  return `doc_${cleanName}_${byteLength}`;
}

/**
 * Saves or updates a document in the local history.
 */
export async function saveRecentDocument(params: {
  id?: string;
  name: string;
  buffer: ArrayBuffer;
  numPages: number;
  thumbnailDataUrl?: string;
  signatureCount?: number;
  textCount?: number;
}): Promise<RecentDocumentRecord> {
  const db = await openDb();
  const id = params.id || generateDocId(params.name, params.buffer.byteLength);

  const record: RecentDocumentRecord = {
    id,
    name: params.name,
    fileSize: params.buffer.byteLength,
    numPages: params.numPages,
    lastOpened: Date.now(),
    thumbnailDataUrl: params.thumbnailDataUrl,
    pdfBuffer: params.buffer.slice(0), // Clean defensive copy
    signatureCount: params.signatureCount ?? 0,
    textCount: params.textCount ?? 0,
  };

  return new Promise<RecentDocumentRecord>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    store.put(record);

    tx.oncomplete = async () => {
      db.close();
      // Background prune to maintain performance & storage quota
      pruneOldDocuments().catch((err) => console.warn('Prune error:', err));
      resolve(record);
    };

    tx.onerror = (err) => {
      db.close();
      reject(err);
    };
  });
}

/**
 * Retrieves all recent documents sorted by lastOpened descending (newest first).
 */
export async function getRecentDocuments(): Promise<RecentDocumentRecord[]> {
  try {
    const db = await openDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const results: RecentDocumentRecord[] = (request.result || []).sort(
          (a, b) => b.lastOpened - a.lastOpened
        );
        db.close();
        resolve(results);
      };

      request.onerror = () => {
        db.close();
        resolve([]);
      };
    });
  } catch (err) {
    console.warn('Could not load recent documents:', err);
    return [];
  }
}

/**
 * Removes a single document from history.
 */
export async function removeRecentDocument(id: string): Promise<void> {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(id);

      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = (err) => {
        db.close();
        reject(err);
      };
    });
  } catch (err) {
    console.warn('Could not remove recent document:', err);
  }
}

/**
 * Clears all recent documents from history.
 */
export async function clearRecentDocuments(): Promise<void> {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.clear();

      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = (err) => {
        db.close();
        reject(err);
      };
    });
  } catch (err) {
    console.warn('Could not clear recent documents:', err);
  }
}

/**
 * Automatically prunes older documents to respect max count and storage constraints.
 */
async function pruneOldDocuments(): Promise<void> {
  const docs = await getRecentDocuments();
  if (docs.length <= MAX_RECENT_DOCS) {
    let totalBytes = docs.reduce((acc, d) => acc + d.fileSize, 0);
    if (totalBytes <= MAX_TOTAL_BYTES) return;
  }

  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);

  let currentBytes = 0;
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    currentBytes += doc.fileSize;
    // If over item limit or total byte limit, remove older entries
    if (i >= MAX_RECENT_DOCS || currentBytes > MAX_TOTAL_BYTES) {
      store.delete(doc.id);
    }
  }

  return new Promise((resolve) => {
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      resolve();
    };
  });
}

/**
 * Formats a timestamp into friendly German relative time ("Gerade eben", "Vor 5 Minuten", "Heute", "Gestern", etc.)
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMinutes < 1) return 'Gerade eben';
  if (diffMinutes < 60) return `Vor ${diffMinutes} Min.`;
  if (diffHours < 24) {
    const date = new Date(timestamp);
    const today = new Date();
    if (date.getDate() === today.getDate()) {
      return `Heute, ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
    return `Vor ${diffHours} Std.`;
  }
  if (diffDays === 1) {
    const date = new Date(timestamp);
    return `Gestern, ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  if (diffDays < 7) return `Vor ${diffDays} Tagen`;

  return new Date(timestamp).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/**
 * Formats bytes into human-readable string (e.g. "450 KB" or "2.3 MB")
 */
export function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 KB';
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
