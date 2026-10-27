/**
 * Local Document History & Working Draft Manager for PatricksPDF
 * Stores recently opened/edited documents in IndexedDB v3:
 * - `recent_docs_meta`: lightweight metadata, thumbnail & draft status (fast list loading without binary overhead)
 * - `recent_docs_blobs`: raw unmodified original PDF ArrayBuffer loaded on demand when a document is opened or reset
 * - `recent_docs_drafts`: structured editable working draft (signatures, text overlays, form values, optional modifiedPdfBuffer)
 * Also includes a synchronous `localStorage` emergency snapshot (`patricks_pdf_emergency_draft_v1`) flushed on
 * `visibilitychange` (`hidden`) / `pagehide` / `beforeunload` to survive abrupt OS/task-switcher force-closes.
 */
import {
  RecentDocumentRecord,
  DocumentDraftRecord,
  SignatureItem,
  TextOverlayItem,
  FormValuesState,
} from '../types';
import { embedSignaturesIntoPdf } from './pdfExportEngine';

const DB_NAME = 'PatricksPDFRecentDB';
const DB_VERSION = 3;
const LEGACY_STORE_NAME = 'recent_docs';
const META_STORE_NAME = 'recent_docs_meta';
const BLOB_STORE_NAME = 'recent_docs_blobs';
const DRAFTS_STORE_NAME = 'recent_docs_drafts';
const MAX_RECENT_DOCS = 15;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024; // 50 MB cache limit

const FULL_HASH_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const SAMPLE_SLICE_BYTES = 256 * 1024; // 256 KB per slice for >2 MB files

export const EMERGENCY_DRAFT_STORAGE_KEY = 'patricks_pdf_emergency_draft_v1';

// Transparent in-memory fallback store when IndexedDB is unavailable (e.g. restricted webviews or Node test runner)
const memoryMetaStore = new Map<string, RecentDocumentRecord>();
const memoryBlobStore = new Map<string, ArrayBuffer>();
const memoryDraftStore = new Map<string, DocumentDraftRecord>();

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

export function resetRecentDocumentsMemoryStoreForTests(): void {
  memoryMetaStore.clear();
  memoryBlobStore.clear();
  memoryDraftStore.clear();
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!hasIndexedDb()) {
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

      if (!db.objectStoreNames.contains(DRAFTS_STORE_NAME)) {
        db.createObjectStore(DRAFTS_STORE_NAME, { keyPath: 'id' });
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

function uint8ToBase64(bytes: Uint8Array): string {
  if (!bytes || bytes.byteLength === 0) return '';
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.byteLength; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.byteLength));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  if (typeof btoa === 'function') {
    return btoa(binary);
  }
  return Buffer.from(bytes).toString('base64');
}

function base64ToUint8(b64: string): Uint8Array {
  if (!b64) return new Uint8Array(0);
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      out[i] = bin.charCodeAt(i);
    }
    return out;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

function dataUrlToUint8(dataUrl: string): Uint8Array {
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx === -1) return new Uint8Array(0);
  return base64ToUint8(dataUrl.slice(commaIdx + 1));
}

function normalizeSignatureItems(signatures: SignatureItem[]): SignatureItem[] {
  return (signatures || []).map((sig) => {
    let pngBytes: Uint8Array;
    if (sig.pngBytes instanceof Uint8Array && sig.pngBytes.byteLength > 0) {
      pngBytes = new Uint8Array(sig.pngBytes);
    } else if (sig.pngBytes && (sig.pngBytes as any).buffer instanceof ArrayBuffer) {
      pngBytes = new Uint8Array((sig.pngBytes as any).buffer);
    } else if (sig.transparentDataUrl) {
      pngBytes = dataUrlToUint8(sig.transparentDataUrl);
    } else {
      pngBytes = new Uint8Array(0);
    }
    return {
      ...sig,
      pngBytes,
    };
  });
}

