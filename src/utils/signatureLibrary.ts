export interface SavedSignatureTemplate {
  id: string;
  label: string;
  transparentDataUrl: string;
  pngBytes: ArrayBuffer;
  aspectRatio: number;
  createdAt: number;
}

const DB_NAME = 'PatricksPDFSignaturesDB';
const DB_VERSION = 1;
const STORE_NAME = 'signatures';
const MAX_TEMPLATES = 25;

function openSignatureDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this environment.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getSavedSignatures(): Promise<SavedSignatureTemplate[]> {
  try {
    const db = await openSignatureDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => {
        const items = (request.result as SavedSignatureTemplate[]) || [];
        items.sort((a, b) => b.createdAt - a.createdAt);
        resolve(items);
      };
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
      tx.onerror = () => db.close();
      tx.onabort = () => db.close();
    });
  } catch {
    return [];
  }
}

export async function saveSignatureTemplate(input: {
  label: string;
  transparentDataUrl: string;
  pngBytes: ArrayBuffer;
  aspectRatio: number;
}): Promise<SavedSignatureTemplate> {
  const db = await openSignatureDB();
  const clonedBuffer = input.pngBytes.slice(0);

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getAllReq = store.getAll();
    let savedRecord: SavedSignatureTemplate | null = null;

    getAllReq.onsuccess = () => {
      const existing = ((getAllReq.result as SavedSignatureTemplate[]) || []).sort(
        (a, b) => b.createdAt - a.createdAt
      );
      const cleanLabel = input.label.trim() || `Signature ${existing.length + 1}`;
      savedRecord = {
        id: `sig-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        label: cleanLabel,
        transparentDataUrl: input.transparentDataUrl,
        pngBytes: clonedBuffer,
        aspectRatio: input.aspectRatio,
        createdAt: Date.now(),
      };

      // Keep within MAX_TEMPLATES by pruning oldest if necessary
      if (existing.length >= MAX_TEMPLATES) {
        const toRemove = existing.slice(MAX_TEMPLATES - 1);
        for (const oldItem of toRemove) {
          store.delete(oldItem.id);
        }
      }

      store.put(savedRecord);
    };

    tx.oncomplete = () => {
      db.close();
      if (savedRecord) {
        resolve(savedRecord);
      } else {
        reject(new Error('Could not create signature template.'));
      }
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error('Failed to save signature template.'));
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error || new Error('Transaction aborted.'));
    };
  });
}

export async function renameSignatureTemplate(id: string, newLabel: string): Promise<void> {
  const trimmed = newLabel.trim();
  if (!trimmed) return;
  const db = await openSignatureDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const existing = getReq.result as SavedSignatureTemplate | undefined;
      if (existing) {
        existing.label = trimmed;
        store.put(existing);
      }
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function deleteSignatureTemplate(id: string): Promise<void> {
  const db = await openSignatureDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}
