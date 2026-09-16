// Service Worker script to intercept Web Share Target POST requests with files
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Match /share-target endpoint
  if (event.request.method === 'POST' && (url.pathname === '/share-target' || url.pathname.endsWith('/share-target'))) {
    event.respondWith(
      (async () => {
        try {
          const formData = await event.request.formData();
          let targetFile = null;

          // Check named field first
          const namedField = formData.get('pdfFile');
          if (namedField instanceof File) {
            targetFile = namedField;
          } else {
            // Search all form entries for the first File object
            for (const value of formData.values()) {
              if (value instanceof File) {
                targetFile = value;
                break;
              }
            }
          }

          if (targetFile) {
            const cache = await caches.open('shared-pdf-cache');
            await cache.put(
              new Request('/_shared_pdf_file_'),
              new Response(targetFile, {
                headers: {
                  'content-type': targetFile.type || 'application/pdf',
                  'x-filename': encodeURIComponent(targetFile.name || 'document.pdf'),
                },
              })
            );
          }
        } catch (err) {
          console.error('[SW Share Target] Error saving shared PDF:', err);
        }

        // Redirect with HTTP 303 to reload or open the PWA window with the shared flag
        return Response.redirect('/?shared=true', 303);
      })()
    );
  }
});