/**
 * Saves or updates a document in the local history, storing metadata and binary PDF data in separate stores.
 * Preserves existing draft metadata if the document already has an active working draft.
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
  const cleanBuffer = params.buffer.slice(0);
  const now = Date.now();

  if (!hasIndexedDb()) {
    const existing = memoryMetaStore.get(id);
    const metaRecord: RecentDocumentRecord = {
      id,
      name: params.name,
      fileSize: cleanBuffer.byteLength,
      numPages: existing?.hasWorkingCopy && existing.numPages ? existing.numPages : params.numPages,
      lastOpened: now,
      thumbnailDataUrl: params.thumbnailDataUrl ?? existing?.thumbnailDataUrl,
      signatureCount: params.signatureCount ?? existing?.signatureCount ?? 0,
      textCount: params.textCount ?? existing?.textCount ?? 0,
      formEditCount: existing?.formEditCount ?? 0,
      hasPageModifications: existing?.hasPageModifications ?? false,
      hasDraft: existing?.hasDraft ?? false,
      hasWorkingCopy: existing?.hasWorkingCopy ?? false,
      draftUpdatedAt: existing?.draftUpdatedAt,
      lastPage: existing?.lastPage ?? 1,
    };
    memoryMetaStore.set(id, metaRecord);
    memoryBlobStore.set(id, cleanBuffer);
    return { ...metaRecord, pdfBuffer: cleanBuffer };
  }

  const db = await openDb();

  return new Promise<RecentDocumentRecord>((resolve, reject) => {
    const tx = db.transaction([META_STORE_NAME, BLOB_STORE_NAME], 'readwrite');
    const metaStore = tx.objectStore(META_STORE_NAME);
    const blobStore = tx.objectStore(BLOB_STORE_NAME);

    const getExistingReq = metaStore.get(id);
    let finalMetaRecord: RecentDocumentRecord;

    getExistingReq.onsuccess = () => {
      const existing = getExistingReq.result as RecentDocumentRecord | undefined;
      finalMetaRecord = {
        id,
        name: params.name,
        fileSize: cleanBuffer.byteLength,
        numPages: existing?.hasWorkingCopy && existing.numPages ? existing.numPages : params.numPages,
        lastOpened: now,
        thumbnailDataUrl: params.thumbnailDataUrl ?? existing?.thumbnailDataUrl,
        signatureCount: params.signatureCount ?? existing?.signatureCount ?? 0,
        textCount: params.textCount ?? existing?.textCount ?? 0,
        formEditCount: existing?.formEditCount ?? 0,
        hasPageModifications: existing?.hasPageModifications ?? false,
        hasDraft: existing?.hasDraft ?? false,
        hasWorkingCopy: existing?.hasWorkingCopy ?? false,
        draftUpdatedAt: existing?.draftUpdatedAt,
        lastPage: existing?.lastPage ?? 1,
      };
      metaStore.put(finalMetaRecord);
      blobStore.put({ id, pdfBuffer: cleanBuffer });
    };

    tx.oncomplete = async () => {
      db.close();
      pruneOldDocuments().catch((err) => console.warn('Prune error:', err));
      resolve({ ...(finalMetaRecord! || { id, name: params.name, fileSize: cleanBuffer.byteLength, numPages: params.numPages, lastOpened: now }), pdfBuffer: cleanBuffer });
    };

    tx.onerror = (err) => {
      db.close();
      reject(err);
    };

    tx.onabort = (err) => {
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
  if (!hasIndexedDb()) {
    return Array.from(memoryMetaStore.values()).sort((a, b) => b.lastOpened - a.lastOpened);
  }

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
 * Loads the raw unmodified original PDF binary ArrayBuffer for a single recent document on demand.
 */
