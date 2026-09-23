// Service Worker script to intercept Web Share Target POST requests with files
// Handles Android native share sheet file forwarding via WebAPK


function timeoutPromise(promise, ms, defaultVal) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(defaultVal), ms)),
  ]);
}


function openDB() {
  return new Promise((resolve, reject) => {
    try {
      const request = indexedDB.open('PatricksPDFSharedFilesDB', 2);


      request.onupgradeneeded = (e) => {
        const db = e.target.result;


        if (!db.objectStoreNames.contains('shared_files')) {
          db.createObjectStore('shared_files', { keyPath: 'id' });
        }


        if (!db.objectStoreNames.contains('share_diagnostics')) {
          db.createObjectStore('share_diagnostics', { keyPath: 'id' });
        }
      };


      request.onsuccess = (e) => resolve(e.target.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('IndexedDB blocked'));
    } catch (err) {
      reject(err);
    }
  });
}


async function storeInIndexedDB(arrayBuffer, fileName, mimeType) {
  const db = await timeoutPromise(openDB(), 1500, null);


  if (!db) return false;


  return new Promise((resolve) => {
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
        resolve(true);
      };


      tx.onerror = () => {
        db.close();
        resolve(false);
      };
    } catch {
      db.close();
      resolve(false);
    }
  });
}


async function saveDiagnosticLog(diagnosticData) {
  try {
    const db = await timeoutPromise(openDB(), 1000, null);


    if (!db) return;


    const tx = db.transaction('share_diagnostics', 'readwrite');
    const store = tx.objectStore('share_diagnostics');


    store.put({
      id: 'last_share_attempt',
      timestamp: Date.now(),
      ...diagnosticData,
    });


    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
  } catch (err) {
    console.warn(
      '[SW Share Target] Diagnostic write error:',
      err
    );
  }
}


