/** Native Android PDF transport. No browser/PWA dependency unless explicitly invoked. */

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
export async function nativeFileAction(
  action: 'save' | 'save_as' | 'share' | 'print',
  name: string,
  data: Blob | ArrayBuffer | Uint8Array
): Promise<boolean> {
  const bridge = window.NativePdfBridge as any;
  if (!bridge?.beginPdfTransfer || !bridge?.appendPdfChunk || !bridge?.finishPdfTransfer) {
    return false;
  }
  let token: string = bridge.beginPdfTransfer();
  if (!token) return false;
  try {
    const blob = data instanceof Blob ? data : new Blob([data as any], { type: 'application/pdf' });
    let binaryUploaded = false;
    if (bridge.getBinaryTransferUrl) {
      const url: string = bridge.getBinaryTransferUrl(token);
      if (url && /^http:\/\/127\.0\.0\.1:\d+\/pdf\/[a-f0-9-]+$/i.test(url)) {
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
    if (binaryUploaded) console.info('[PatricksPDF] Android PDF transfer: binary loopback');
    if (!binaryUploaded) {
      console.info('[PatricksPDF] Android PDF transfer: bounded Base64 compatibility fallback');
      // Restart with a fresh file/token: a timed-out HTTP request could still
      // be writing asynchronously to the previous temporary file.
      bridge.cancelPdfTransfer();
      token = bridge.beginPdfTransfer();
      if (!token) throw new Error('Android fallback transfer could not start');
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