export async function getRecentDocumentBlob(id: string): Promise<ArrayBuffer | null> {
  if (!hasIndexedDb()) {
    const buf = memoryBlobStore.get(id);
    return buf ? buf.slice(0) : null;
  }

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
 * Saves or updates a structured working draft for a document in `recent_docs_drafts` and updates `recent_docs_meta`.
 * If all edits have been removed (0 signatures, 0 texts, 0 modified form fields, and no page modifications),
 * any existing draft is automatically cleaned up.
 */
export async function saveDocumentDraft(params: {
  id: string;
  name?: string;
  originalBuffer?: ArrayBuffer | null;
  isUnsavedDraft: boolean;
  currentPage: number;
  numPages?: number;
  hasPageModifications: boolean;
  modifiedPdfBuffer?: ArrayBuffer | null;
  signatures: SignatureItem[];
  textOverlays: TextOverlayItem[];
  formValues: FormValuesState;
  formEditCount?: number;
}): Promise<void> {
  const {
    id,
    name,
    originalBuffer,
    isUnsavedDraft,
    currentPage,
    numPages,
    hasPageModifications,
    modifiedPdfBuffer,
    signatures,
    textOverlays,
    formValues,
    formEditCount = 0,
  } = params;

  const hasAnyWorkingEdits =
    signatures.length > 0 ||
    textOverlays.length > 0 ||
    formEditCount > 0 ||
    hasPageModifications;

  if (!hasAnyWorkingEdits) {
    await discardDocumentDraft(id, numPages);
    return;
  }

  const now = Date.now();
  const normalizedSignatures = normalizeSignatureItems(signatures);
  const draftRecord: DocumentDraftRecord = {
    id,
    updatedAt: now,
    isUnsavedDraft,
    currentPage: Math.max(1, currentPage || 1),
    numPages,
    hasPageModifications,
    modifiedPdfBuffer:
      hasPageModifications && modifiedPdfBuffer && modifiedPdfBuffer.byteLength > 0
        ? modifiedPdfBuffer.slice(0)
        : undefined,
    signatures: normalizedSignatures,
    textOverlays: (textOverlays || []).map((t) => ({ ...t })),
    formValues: { ...(formValues || {}) },
    formEditCount,
  };

  if (!hasIndexedDb()) {
    memoryDraftStore.set(id, draftRecord);
    if (originalBuffer && !memoryBlobStore.has(id)) {
      memoryBlobStore.set(id, originalBuffer.slice(0));
    }
    const existingMeta = memoryMetaStore.get(id);
    if (existingMeta || name) {
      memoryMetaStore.set(id, {
        id,
        name: existingMeta?.name || name || 'Document.pdf',
        fileSize:
          draftRecord.modifiedPdfBuffer?.byteLength ??
          existingMeta?.fileSize ??
          originalBuffer?.byteLength ??
          0,
        numPages: numPages ?? existingMeta?.numPages ?? 1,
        lastOpened: now,
        thumbnailDataUrl: existingMeta?.thumbnailDataUrl,
        signatureCount: normalizedSignatures.length,
        textCount: textOverlays.length,
        formEditCount,
        hasPageModifications,
        hasDraft: isUnsavedDraft,
        hasWorkingCopy: true,
        draftUpdatedAt: now,
        lastPage: draftRecord.currentPage,
      });
    }
    return;
  }

  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const storeNames = [META_STORE_NAME, DRAFTS_STORE_NAME];
      if (originalBuffer) storeNames.push(BLOB_STORE_NAME);
      const tx = db.transaction(storeNames, 'readwrite');
      const metaStore = tx.objectStore(META_STORE_NAME);
      const draftStore = tx.objectStore(DRAFTS_STORE_NAME);

      draftStore.put(draftRecord);

      if (originalBuffer) {
        const blobStore = tx.objectStore(BLOB_STORE_NAME);
        const checkBlobReq = blobStore.get(id);
        checkBlobReq.onsuccess = () => {
          if (!checkBlobReq.result) {
            blobStore.put({ id, pdfBuffer: originalBuffer.slice(0) });
          }
        };
      }

      const metaReq = metaStore.get(id);
      metaReq.onsuccess = () => {
        const existingMeta = metaReq.result as RecentDocumentRecord | undefined;
        if (existingMeta || name) {
          const updatedMeta: RecentDocumentRecord = {
            id,
            name: existingMeta?.name || name || 'Document.pdf',
            fileSize:
              draftRecord.modifiedPdfBuffer?.byteLength ??
              existingMeta?.fileSize ??
              originalBuffer?.byteLength ??
              0,
            numPages: numPages ?? existingMeta?.numPages ?? 1,
            lastOpened: now,
            thumbnailDataUrl: existingMeta?.thumbnailDataUrl,
            signatureCount: normalizedSignatures.length,
            textCount: textOverlays.length,
            formEditCount,
            hasPageModifications,
            hasDraft: isUnsavedDraft,
            hasWorkingCopy: true,
            draftUpdatedAt: now,
            lastPage: draftRecord.currentPage,
          };
          metaStore.put(updatedMeta);
        }
      };

      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = (err) => {
        db.close();
        reject(err);
      };
      tx.onabort = (err) => {
        db.close();
        reject(err);
      };
    });
  } catch (err) {
    console.warn('Could not save document draft to IndexedDB:', err);
  }
}