self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);


  // Match /share-target POST endpoint
  if (
    event.request.method === 'POST' &&
    (
      url.pathname === '/share-target' ||
      url.pathname.endsWith('/share-target')
    )
  ) {
    event.respondWith(
      (async () => {
        let redirectUrl =
          new URL(
            '/?shared_status=failed&reason=unknown',
            self.location.origin
          ).href;


        const entriesSummary = [];


        try {
          /*
           * Read the multipart/form-data request.
           *
           * We deliberately keep the timeout because Android Chrome/WebAPK
           * may otherwise leave the request hanging indefinitely.
           */
          const formData = await timeoutPromise(
            event.request.formData(),
            4000,
            null
          );


          if (!formData) {
            await saveDiagnosticLog({
              status: 'failed',
              reason: 'formData_timeout_or_empty',


              request: {
                method: event.request.method,
                url: event.request.url,
                contentType:
                  event.request.headers.get('content-type'),
                contentLength:
                  event.request.headers.get('content-length'),
              },
            });


            redirectUrl =
              new URL(
                '/?shared_status=failed&reason=timeout_or_empty',
                self.location.origin
              ).href;


            return Response.redirect(redirectUrl, 303);
          }


          /*
           * ================================================================
           * DETAILED SHARE REQUEST DIAGNOSTICS
           * ================================================================
           *
           * This is the important new diagnostic section.
           *
           * We inspect EVERY FormData entry and record whether it is:
           *
           *   - a File
           *   - a Blob
           *   - a normal string
           *
           * For a correctly forwarded PDF we expect something like:
           *
           *   pdfFile -> file -> filename.pdf -> application/pdf -> size
           *
           * If Android's native file manager only forwards metadata,
           * we may instead see:
           *
           *   title -> string -> filename.pdf
           *
           * with NO binary file entry.
           */


          const requestDiagnostics = {
            method: event.request.method,


            url: event.request.url,


            contentType:
              event.request.headers.get('content-type'),


            contentLength:
              event.request.headers.get('content-length'),


            entries: [],
          };


          /*
           * Inspect every FormData entry.
           */
          for (const [key, value] of formData.entries()) {
            const isObject =
              value &&
              typeof value === 'object';


            const isBinaryLike =
              isObject &&
              typeof value.size === 'number' &&
              typeof value.arrayBuffer === 'function';


            if (isBinaryLike) {
              const entry = {
                key,


                type:
                  typeof File !== 'undefined' &&
                  value instanceof File
                    ? 'file'
                    : 'blob',


                name:
                  typeof value.name === 'string'
                    ? value.name
                    : undefined,


                mime:
                  typeof value.type === 'string'
                    ? value.type
                    : undefined,


                size: value.size,


                lastModified:
                  typeof value.lastModified === 'number'
                    ? value.lastModified
                    : undefined,
              };


              requestDiagnostics.entries.push(entry);
            } else {
              requestDiagnostics.entries.push({
                key,


                type: 'string',


                preview:
                  String(value).slice(0, 200),
              });
            }
          }


          /*
           * Explicitly inspect the manifest-defined field:
           *
           *     name: "pdfFile"
           *
           * This gives us an unambiguous answer whether Android actually
           * supplied the expected file field.
           */


          const pdfFile = formData.get('pdfFile');


          const pdfFileDiagnostic =
            pdfFile &&
            typeof pdfFile === 'object' &&
            typeof pdfFile.size === 'number' &&
            typeof pdfFile.arrayBuffer === 'function'
              ? {
                  present: true,


                  type:
                    typeof File !== 'undefined' &&
                    pdfFile instanceof File
                      ? 'file'
                      : 'blob',


                  name:
                    typeof pdfFile.name === 'string'
                      ? pdfFile.name
                      : undefined,


                  mime:
                    typeof pdfFile.type === 'string'
                      ? pdfFile.type
                      : undefined,


                  size: pdfFile.size,


                  lastModified:
                    typeof pdfFile.lastModified === 'number'
                      ? pdfFile.lastModified
                      : undefined,
                }
              : {
                  present: false,


                  receivedType:
                    pdfFile === null
                      ? 'null'
                      : typeof pdfFile,


                  receivedValue:
                    typeof pdfFile === 'string'
                      ? pdfFile.slice(0, 200)
                      : undefined,
                };


          requestDiagnostics.pdfFile =
            pdfFileDiagnostic;


          /*
           * Store the complete request diagnostics.
           */
          await saveDiagnosticLog({
            status: 'received',


            request: {
              method:
                requestDiagnostics.method,


              url:
                requestDiagnostics.url,


              contentType:
                requestDiagnostics.contentType,


              contentLength:
                requestDiagnostics.contentLength,
            },


            entries:
              requestDiagnostics.entries,


            pdfFile:
              requestDiagnostics.pdfFile,
          });


          let targetItem = null;
          let targetFileName = 'shared_document.pdf';


          /*
           * ================================================================
           * FIND THE ACTUAL BINARY FILE
           * ================================================================
           */


          /*
           * 1. Inspect all FormData entries.
           */
          for (const [key, value] of formData.entries()) {
            const isObj =
              value &&
              typeof value === 'object';


            entriesSummary.push({
              key,


              type:
                typeof File !== 'undefined' &&
                value instanceof File
                  ? 'file'
                  : isObj
                    ? 'object'
                    : 'string',


              size:
                isObj &&
                typeof value.size === 'number'
                  ? value.size
                  : undefined,


              name:
                isObj &&
                typeof value.name === 'string'
                  ? value.name
                  : undefined,


              mime:
                isObj &&
                typeof value.type === 'string'
                  ? value.type
                  : undefined,


              preview:
                typeof value === 'string'
                  ? value.slice(0, 80)
                  : undefined,
            });


            if (
              !targetItem &&
              isObj &&
              typeof value.size === 'number' &&
              value.size > 0 &&
              (
                typeof value.slice === 'function' ||
                typeof value.arrayBuffer === 'function'
              )
            ) {
              targetItem = value;


              if (
                value.name &&
                typeof value.name === 'string'
              ) {
                targetFileName = value.name;
              }
            }
          }


          /*
           * 2. Fallback to named parameter checks.
           */
          if (!targetItem) {
            const namedCandidates = [
              'pdfFile',
              'file',
              'files',
              'document',
              'pdf',
              'attachment',
            ];


            for (const name of namedCandidates) {
              const named = formData.get(name);


              if (
                named &&
                typeof named === 'object' &&
                typeof named.size === 'number' &&
                named.size > 0
              ) {
                targetItem = named;


                if (named.name) {
                  targetFileName = named.name;
                }


                break;
              }
            }
          }


          /*
           * 3. Check title/text for a filename.
           */
          const titleParam =
            formData.get('title') ||
            formData.get('text');


          if (
            titleParam &&
            typeof titleParam === 'string' &&
            titleParam.trim()
          ) {
            const cleanTitle =
              titleParam
                .trim()
                .replace(/[\\/:*?"<>|]/g, '_');


            if (
              cleanTitle
                .toLowerCase()
                .endsWith('.pdf')
            ) {
              targetFileName = cleanTitle;
            } else if (
              !targetFileName ||
              targetFileName ===
                'shared_document.pdf'
            ) {
              targetFileName =
                cleanTitle + '.pdf';
            }
          }


          /*
           * 4. If no binary file was supplied but a URL was,
           *    try downloading the URL.
           */
          const potentialUrl =
            formData.get('url') ||
            (
              typeof formData.get('text') === 'string' &&
              formData.get('text').startsWith('http')
                ? formData.get('text').trim()
                : null
            );


          if (
            !targetItem &&
            potentialUrl &&
            typeof potentialUrl === 'string'
          ) {
            try {
              const fetchRes =
                await timeoutPromise(
                  fetch(potentialUrl),
                  3500,
                  null
                );


              if (
                fetchRes &&
                fetchRes.ok
              ) {
                const fetchedBlob =
                  await fetchRes.blob();


                if (
                  fetchedBlob &&
                  fetchedBlob.size > 0
                ) {
                  targetItem = fetchedBlob;


                  try {
                    const urlPath =
                      new URL(
                        potentialUrl
                      ).pathname;


                    const lastSegment =
                      urlPath
                        .split('/')
                        .pop();


                    if (
                      lastSegment &&
                      lastSegment
                        .toLowerCase()
                        .endsWith('.pdf')
                    ) {
                      targetFileName =
                        decodeURIComponent(
                          lastSegment
                        );
                    }
                  } catch {
                    // Ignore invalid URL/path parsing.
                  }
                }
              }
            } catch (fetchErr) {
              console.warn(
                '[SW Share Target] URL fetch attempt error:',
                fetchErr
              );
            }
          }


          /*
           * ================================================================
           * SUCCESS: BINARY FILE FOUND
           * ================================================================
           */


          if (targetItem) {
            const arrayBuffer =
              await targetItem.arrayBuffer();


            const mimeType =
              targetItem.type ||
              'application/pdf';


            /*
             * Store in Cache Storage.
             */
            try {
              const cache =
                await caches.open(
                  'shared-pdf-cache'
                );


              const cacheResponse =
                new Response(
                  arrayBuffer,
                  {
                    headers: {
                      'content-type':
                        mimeType,


                      'x-filename':
                        encodeURIComponent(
                          targetFileName
                        ),


                      'x-timestamp':
                        String(Date.now()),
                    },
                  }
                );


              await cache.put(
                new Request(
                  '/_shared_pdf_file_'
                ),
                cacheResponse
              );
            } catch (cacheErr) {
              console.error(
                '[SW Share Target] Cache put error:',
                cacheErr
              );
            }


            /*
             * Also store in IndexedDB as a reliable
             * secondary bridge.
             */
            try {
              await storeInIndexedDB(
                arrayBuffer,
                targetFileName,
                mimeType
              );
            } catch (idbErr) {
              console.error(
                '[SW Share Target] IndexedDB store error:',
                idbErr
              );
            }


            /*
             * Save success diagnostic.
             */
            await saveDiagnosticLog({
              status: 'success',


              filename:
                targetFileName,


              size:
                arrayBuffer.byteLength,


              mimeType,


              request: {
                method:
                  requestDiagnostics.method,


                url:
                  requestDiagnostics.url,


                contentType:
                  requestDiagnostics.contentType,


                contentLength:
                  requestDiagnostics.contentLength,
              },


              entries:
                requestDiagnostics.entries,


              pdfFile:
                requestDiagnostics.pdfFile,


              entriesSummary,
            });


            /*
             * Notify active PWA windows.
             */
            try {
              const windowClients =
                await self.clients.matchAll({
                  type: 'window',
                  includeUncontrolled: true,
                });


              for (
                const client of windowClients
              ) {
                client.postMessage({
                  type:
                    'SHARED_PDF_AVAILABLE',


                  filename:
                    targetFileName,
                });


                if ('focus' in client) {
                  client.focus();
                }
              }
            } catch (clientErr) {
              console.warn(
                '[SW Share Target] Client notify error:',
                clientErr
              );
            }


            /*
             * Redirect back into the PWA.
             */
            redirectUrl =
              new URL(
                `/?shared=true&t=${Date.now()}`,
                self.location.origin
              ).href;
          }


          /*
           * ================================================================
           * FAILURE: NO BINARY FILE
           * ================================================================
           */


          else {
            console.warn(
              '[SW Share Target] No binary file item found in formData',
              entriesSummary
            );


            await saveDiagnosticLog({
              status: 'failed',


              reason:
                'no_binary_file_in_formData',


              request: {
                method:
                  requestDiagnostics.method,


                url:
                  requestDiagnostics.url,


                contentType:
                  requestDiagnostics.contentType,


                contentLength:
                  requestDiagnostics.contentLength,
              },


              entries:
                requestDiagnostics.entries,


              pdfFile:
                requestDiagnostics.pdfFile,


              entriesSummary,
            });


            redirectUrl =
              new URL(
                `/?shared_status=failed&reason=no_file_found&attempted_file=${encodeURIComponent(
                  targetFileName
                )}`,
                self.location.origin
              ).href;
          }
        }


        /*
         * ==========================================================
         * EXCEPTION
         * ================================================================
         */


        catch (err) {
          console.error(
            '[SW Share Target] Error processing shared PDF request:',
            err
          );


          await saveDiagnosticLog({
            status: 'failed',


            reason: 'exception',


            error:
              String(
                err?.message || err
              ),


            request: {
              method:
                event.request.method,


              url:
                event.request.url,


              contentType:
                event.request.headers.get(
                  'content-type'
                ),


              contentLength:
                event.request.headers.get(
                  'content-length'
                ),
            },


            entries:
              entriesSummary,
          });


          redirectUrl =
            new URL(
              '/?shared_status=failed&reason=exception',
              self.location.origin
            ).href;
        }


        /*
         * HTTP 303:
         * return to the PWA after processing the POST.
         */
        return Response.redirect(
          redirectUrl,
          303
        );
      })()
    );
  }
});
