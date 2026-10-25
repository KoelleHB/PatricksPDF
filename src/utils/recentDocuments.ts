/**
 * Local Document History Manager for PatricksPDF
 * Stores recently opened/edited documents in IndexedDB v2:
 * - `recent_docs_meta`: lightweight metadata & thumbnail (fast list loading without binary overhead)
 * - `recent_docs_blobs`: raw PDF ArrayBuffer loaded on demand when a document is opened
 * Also uses SHA-256 content fingerprinting to prevent collisions between distinct PDFs of identical name/size.
 */
import { RecentDocumentRecord } from '../types';

const DB_NAME = 'PatricksPDFRecentDB';
const DB_VERSION = 2;
const LEGACY_STORE_NAME = 'recent_docs';
const META_STORE_NAME = 'recent_docs_meta';
const BLOB_STORE_NAME = 'recent_docs_blobs';
const MAX_RECENT_DOCS = 15;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024; // 50 MB cache limit

const FULL_HASH_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const SAMPLE_SLICE_BYTES = 256 * 1024; // 256 KB per slice for >2 MB files

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB is not available in this browser environment.'));
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const tx = (event.target as IDBOpenDBRequest).transaction;

      let metaStore: IDBObjectStore;
      if (!db.objectStoreNames.contains(META_STORE_NAME)) {
        metaStore = db.createObjectStore(META_STORE_NAME, { keyPath: 'id' });
        metaStore.createIndex('lastOpened', 'lastOpened', { unique: false });
      } else {
        metaStore = tx!.objectStore(META_STORE_NAME);
      }

      let blobStore: IDBObjectStore;
      if (!db.objectStoreNames.contains(BLOB_STORE_NAME)) {
        blobStore = db.createObjectStore(BLOB_STORE_NAME, { keyPath: 'id' });
      } else {
        blobStore = tx!.objectStore(BLOB_STORE_NAME);
      }

      // Migrate v1 records from 'recent_docs' into split stores if upgrading from v1
      if (tx && db.objectStoreNames.contains(LEGACY_STORE_NAME)) {
        try {
          const legacyStore = tx.objectStore(LEGACY_STORE_NAME);
          const getAllReq = legacyStore.getAll();
          getAllReq.onsuccess = () => {
            const legacyRecords = (getAllReq.result || []) as RecentDocumentRecord[];
            for (const rec of legacyRecords) {
              const { pdfBuffer, ...metaOnly } = rec;
              metaStore.put(metaOnly);
              if (pdfBuffer) {
                blobStore.put({ id: rec.id, pdfBuffer });
              }
            }
            try {
              db.deleteObjectStore(LEGACY_STORE_NAME);
            } catch {
              // Ignore if deletion during async callback is disallowed in some engines
            }
          };
        } catch {
          // Ignore legacy migration failure
        }
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
 * Legacy helper kept for backward compatibility.
 */
export function generateDocId(name: string, byteLength: number): string {
  const cleanName = name.replace(/\s+/g, '_').toLowerCase();
  return `doc_${cleanName}_${byteLength}`;
}

/**
 * Computes a collision-resistant content fingerprint for a PDF buffer.
 * - For files <= 2 MB: full SHA-256 digest via Web Crypto API.
 * - For files > 2 MB: SHA-256 over deterministic head/middle/tail 256 KB slices + file byteLength.
 * - Fallback: 64-bit FNV-1a style hash if crypto.subtle is unavailable.
 */
export async function computePdfFingerprint(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;

  let sampleBuffer: Uint8Array;
  if (len <= FULL_HASH_MAX_BYTES) {
    sampleBuffer = bytes;
  } else {
    const midOffset = Math.floor(len / 2) - Math.floor(SAMPLE_SLICE_BYTES / 2);
    const tailOffset = len - SAMPLE_SLICE_BYTES;
    sampleBuffer = new Uint8Array(SAMPLE_SLICE_BYTES * 3 + 8);
    sampleBuffer.set(bytes.subarray(0, SAMPLE_SLICE_BYTES), 0);
    sampleBuffer.set(bytes.subarray(midOffset, midOffset + SAMPLE_SLICE_BYTES), SAMPLE_SLICE_BYTES);
    sampleBuffer.set(bytes.subarray(tailOffset, len), SAMPLE_SLICE_BYTES * 2);
    const view = new DataView(sampleBuffer.buffer);
    view.setUint32(SAMPLE_SLICE_BYTES * 3, Math.floor(len / 0x100000000), false);
    view.setUint32(SAMPLE_SLICE_BYTES * 3 + 4, len >>> 0, false);
  }

  try {
    if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
      const hashBuffer = await crypto.subtle.digest('SHA-256', sampleBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hex = hashArray
        .slice(0, 16)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      return `doc_${hex}_${len}`;
    }
  } catch {
    // Fall through to deterministic synchronous hash
  }

  // Deterministic fallback hash
  let h1 = 0xdeadbeef ^ len;
  let h2 = 0x41c6ce57 ^ len;
  const step = Math.max(1, Math.floor(sampleBuffer.length / 4096));
  for (let i = 0; i < sampleBuffer.length; i += step) {
    const ch = sampleBuffer[i];
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `doc_${hex1}${hex2}_${len}`;
}

/**
 * Saves or updates a document in the local history, storing metadata and binary PDF data in separate stores.
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
  const id = params.id || (await computePdfFingerprint(params.buffer));
  const db = await openDb();
  const cleanBuffer = params.buffer.slice(0);

  const metaRecord: RecentDocumentRecord = {
    id,
    name: params.name,
    fileSize: cleanBuffer.byteLength,
    numPages: params.numPages,
    lastOpened: Date.now(),
    thumbnailDataUrl: params.thumbnailDataUrl,
    signatureCount: params.signatureCount ?? 0,
    textCount: params.textCount ?? 0,
  };

  return new Promise<RecentDocumentRecord>((resolve, reject) => {
    const tx = db.transaction([META_STORE_NAME, BLOB_STORE_NAME], 'readwrite');
    const metaStore = tx.objectStore(META_STORE_NAME);
    const blobStore = tx.objectStore(BLOB_STORE_NAME);

    metaStore.put(metaRecord);
    blobStore.put({ id, pdfBuffer: cleanBuffer });

    tx.oncomplete = async () => {
      db.close();
      pruneOldDocuments().catch((err) => console.warn('Prune error:', err));
      resolve({ ...metaRecord, pdfBuffer: cleanBuffer });
    };

    tx.onerror = (err) => {
      db.close();
      reject(err);
    };
  });
}

/**
 * Retrieves all recent document metadata records sorted by lastOpened descending (newest first).
 * Does NOT load the heavy binary PDF blobs into memory.
 */
export async function getRecentDocuments(): Promise<RecentDocumentRecord[]> {
  try {
    const db = await openDb();
    return new Promise((resolve) => {
      const tx = db.transaction(META_STORE_NAME, 'readonly');
      const store = tx.objectStore(META_STORE_NAME);
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
 * Loads the raw PDF binary ArrayBuffer for a single recent document on demand.
 */
export async function getRecentDocumentBlob(id: string): Promise<ArrayBuffer | null> {
  try {
    const db = await openDb();
    return new Promise((resolve) => {
      const storeNames = [BLOB_STORE_NAME];
      if (db.objectStoreNames.contains(META_STORE_NAME)) {
        storeNames.push(META_STORE_NAME);
      }
      const tx = db.transaction(storeNames, 'readonly');
      const blobStore = tx.objectStore(BLOB_STORE_NAME);
      const req = blobStore.get(id);

      req.onsuccess = () => {
        const entry = req.result as { id: string; pdfBuffer?: ArrayBuffer } | undefined;
        if (entry?.pdfBuffer && entry.pdfBuffer.byteLength > 0) {
          db.close();
          resolve(entry.pdfBuffer.slice(0));
          return;
        }
        // Fallback if a legacy record stored pdfBuffer directly inside meta
        if (storeNames.includes(META_STORE_NAME)) {
          const metaReq = tx.objectStore(META_STORE_NAME).get(id);
          metaReq.onsuccess = () => {
            const meta = metaReq.result as RecentDocumentRecord | undefined;
            db.close();
            resolve(meta?.pdfBuffer ? meta.pdfBuffer.slice(0) : null);
          };
          metaReq.onerror = () => {
            db.close();
            resolve(null);
          };
        } else {
          db.close();
          resolve(null);
        }
      };

      req.onerror = () => {
        db.close();
        resolve(null);
      };
    });
  } catch (err) {
    console.warn('Could not load recent document blob:', err);
    return null;
  }
}

/**
 * Removes a single document (both metadata and binary blob) from history.
 */
export async function removeRecentDocument(id: string): Promise<void> {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([META_STORE_NAME, BLOB_STORE_NAME], 'readwrite');
      tx.objectStore(META_STORE_NAME).delete(id);
      tx.objectStore(BLOB_STORE_NAME).delete(id);

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
 * Clears all recent documents (both metadata and binary blobs) from history.
 */
export async function clearRecentDocuments(): Promise<void> {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([META_STORE_NAME, BLOB_STORE_NAME], 'readwrite');
      tx.objectStore(META_STORE_NAME).clear();
      tx.objectStore(BLOB_STORE_NAME).clear();

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
    const totalBytes = docs.reduce((acc, d) => acc + d.fileSize, 0);
    if (totalBytes <= MAX_TOTAL_BYTES) return;
  }

  const db = await openDb();
  const tx = db.transaction([META_STORE_NAME, BLOB_STORE_NAME], 'readwrite');
  const metaStore = tx.objectStore(META_STORE_NAME);
  const blobStore = tx.objectStore(BLOB_STORE_NAME);

  let currentBytes = 0;
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    currentBytes += doc.fileSize;
    if (i >= MAX_RECENT_DOCS || currentBytes > MAX_TOTAL_BYTES) {
      metaStore.delete(doc.id);
      blobStore.delete(doc.id);
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
 * Formats a timestamp into friendly German relative time ("Gerade eben", "Vor 5 Min.", "Heute", "Gestern", etc.)
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