/**
 * Loads the working draft for a document from `recent_docs_drafts`, if present.
 */
export async function getDocumentDraft(id: string): Promise<DocumentDraftRecord | null> {
  if (!hasIndexedDb()) {
    const draft = memoryDraftStore.get(id);
    if (!draft) return null;
    return {
      ...draft,
      modifiedPdfBuffer: draft.modifiedPdfBuffer ? draft.modifiedPdfBuffer.slice(0) : undefined,
      signatures: normalizeSignatureItems(draft.signatures),
      textOverlays: draft.textOverlays.map((t) => ({ ...t })),
      formValues: { ...draft.formValues },
    };
  }

  try {
    const db = await openDb();
    return new Promise((resolve) => {
      if (!db.objectStoreNames.contains(DRAFTS_STORE_NAME)) {
        db.close();
        resolve(null);
        return;
      }
      const tx = db.transaction(DRAFTS_STORE_NAME, 'readonly');
      const store = tx.objectStore(DRAFTS_STORE_NAME);
      const req = store.get(id);

      req.onsuccess = () => {
        const res = req.result as DocumentDraftRecord | undefined;
        db.close();
        if (!res) {
          resolve(null);
          return;
        }
        resolve({
          ...res,
          modifiedPdfBuffer: res.modifiedPdfBuffer ? res.modifiedPdfBuffer.slice(0) : undefined,
          signatures: normalizeSignatureItems(res.signatures || []),
          textOverlays: (res.textOverlays || []).map((t) => ({ ...t })),
          formValues: { ...(res.formValues || {}) },
        });
      };

      req.onerror = () => {
        db.close();
        resolve(null);
      };
    });
  } catch (err) {
    console.warn('Could not load document draft:', err);
    return null;
  }
}

/**
 * Clears the "Unsaved Draft" status after the user explicitly exports/saves the PDF via SaveModal,
 * while keeping all signatures, text overlays, and form fields editable for future sessions.
 */
