// Service Worker script to intercept Web Share Target POST requests with files
// Handles Android native share sheet file forwarding via WebAPK

function storeInIndexedDB(arrayBuffer, fileName, mimeType) {
  return new Promise((resolve, reject) => {
    try {
      const request = indexedDB.open('PatricksPDFSharedFilesDB', 1);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('shared_files')) {
          db.createObjectStore('shared_files', { keyPath: 'id' });
        }
      };
      request.onsuccess = (e) => {
        const db = e.target.result;
        try {
          const tx = db.transaction('shared_files', 'readwrite');
          const store = tx.objectStore('shared_files');
          store.put({
            id: 'latest_shared_pdf',
            buffer: arrayBuffer,
            name: fileName,
            type: mimeType,
            timestamp: Date.now(),
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        } catch (txErr) {
          db.close();
          reject(txErr);
        }
      };
      request.onerror = () => reject(request.error);
    } catch (err) {
      reject(err);
    }
  });
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Match /share-target POST endpoint
  if (
    event.request.method === 'POST' &&
    (url.pathname === '/share-target' || url.pathname.endsWith('/share-target'))
  ) {
    event.respondWith(
      (async () => {
        const redirectUrl = new URL('/?shared=true', self.location.origin).href;

        try {
          const formData = await event.request.formData();
          let targetItem = null;
          let targetFileName = 'shared_document.pdf';

          // 1. First inspect all entries to find any Blob/File-like binary data
          for (const [key, value] of formData.entries()) {
            if (
              value &&
              typeof value === 'object' &&
              typeof value.size === 'number' &&
              value.size > 0 &&
              (typeof value.slice === 'function' || typeof value.arrayBuffer === 'function')
            ) {
              targetItem = value;
              if (value.name && typeof value.name === 'string') {
                targetFileName = value.name;
              }
              break;
            }
          }

          // 2. Fallback to named parameter checks if not caught in loop
          if (!targetItem) {
            const named =
              formData.get('pdfFile') ||
              formData.get('files') ||
              formData.get('file');
            if (
              named &&
              typeof named === 'object' &&
              typeof named.size === 'number' &&
              named.size > 0
            ) {
              targetItem = named;
              if (named.name) targetFileName = named.name;
            }
          }

          // 3. Check title or text parameter if filename has no .pdf extension
          const titleParam = formData.get('title') || formData.get('text');
          if (titleParam && typeof titleParam === 'string' && titleParam.trim()) {
            const cleanTitle = titleParam.trim().replace(/[\\/:*?"<>|]/g, '_');
            if (cleanTitle.toLowerCase().endsWith('.pdf')) {
              targetFileName = cleanTitle;
            } else if (!targetFileName || targetFileName === 'shared_document.pdf') {
              targetFileName = cleanTitle + '.pdf';
            }
          }

          if (targetItem) {
            const arrayBuffer = await targetItem.arrayBuffer();
            const mimeType = targetItem.type || 'application/pdf';

            // Store in Cache Storage
            try {
              const cache = await caches.open('shared-pdf-cache');
              const cacheResponse = new Response(arrayBuffer, {
                headers: {
                  'content-type': mimeType,
                  'x-filename': encodeURIComponent(targetFileName),
                  'x-timestamp': String(Date.now()),
                },
              });
              await cache.put(new Request('/_shared_pdf_file_'), cacheResponse);
            } catch (cacheErr) {
              console.error('[SW Share Target] Cache put error:', cacheErr);
            }

            // Also store in IndexedDB as a reliable secondary bridge
            try {
              await storeInIndexedDB(arrayBuffer, targetFileName, mimeType);
            } catch (idbErr) {
              console.error('[SW Share Target] IndexedDB store error:', idbErr);
            }

            // Notify any active window clients if the PWA is already open
            try {
              const windowClients = await self.clients.matchAll({
                type: 'window',
                includeUncontrolled: true,
              });
              for (const client of windowClients) {
                client.postMessage({
                  type: 'SHARED_PDF_AVAILABLE',
                  filename: targetFileName,
                });
                if ('focus' in client) {
                  client.focus();
                }
              }
            } catch (clientErr) {
              console.warn('[SW Share Target] Client notify error:', clientErr);
            }
          } else {
            console.warn('[SW Share Target] No binary file item found in formData');
          }
        } catch (err) {
          console.error('[SW Share Target] Error processing shared PDF request:', err);
        }

        // Redirect with HTTP 303 to reload or open the PWA window with the shared flag
        return Response.redirect(redirectUrl, 303);
      })()
    );
  }
});
