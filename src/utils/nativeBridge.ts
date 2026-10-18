/**
 * Universal Native Bridge for Android & Modern Web
 * Provides seamless Android Native Print & Share Sheet integration with fallback to Web APIs.
 */

// Helper to convert Blob / ArrayBuffer / Uint8Array to base64
export async function toBase64String(data: Blob | ArrayBuffer | Uint8Array): Promise<string> {
  if (data instanceof Blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        // Strip data:application/pdf;base64, prefix if present
        const commaIndex = result.indexOf(',');
        resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(data);
    });
  }

  const uint8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  let binary = '';
  const len = uint8.byteLength;
  // Process in chunks to avoid call stack overflow on large PDFs
  const chunkSize = 0x8000;
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = uint8.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, chunk as any);
  }
  return btoa(binary);
}


/**
 * Streams PDF into an Android-owned temporary file in bounded chunks.
 * The Android JavascriptInterface accepts strings; only individual chunks
 * are base64 encoded. No full-document base64 strings or byte[] copies.
 */
async function nativeFileAction(
  action: 'save' | 'share' | 'print',
  name: string,
  data: Blob | ArrayBuffer | Uint8Array
): Promise<boolean> {
  const bridge = window.NativePdfBridge as any;
  if (!bridge?.beginPdfTransfer || !bridge?.appendPdfChunk || !bridge?.finishPdfTransfer) {
    return false;
  }
  const token: string = bridge.beginPdfTransfer();
  if (!token) return false;
  try {
    const blob = data instanceof Blob ? data : new Blob([data as any], { type: 'application/pdf' });
    let binaryUploaded = false;
    if (bridge.getBinaryTransferUrl) {
      const url: string = bridge.getBinaryTransferUrl(token);
      if (url && /^http:\/\/127\.0\.0\.1:\\d+\/pdf\/[a-f0-9-]+$/i.test(url)) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);
        try {
          // Rewrap to remove application/pdf Content-Type so WebView sends
          // a simple CORS POST without a preflight; the body remains binary.
          const response = await fetch(url, {
            method: 'POST',
            body: new Blob([blob]),
            signal: controller.signal,
          });
          binaryUploaded = response.ok;
        } catch (error) {
          console.warn('Native binary upload not available, using bounded chunk fallback:', error);
        } finally {
          clearTimeout(timeout);
        }
      }
    }
    if (!binaryUploaded) {
      bridge.resetPdfTransfer?.(token);
      const chunkSize = 48 * 1024;
      for (let offset = 0; offset < blob.size; offset += chunkSize) {
        const buffer = await blob.slice(offset, offset + chunkSize).arrayBuffer();
        const base64 = await toBase64String(buffer);
        if (!bridge.appendPdfChunk(token, base64)) throw new Error('PDF transfer failed');
      }
    }
    return Boolean(bridge.finishPdfTransfer(token, action, name));
  } finally {
    bridge.cancelPdfTransfer?.();
  }
}

/**
 * Returns true if running inside the Android Capacitor container with NativePdfBridge.
 */
export function isNativeAndroid(): boolean {
  return typeof window !== 'undefined' && Boolean(window.NativePdfBridge);
}

/**
 * Returns true if native share is supported (Android bridge or Web Share API with files).
 */
export function canSharePdf(): boolean {
  if (isNativeAndroid()) return true;
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    return true;
  }
  return false;
}

/**
 * Saves the PDF document to persistent storage.
 * On Android: uses NativePdfBridge.savePdf to save directly into the system Downloads folder via MediaStore.
 * On Web: uses the File System Access API (showSaveFilePicker) if available, or creates a standard download link.
 */
export async function savePdfDocument(
  fileName: string,
  pdfData: Blob | ArrayBuffer | Uint8Array
): Promise<{ success: boolean; method: 'native-android' | 'file-picker' | 'download' }> {
  const safeName = fileName.toLowerCase().endsWith('.pdf') ? fileName : `${fileName}.pdf`;

  // 1. Android: stream into an app-owned temp file (no full-PDF base64).
  if (isNativeAndroid() && (window.NativePdfBridge as any)?.beginPdfTransfer) {
    try {
      const ok = await nativeFileAction('save', safeName, pdfData);
      if (ok) return { success: true, method: 'native-android' };
      throw new Error('Android-Dateiaktion wurde nicht erfolgreich abgeschlossen.');
    } catch (err) {
      console.error('Native Android save failed:', err);
      throw err;
    }
  }

  const blob = pdfData instanceof Blob ? pdfData : new Blob([pdfData as any], { type: 'application/pdf' });

  // 2. Modern Web File System Access API (showSaveFilePicker)
  if (typeof window !== 'undefined' && 'showSaveFilePicker' in window) {
    try {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: safeName,
        types: [
          {
            description: 'PDF Document',
            accept: {
              'application/pdf': ['.pdf'],
            },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return { success: true, method: 'file-picker' };
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        // User deliberately cancelled the file picker dialog
        return { success: false, method: 'file-picker' };
      }
      console.warn('showSaveFilePicker failed or was rejected, falling back to download:', err);
    }
  }

  // 3. Fallback: Standard Web Download Link
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);

  return { success: true, method: 'download' };
}