export async function markDocumentDraftSaved(id: string): Promise<void> {
  clearEmergencyDraftFromLocalStorage(id);

  if (!hasIndexedDb()) {
    const draft = memoryDraftStore.get(id);
    if (draft) {
      memoryDraftStore.set(id, { ...draft, isUnsavedDraft: false });
    }
    const meta = memoryMetaStore.get(id);
    if (meta) {
      memoryMetaStore.set(id, { ...meta, hasDraft: false });
    }
    return;
  }

  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const storeNames = [META_STORE_NAME];
      if (db.objectStoreNames.contains(DRAFTS_STORE_NAME)) {
        storeNames.push(DRAFTS_STORE_NAME);
      }
      const tx = db.transaction(storeNames, 'readwrite');
      const metaStore = tx.objectStore(META_STORE_NAME);

      const metaReq = metaStore.get(id);
      metaReq.onsuccess = () => {
        const existing = metaReq.result as RecentDocumentRecord | undefined;
        if (existing) {
          metaStore.put({
            ...existing,
            hasDraft: false,
          });
        }
      };

      if (storeNames.includes(DRAFTS_STORE_NAME)) {
        const draftStore = tx.objectStore(DRAFTS_STORE_NAME);
        const draftReq = draftStore.get(id);
        draftReq.onsuccess = () => {
          const existingDraft = draftReq.result as DocumentDraftRecord | undefined;
          if (existingDraft) {
            draftStore.put({
              ...existingDraft,
              isUnsavedDraft: false,
            });
          }
        };
      }

      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
      tx.onabort = () => {
        db.close();
        resolve();
      };
    });
  } catch (err) {
    console.warn('Could not mark document draft as saved:', err);
  }
}

/**
 * Discards the working draft for a document and resets its metadata in `recent_docs_meta`
 * back to the clean original PDF state.
 */
export async function discardDocumentDraft(id: string, originalNumPages?: number): Promise<void> {
  clearEmergencyDraftFromLocalStorage(id);

  if (!hasIndexedDb()) {
    memoryDraftStore.delete(id);
    const meta = memoryMetaStore.get(id);
    const origBlob = memoryBlobStore.get(id);
    if (meta) {
      memoryMetaStore.set(id, {
        ...meta,
        fileSize: origBlob?.byteLength ?? meta.fileSize,
        numPages: originalNumPages ?? meta.numPages,
        signatureCount: 0,
        textCount: 0,
        formEditCount: 0,
        hasPageModifications: false,
        hasDraft: false,
        hasWorkingCopy: false,
        draftUpdatedAt: undefined,
        lastPage: 1,
      });
    }
    return;
  }

  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const storeNames = [META_STORE_NAME, BLOB_STORE_NAME];
      if (db.objectStoreNames.contains(DRAFTS_STORE_NAME)) {
        storeNames.push(DRAFTS_STORE_NAME);
      }
      const tx = db.transaction(storeNames, 'readwrite');
      const metaStore = tx.objectStore(META_STORE_NAME);
      const blobStore = tx.objectStore(BLOB_STORE_NAME);

      if (storeNames.includes(DRAFTS_STORE_NAME)) {
        tx.objectStore(DRAFTS_STORE_NAME).delete(id);
      }

      const blobReq = blobStore.get(id);
      const metaReq = metaStore.get(id);

      metaReq.onsuccess = () => {
        const existing = metaReq.result as RecentDocumentRecord | undefined;
        if (existing) {
          const origSize = (blobReq.result as { pdfBuffer?: ArrayBuffer } | undefined)?.pdfBuffer?.byteLength;
          metaStore.put({
            ...existing,
            fileSize: origSize ?? existing.fileSize,
            numPages: originalNumPages ?? existing.numPages,
            signatureCount: 0,
            textCount: 0,
            formEditCount: 0,
            hasPageModifications: false,
            hasDraft: false,
            hasWorkingCopy: false,
            draftUpdatedAt: undefined,
            lastPage: 1,
          });
        }
      };

      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
      tx.onabort = () => {
        db.close();
        resolve();
      };
    });
  } catch (err) {
    console.warn('Could not discard document draft:', err);
  }
}

interface SerializedEmergencySignature extends Omit<SignatureItem, 'pngBytes'> {
  pngBytesBase64: string;
}

