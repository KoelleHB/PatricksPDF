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
 * Returns true if the application is running inside an embedded iframe (e.g. AI Studio preview).
 */
export function isRunningInIframe(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

/**
 * Toggles system-wide immersive fullscreen mode safely across environments and returns
 * a confirmed boolean status indicating whether the requested fullscreen state is active:
 * - On Native Android APK: hides/shows Android status and navigation bars via NativePdfBridge.setImmersiveFullscreen.
 * - In embedded iframes (AI Studio preview): skips browser Fullscreen API to prevent preview frame detachment/crashes and returns false when entering fullscreen.
 * - On standalone Web / PWA: uses the standard Fullscreen API and verifies Boolean(document.fullscreenElement) === enabled.
 */
export async function setSystemFullscreen(enabled: boolean): Promise<boolean> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;

  // 1. Native Android APK: toggle true system-wide immersive mode (status + navigation bars)
  if (isNativeAndroid()) {
    try {
      const native = window.NativePdfBridge as any;
      if (typeof native?.setImmersiveFullscreen === 'function') {
        return native.setImmersiveFullscreen(enabled) === true;
      }
    } catch (err) {
      console.warn('Android native fullscreen toggle warning:', err);
    }
    return false;
  }

  // 2. Embedded Preview iFrame (e.g. AI Studio): never invoke requestFullscreen on the iframe document
  if (isRunningInIframe()) {
    return !enabled;
  }

  // 3. Standalone Web / PWA: use standard Fullscreen API safely and verify document.fullscreenElement
  try {
    if (enabled) {
      if (document.fullscreenEnabled && !document.fullscreenElement && document.documentElement?.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      }
    } else {
      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen();
      }
    }
  } catch {
    // Ignore Fullscreen API rejection
  }

  return Boolean(document.fullscreenElement) === enabled;
}

export interface RuntimeVersionInfo {
  appVersion: string;
  apkBuildVersion: string | null;
  runtimeEnvironment: string;
}

/**
 * Resolves full runtime version & build diagnostics for the "Info & Diagnose" view.
 */