/**
 * Shares the PDF document.
 * On Android: triggers the native Android Share Sheet (WhatsApp, Gmail, Drive, Bluetooth, etc.).
 * On Web: uses the Web Share API if supported, or prompts a download.
 */
export async function sharePdfDocument(
  fileName: string,
  pdfData: Blob | ArrayBuffer | Uint8Array
): Promise<{ success: boolean; method: 'native-android' | 'web-share' | 'download' }> {
  const safeName = fileName.toLowerCase().endsWith('.pdf') ? fileName : `${fileName}.pdf`;

  // 1. Android: stream into an app-owned temp file (no full-PDF base64).
  if (isNativeAndroid() && (window.NativePdfBridge as any)?.beginPdfTransfer) {
    try {
      const ok = await nativeFileAction('share', safeName, pdfData);
      if (ok) return { success: true, method: 'native-android' };
      throw new Error('Android-Dateiaktion wurde nicht erfolgreich abgeschlossen.');
    } catch (err) {
      console.error('Native Android share failed:', err);
      throw err;
    }
  }

  // 2. Web Share API
  const blob = pdfData instanceof Blob 
    ? pdfData 
    : new Blob([pdfData as any], { type: 'application/pdf' });

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      const file = new File([blob], safeName, { type: 'application/pdf' });
      if (!navigator.canShare || navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: safeName,
          text: 'PDF-Dokument teilen',
        });
        return { success: true, method: 'web-share' };
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        // User cancelled share dialog
        return { success: false, method: 'web-share' };
      }
      console.warn('Web Share failed, falling back to download:', err);
    }
  }

  // 3. Fallback: Direct Download
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);

  return { success: true, method: 'download' };
}

/**
 * Prints the PDF document.
 * On Android: directly launches the system PrintManager (Print Spooler / Wi-Fi printer / Save to PDF).
 * On Web: prints via an embedded hidden iframe or printable blob window.
 */
export async function printPdfDocument(
  documentName: string,
  pdfData: Blob | ArrayBuffer | Uint8Array
): Promise<{ success: boolean; method: 'native-android' | 'iframe' | 'window' }> {
  const safeTitle = documentName.trim() || 'Document.pdf';

  // 1. Android: stream into an app-owned temp file (no full-PDF base64).
  if (isNativeAndroid() && (window.NativePdfBridge as any)?.beginPdfTransfer) {
    try {
      const ok = await nativeFileAction('print', safeTitle, pdfData);
      if (ok) return { success: true, method: 'native-android' };
      throw new Error('Android-Dateiaktion wurde nicht erfolgreich abgeschlossen.');
    } catch (err) {
      console.error('Native Android print failed:', err);
      throw err;
    }
  }

  // 2. Web / Browser Print
  const blob = pdfData instanceof Blob 
    ? pdfData 
    : new Blob([pdfData as any], { type: 'application/pdf' });
  const blobUrl = URL.createObjectURL(blob);

  try {
    // Attempt printing via hidden iframe
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.top = '-10000px';
    iframe.style.left = '-10000px';
    iframe.style.width = '1px';
    iframe.style.height = '1px';
    iframe.style.opacity = '0';
    iframe.src = blobUrl;

    document.body.appendChild(iframe);

    return new Promise((resolve) => {
      iframe.onload = () => {
        setTimeout(() => {
          try {
            iframe.contentWindow?.focus();
            iframe.contentWindow?.print();
            resolve({ success: true, method: 'iframe' });
          } catch (err) {
            console.warn('Iframe print failed, opening window:', err);
            window.open(blobUrl, '_blank')?.print();
            resolve({ success: true, method: 'window' });
          } finally {
            setTimeout(() => {
              if (iframe.parentNode) {
                document.body.removeChild(iframe);
              }
              URL.revokeObjectURL(blobUrl);
            }, 30000);
          }
        }, 500);
      };

      iframe.onerror = () => {
        window.open(blobUrl, '_blank');
        resolve({ success: true, method: 'window' });
      };
    });
  } catch (err) {
    window.open(blobUrl, '_blank');
    return { success: true, method: 'window' };
  }
}