interface SerializedEmergencyDraft {
  id: string;
  name?: string;
  updatedAt: number;
  isUnsavedDraft: boolean;
  currentPage: number;
  numPages?: number;
  hasPageModifications: boolean;
  formEditCount: number;
  signatures: SerializedEmergencySignature[];
  textOverlays: TextOverlayItem[];
  formValues: FormValuesState;
}

/**
 * Synchronously writes a lightweight emergency backup of the current draft overlays to `localStorage`.
 * Used on `visibilitychange` (`hidden`), `pagehide`, and `beforeunload` so that even if Android or the
 * browser terminates the process before an async IndexedDB transaction finishes, no overlay edits are lost.
 */
export function writeEmergencyDraftToLocalStorage(params: {
  id: string;
  name?: string;
  isUnsavedDraft: boolean;
  currentPage: number;
  numPages?: number;
  hasPageModifications: boolean;
  signatures: SignatureItem[];
  textOverlays: TextOverlayItem[];
  formValues: FormValuesState;
  formEditCount?: number;
}): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    const formEditCount = params.formEditCount ?? 0;
    const hasAnyEdits =
      params.signatures.length > 0 ||
      params.textOverlays.length > 0 ||
      formEditCount > 0 ||
      params.hasPageModifications;

    if (!hasAnyEdits) {
      clearEmergencyDraftFromLocalStorage(params.id);
      return false;
    }

    const payload: SerializedEmergencyDraft = {
      id: params.id,
      name: params.name,
      updatedAt: Date.now(),
      isUnsavedDraft: params.isUnsavedDraft,
      currentPage: params.currentPage || 1,
      numPages: params.numPages,
      hasPageModifications: params.hasPageModifications,
      formEditCount,
      signatures: params.signatures.map((s) => ({
        id: s.id,
        name: s.name,
        transparentDataUrl: s.transparentDataUrl,
        originalDataUrl: s.originalDataUrl,
        pngBytesBase64: uint8ToBase64(s.pngBytes),
        pageNumber: s.pageNumber,
        xPercent: s.xPercent,
        yPercent: s.yPercent,
        widthPercent: s.widthPercent,
        aspectRatio: s.aspectRatio,
        opacity: s.opacity,
        rotation: s.rotation,
      })),
      textOverlays: params.textOverlays,
      formValues: params.formValues,
    };

    localStorage.setItem(EMERGENCY_DRAFT_STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function clearEmergencyDraftFromLocalStorage(id?: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (!id) {
      localStorage.removeItem(EMERGENCY_DRAFT_STORAGE_KEY);
      return;
    }
    const raw = localStorage.getItem(EMERGENCY_DRAFT_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { id?: string };
    if (parsed?.id === id) {
      localStorage.removeItem(EMERGENCY_DRAFT_STORAGE_KEY);
    }
  } catch {
    // Ignore storage access errors
  }
}

/**
 * Reconciles any emergency draft stored in `localStorage` into IndexedDB on app launch
 * if the emergency snapshot is newer than the persisted IndexedDB draft.
 */
export async function reconcileEmergencyDraftFromLocalStorage(): Promise<boolean> {
  try {
    if (typeof localStorage === 'undefined') return false;
    const raw = localStorage.getItem(EMERGENCY_DRAFT_STORAGE_KEY);
    if (!raw) return false;

    const emergency = JSON.parse(raw) as SerializedEmergencyDraft;
    if (!emergency || !emergency.id) {
      localStorage.removeItem(EMERGENCY_DRAFT_STORAGE_KEY);
      return false;
    }

    const existingDraft = await getDocumentDraft(emergency.id);
    if (existingDraft && existingDraft.updatedAt >= emergency.updatedAt) {
      localStorage.removeItem(EMERGENCY_DRAFT_STORAGE_KEY);
      return false;
    }

    const restoredSignatures: SignatureItem[] = (emergency.signatures || []).map((s) => {
      const pngBytes = s.pngBytesBase64
        ? base64ToUint8(s.pngBytesBase64)
        : dataUrlToUint8(s.transparentDataUrl || '');
      return {
        id: s.id,
        name: s.name,
        transparentDataUrl: s.transparentDataUrl,
        originalDataUrl: s.originalDataUrl,
        pngBytes,
        pageNumber: s.pageNumber,
        xPercent: s.xPercent,
        yPercent: s.yPercent,
        widthPercent: s.widthPercent,
        aspectRatio: s.aspectRatio,
        opacity: s.opacity,
        rotation: s.rotation,
      };
    });

    await saveDocumentDraft({
      id: emergency.id,
      name: emergency.name,
      isUnsavedDraft: emergency.isUnsavedDraft,
      currentPage: emergency.currentPage,
      numPages: emergency.numPages,
      hasPageModifications: emergency.hasPageModifications || Boolean(existingDraft?.hasPageModifications),
      modifiedPdfBuffer: existingDraft?.modifiedPdfBuffer,
      signatures: restoredSignatures,
      textOverlays: emergency.textOverlays || [],
      formValues: emergency.formValues || {},
      formEditCount: emergency.formEditCount ?? 0,
    });

    localStorage.removeItem(EMERGENCY_DRAFT_STORAGE_KEY);
    return true;
  } catch (err) {
    console.warn('Could not reconcile emergency draft from localStorage:', err);
    return false;
  }
}

/**
 * Compiles the exportable PDF bytes for a recent document.
 * If the document has a working draft/copy, embeds its signatures, text overlays, and form values
 * into `draft.modifiedPdfBuffer || baseBuffer` so Print & Share from Recent Documents include all edits.
 */
export async function compileRecentDocumentPdfBytes(
  doc: RecentDocumentRecord
): Promise<ArrayBuffer | Uint8Array | null> {
  const baseBuffer = doc.pdfBuffer || (await getRecentDocumentBlob(doc.id));
  const draft = await getDocumentDraft(doc.id);
  const workingBuffer = draft?.modifiedPdfBuffer || baseBuffer;
  if (!workingBuffer) return null;

  if (
    draft &&
    (draft.signatures.length > 0 ||
      draft.textOverlays.length > 0 ||
      (draft.formEditCount ?? 0) > 0 ||
      Object.keys(draft.formValues || {}).length > 0)
  ) {
    try {
      return await embedSignaturesIntoPdf(
        workingBuffer,
        draft.signatures,
        draft.textOverlays,
        draft.formValues,
        { flattenForm: true }
      );
    } catch (err) {
      console.warn('Could not embed draft overlays for recent document quick action:', err);
      return workingBuffer;
    }
  }

  return workingBuffer;
}

/**
 * Removes a single document (metadata, binary blob, and working draft) from history.
 */
export async function removeRecentDocument(id: string): Promise<void> {
  clearEmergencyDraftFromLocalStorage(id);

  if (!hasIndexedDb()) {
    memoryMetaStore.delete(id);
    memoryBlobStore.delete(id);
    memoryDraftStore.delete(id);
    return;
  }

  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const storeNames = [META_STORE_NAME, BLOB_STORE_NAME];
      if (db.objectStoreNames.contains(DRAFTS_STORE_NAME)) {
        storeNames.push(DRAFTS_STORE_NAME);
      }
      const tx = db.transaction(storeNames, 'readwrite');
      tx.objectStore(META_STORE_NAME).delete(id);
      tx.objectStore(BLOB_STORE_NAME).delete(id);
      if (storeNames.includes(DRAFTS_STORE_NAME)) {
        tx.objectStore(DRAFTS_STORE_NAME).delete(id);
      }

      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = (err) => {
        db.close();
        reject(err);
      };
      tx.onabort = (err) => {
        db.close();
        reject(err);
      };
    });
  } catch (err) {
    console.warn('Could not remove recent document:', err);
  }
}