export function getRuntimeVersionInfo(appVersion: string): RuntimeVersionInfo {
  if (isNativeAndroid()) {
    let apkBuild: string | null = null;
    try {
      const native = window.NativePdfBridge;
      if (typeof native?.getAppBuildInfo === 'function') {
        const info = native.getAppBuildInfo();
        if (info && info.trim().length > 0) {
          apkBuild = info.trim();
        }
      }
    } catch {
      // Ignore bridge lookup errors
    }
    return {
      appVersion,
      apkBuildVersion: apkBuild || `${appVersion} (Android APK)`,
      runtimeEnvironment: 'Android APK (Capacitor Native)',
    };
  }

  if (isRunningInIframe()) {
    return {
      appVersion,
      apkBuildVersion: null,
      runtimeEnvironment: 'Web / Vorschau (Eingebettetes iFrame)',
    };
  }

  return {
    appVersion,
    apkBuildVersion: null,
    runtimeEnvironment: 'Standalone Web / PWA',
  };
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

export interface SavePdfAsOptions {
  timeoutMs?: number;
  requestId?: string;
}

const DEFAULT_SAVE_AS_TIMEOUT_MS = 120_000;
let activeSaveAsRequestId: string | null = null;

/**
 * Opens the system file/folder picker to let the user choose where to save the PDF.
 * On Android: launches Storage Access Framework (Intent.ACTION_CREATE_DOCUMENT) via 'save_as'
 * with strict requestId correlation, timeout, Activity lifecycle recovery, and finally cleanup.
 * On Web: delegates to savePdfDocument (which uses showSaveFilePicker when available).
 */
export async function savePdfDocumentAs(
  fileName: string,
  pdfData: Blob | ArrayBuffer | Uint8Array,
  options: SavePdfAsOptions = {}
): Promise<{ success: boolean; method: 'native-android-picker' | 'file-picker' | 'download' }> {
  const safeName = fileName.toLowerCase().endsWith('.pdf') ? fileName : `${fileName}.pdf`;

  const bridge = typeof window !== 'undefined' ? (window.NativePdfBridge as any) : null;
  if (isNativeAndroid() && bridge?.beginPdfTransfer) {
    if (activeSaveAsRequestId !== null) {
      throw new Error('Ein Speichervorgang über den Dateidialog ist bereits aktiv.');
    }

    const requestId =
      options.requestId ||
      `save_as_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const timeoutMs =
      typeof options.timeoutMs === 'number' && options.timeoutMs > 0
        ? options.timeoutMs
        : DEFAULT_SAVE_AS_TIMEOUT_MS;

    activeSaveAsRequestId = requestId;

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    let lifecycleProbeHandle: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    let removeLifecycleListeners: (() => void) | null = null;
    let callbackFn: ((completed: boolean, callbackRequestId?: string) => void) | null = null;

    try {
      if (typeof bridge.beginSaveAsRequest === 'function') {
        const started = bridge.beginSaveAsRequest(requestId);
        if (started === false) {
          throw new Error('Speicherort-Anfrage auf Android konnte nicht initialisiert werden.');
        }
      }

      const completionPromise = new Promise<boolean>((resolve, reject) => {
        const settleResolve = (val: boolean) => {
          if (settled) return;
          settled = true;
          resolve(val);
        };
        const settleReject = (err: Error) => {
          if (settled) return;
          settled = true;
          reject(err);
        };

        callbackFn = (completed: boolean, callbackRequestId?: string) => {
          // Ignore stale callbacks belonging to a different requestId
          if (callbackRequestId && callbackRequestId !== requestId) {
            return;
          }
          settleResolve(Boolean(completed));
        };
        (window as any).onNativeSaveAsCompleted = callbackFn;

        timeoutHandle = setTimeout(() => {
          settleReject(
            new Error('Zeitüberschreitung bei der Speicherort-Auswahl auf Android.')
          );
        }, timeoutMs);

        const checkNativeLifecycleStatus = () => {
          if (settled || typeof bridge.getSaveAsStatus !== 'function') return;
          if (lifecycleProbeHandle) clearTimeout(lifecycleProbeHandle);
          lifecycleProbeHandle = setTimeout(() => {
            if (settled) return;
            try {
              const status = bridge.getSaveAsStatus(requestId);
              if (status === 'success') {
                settleResolve(true);
              } else if (status === 'cancelled') {
                settleResolve(false);
              } else if (status === 'unknown') {
                settleReject(
                  new Error(
                    'Der Android-Speicherdialog wurde durch eine Unterbrechung oder Neuerstellung der Activity beendet.'
                  )
                );
              }
            } catch {
              // Ignore probe errors; timeout remains active
            }
          }, 800);
        };

        const onWindowFocus = () => checkNativeLifecycleStatus();
        const onVisibilityChange = () => {
          if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
            checkNativeLifecycleStatus();
          }
        };

        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
          window.addEventListener('focus', onWindowFocus);
        }
        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
          document.addEventListener('visibilitychange', onVisibilityChange);
        }

        removeLifecycleListeners = () => {
          if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
            window.removeEventListener('focus', onWindowFocus);
          }
          if (
            typeof document !== 'undefined' &&
            typeof document.removeEventListener === 'function'
          ) {
            document.removeEventListener('visibilitychange', onVisibilityChange);
          }
        };
      });

      const launched = await nativeFileAction('save_as', safeName, pdfData);
      if (!launched) {
        settled = true;
        throw new Error('Speicherort-Auswahl auf Android konnte nicht geöffnet werden.');
      }

      const saved = await completionPromise;
      return { success: saved, method: 'native-android-picker' };
    } catch (err) {
      console.error('Native Android save_as failed:', err);
      throw err;
    } finally {
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (lifecycleProbeHandle) clearTimeout(lifecycleProbeHandle);
      removeLifecycleListeners?.();
      if (
        typeof window !== 'undefined' &&
        (window as any).onNativeSaveAsCompleted === callbackFn
      ) {
        delete (window as any).onNativeSaveAsCompleted;
      }
      try {
        bridge?.cancelSaveAsRequest?.(requestId);
      } catch {
        // Ignore cleanup bridge errors
      }
      if (activeSaveAsRequestId === requestId) {
        activeSaveAsRequestId = null;
      }
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
