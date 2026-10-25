/**
 * Universal Native Bridge for Android & Modern Web
 * Provides seamless Android Native Print & Share Sheet integration with fallback to Web APIs.
 */

import { nativeFileAction } from './androidPdfTransfer';

/**
 * Returns true if running inside the Android Capacitor container with NativePdfBridge.
 */
export function isNativeAndroid(): boolean {
  return typeof window !== 'undefined' && Boolean(window.NativePdfBridge);
}

/**
 * Open a PDF's external URL in Android's default browser (ACTION_VIEW), not
 * a WebView popup. Desktop retains the anchor's normal target="_blank".
 * Never permit javascript:, file:, content: or data: URLs from annotations.
 */
export function openPdfExternalLink(rawUrl: string): void {
  const url = new URL(rawUrl);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Dieser PDF-Link verwendet ein nicht unterstütztes Protokoll.');
  }
  if (!url.hostname) throw new Error('Ungültige Webadresse im PDF.');
  if (!isNativeAndroid()) {
    window.open(url.href, '_blank', 'noopener,noreferrer');
    return;
  }
  const native = window.NativePdfBridge as any;
  if (typeof native.openExternalUrl !== 'function' ||
      native.openExternalUrl(url.href) !== true) {
    throw new Error('Der Weblink konnte nicht im Android-Browser geöffnet werden.');
  }
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
 * Opens the system file/folder picker to let the user choose where to save the PDF.
 * On Android: launches Storage Access Framework (Intent.ACTION_CREATE_DOCUMENT) via 'save_as'.
 * On Web: delegates to savePdfDocument (which uses showSaveFilePicker when available).
 */
export async function savePdfDocumentAs(
  fileName: string,
  pdfData: Blob | ArrayBuffer | Uint8Array
): Promise<{ success: boolean; method: 'native-android-picker' | 'file-picker' | 'download' }> {
  const safeName = fileName.toLowerCase().endsWith('.pdf') ? fileName : `${fileName}.pdf`;

  if (isNativeAndroid() && (window.NativePdfBridge as any)?.beginPdfTransfer) {
    try {
      const ok = await nativeFileAction('save_as', safeName, pdfData);
      if (ok) return { success: true, method: 'native-android-picker' };
      throw new Error('Speicherort-Auswahl auf Android konnte nicht geöffnet werden.');
    } catch (err) {
      console.error('Native Android save_as failed:', err);
      throw err;
    }
  }

  const res = await savePdfDocument(safeName, pdfData);
  return {
    success: res.success,
    method: res.method === 'native-android' ? 'native-android-picker' : res.method,
  };
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