/**
 * Clears all recent documents (metadata, binary blobs, and working drafts) from history.
 */
export async function clearRecentDocuments(): Promise<void> {
  clearEmergencyDraftFromLocalStorage();

  if (!hasIndexedDb()) {
    memoryMetaStore.clear();
    memoryBlobStore.clear();
    memoryDraftStore.clear();
    return;
  }

  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const storeNames = [META_STORE_NAME, BLOB_STORE_NAME];
      if (db.objectStoreNames.contains(DRAFTS_STORE_NAME)) {
        storeNames.push(DRAFTS_STORE_NAME);
      }
      const tx = db.transaction(storeNames, 'readwrite');
      tx.objectStore(META_STORE_NAME).clear();
      tx.objectStore(BLOB_STORE_NAME).clear();
      if (storeNames.includes(DRAFTS_STORE_NAME)) {
        tx.objectStore(DRAFTS_STORE_NAME).clear();
      }

      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = (err) => {
        db.close();
        reject(err);
      };
      tx.onabort = (err) => {
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
  if (!hasIndexedDb()) return;
  const docs = await getRecentDocuments();
  if (docs.length <= MAX_RECENT_DOCS) {
    const totalBytes = docs.reduce((acc, d) => acc + d.fileSize, 0);
    if (totalBytes <= MAX_TOTAL_BYTES) return;
  }

  const db = await openDb();
  const storeNames = [META_STORE_NAME, BLOB_STORE_NAME];
  if (db.objectStoreNames.contains(DRAFTS_STORE_NAME)) {
    storeNames.push(DRAFTS_STORE_NAME);
  }
  const tx = db.transaction(storeNames, 'readwrite');
  const metaStore = tx.objectStore(META_STORE_NAME);
  const blobStore = tx.objectStore(BLOB_STORE_NAME);
  const draftStore = storeNames.includes(DRAFTS_STORE_NAME) ? tx.objectStore(DRAFTS_STORE_NAME) : null;

  let currentBytes = 0;
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    currentBytes += doc.fileSize;
    if (i >= MAX_RECENT_DOCS || currentBytes > MAX_TOTAL_BYTES) {
      metaStore.delete(doc.id);
      blobStore.delete(doc.id);
      draftStore?.delete(doc.id);
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
    tx.onabort = () => {
      db.close();
      resolve();
    };
  });
}

