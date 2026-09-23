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

  // 1. Android Native Bridge (Capacitor APK)
  if (isNativeAndroid() && window.NativePdfBridge?.savePdf) {
    try {
      const base64 = await toBase64String(pdfData);
      const ok = window.NativePdfBridge.savePdf(safeName, base64);
      if (ok) {
        return { success: true, method: 'native-android' };
      }
    } catch (err) {
      console.warn('Native Android save error, falling back:', err);
    }
  }

  const blob =
    pdfData instanceof Blob
      ? pdfData
      : new Blob([pdfData as any], { type: 'application/pdf' });

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

  // 1. Android Native Bridge
  if (isNativeAndroid() && window.NativePdfBridge?.sharePdf) {
    try {
      const base64 = await toBase64String(pdfData);
      const ok = window.NativePdfBridge.sharePdf(safeName, base64);
      if (ok) {
        return { success: true, method: 'native-android' };
      }
    } catch (err) {
      console.warn('Native Android share error, falling back:', err);
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

  // 1. Android Native Bridge
  if (isNativeAndroid() && window.NativePdfBridge?.printPdf) {
    try {
      const base64 = await toBase64String(pdfData);
      const ok = window.NativePdfBridge.printPdf(safeTitle, base64);
      if (ok) {
        return { success: true, method: 'native-android' };
      }
    } catch (err) {
      console.warn('Native Android print error, falling back:', err);
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