/**
 * Formats a timestamp into friendly English relative time ("Just now", "5 min ago", "Today", "Yesterday", etc.)
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  if (diffHours < 24) {
    const date = new Date(timestamp);
    const today = new Date();
    if (date.getDate() === today.getDate()) {
      return `Today, ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
    return `${diffHours} hr ago`;
  }
  if (diffDays === 1) {
    const date = new Date(timestamp);
    return `Yesterday, ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  if (diffDays < 7) return `${diffDays} days ago`;

  return new Date(timestamp).toLocaleDateString('en-US', {
    day: '2-digit',
    month: 'short',
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

/**
 * Builds a concise human-readable summary of edits in a recent document or draft.
 */
export function formatDraftEditSummary(doc: RecentDocumentRecord): string {
  const parts: string[] = [];
  if (doc.signatureCount && doc.signatureCount > 0) {
    parts.push(`${doc.signatureCount} ${doc.signatureCount === 1 ? 'signature' : 'signatures'}`);
  }
  if (doc.textCount && doc.textCount > 0) {
    parts.push(`${doc.textCount} ${doc.textCount === 1 ? 'text' : 'texts'}`);
  }
  if (doc.formEditCount && doc.formEditCount > 0) {
    parts.push(`${doc.formEditCount} ${doc.formEditCount === 1 ? 'field' : 'fields'}`);
  }
  if (doc.hasPageModifications) {
    parts.push('page edits');
  }
  if (parts.length === 0 && (doc.hasDraft || doc.hasWorkingCopy)) {
    parts.push('edited');
  }
  return parts.join(' · ');
}
