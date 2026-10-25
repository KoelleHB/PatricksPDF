import type { DocumentInitParameters } from 'pdfjs-dist/types/src/display/api';
import { pdfjsLib } from './pdfWorker';

/**
 * Extended DocumentInitParameters that includes runtime-supported `enableScripting`
 * (read in pdf.mjs `getDocument` via `params.enableScripting === true`, though omitted
 * from upstream JSDoc d.ts) alongside `isEvalSupported: false`.
 */
type HardenedDocumentInitParameters = DocumentInitParameters & {
  enableScripting: false;
  isEvalSupported: false;
};

// Cache loaded PDFDocumentProxy promises by ArrayBuffer so the PDF is parsed once
// and reused across page switches, zoom changes, and re-renders
let pdfDocCache = new WeakMap<ArrayBuffer, Promise<any>>();
const activeDocuments = new Set<any>();
const pendingTasks = new Set<any>();

/** Destroy PDF.js state when switching a document (not during Undo/Redo). */
export async function disposePdfJsResources(): Promise<void> {
  const oldDocuments = [...activeDocuments];
  const oldTasks = [...pendingTasks];
  activeDocuments.clear();
  pendingTasks.clear();
  pdfDocCache = new WeakMap();
  for (const task of oldTasks) {
    try { await task.destroy(); } catch { /* already settled */ }
  }
  await Promise.allSettled(oldDocuments.map(doc => doc.destroy()));
}

// Track active render pipeline per canvas element to cancel overlapping renders safely
interface CanvasRenderPipeline {
  currentSessionId: number;
  currentTask: any | null;
  busyPromise: Promise<void> | null;
}

export const canvasPipelines = new WeakMap<HTMLCanvasElement, CanvasRenderPipeline>();

/**
 * Cancels any active or pending rendering operations on a given canvas.
 */
export function cancelCanvasRender(canvas: HTMLCanvasElement) {
  const pipeline = canvasPipelines.get(canvas);
  if (pipeline) {
    pipeline.currentSessionId++;
    if (pipeline.currentTask) {
      try {
        pipeline.currentTask.cancel();
      } catch {
        // Ignore cancellation errors
      }
      pipeline.currentTask = null;
    }
  }
}

/**
 * Loads a PDF document using pdfjs with defensive buffer protection, CMaps, standard fonts,
 * dynamic XFA forms support, and multi-tier linear XRef recovery.
 *
 * Web Workers transfer ArrayBuffers via postMessage, which detaches them in the main thread.
 * By slicing an isolated copy and caching the proxy promise, the original ArrayBuffer remains
 * completely valid and reusable across re-renders, page navigations, and exports.
 */
export async function loadPdfJsDoc(data: ArrayBuffer, password?: string) {
  if (!data || data.byteLength === 0) {
    throw new Error('Cannot load PDF: ArrayBuffer is empty or detached.');
  }

  // If no password override is specified, check the cache
  if (!password) {
    const cached = pdfDocCache.get(data);
    if (cached) {
      return cached;
    }
  }

  // Create an isolated copy of the ArrayBuffer for PDF.js worker to consume
  const bufferCopy = data.slice(0);
  const primaryInitParams: HardenedDocumentInitParameters = {
    data: new Uint8Array(bufferCopy),
    // Configure CMaps for non-ASCII fonts and international character encodings
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    // Configure standard 14 PDF fonts data fallback
    standardFontDataUrl: '/pdfjs/standard_fonts/',
    wasmUrl: '/pdfjs/wasm/',
    iccUrl: '/pdfjs/iccs/',
    // Tolerantly continue parsing despite minor syntax anomalies or object stream variations
    stopAtErrors: false,
    // Enable dynamic XFA forms commonly produced by Adobe Acrobat & LiveCycle
    enableXfa: true,
    // Explicitly disable embedded PDF JavaScript execution (mitigates CVE-2026-16633)
    enableScripting: false,
    // Explicitly disable dynamic Function()/eval() compilation in PDF.js worker (mitigates CVE-2024-4367)
    isEvalSupported: false,
    // Fallback to system fonts if non-embedded fonts are present
    useSystemFonts: true,
    // Unlimited image dimensions in object streams
    maxImageSize: -1,
    password: password || undefined,
  };
  const loadingTask = pdfjsLib.getDocument(primaryInitParams);

  pendingTasks.add(loadingTask);
  const docPromise = loadingTask.promise.catch((err: any) => {
    // If it's a password error, don't attempt linear recovery; let UI prompt user
    if (err?.name === 'PasswordException' || err?.code === 1 || err?.code === 2) {
      pdfDocCache.delete(data);
      throw err;
    }

    // Secondary recovery: if the initial load failed due to corrupted streams or displaced
    // cross-reference table (XRef) byte offsets, retry with monolithic linear mode.
    // Disabling streaming and range requests instructs PDF.js to run its full-file linear scanner
    // to reconstruct missing or corrupted XRef tables and object streams directly.
    console.warn('Standard PDF.js load encountered stream/XRef issue; initiating linear XRef recovery mode:', err);
    const recoveryBuffer = data.slice(0);
    const recoveryInitParams: HardenedDocumentInitParameters = {
      data: new Uint8Array(recoveryBuffer),
      cMapUrl: '/pdfjs/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/pdfjs/standard_fonts/',
      wasmUrl: '/pdfjs/wasm/',
      iccUrl: '/pdfjs/iccs/',
      stopAtErrors: false,
      enableXfa: true,
      enableScripting: false,
      isEvalSupported: false,
      useSystemFonts: true,
      maxImageSize: -1,
      disableStream: true,
      disableAutoFetch: true,
      disableRange: true,
      password: password || undefined,
    };
    const recoveryTask = pdfjsLib.getDocument(recoveryInitParams);

    pendingTasks.add(recoveryTask);
    return recoveryTask.promise.catch((recoveryErr: any) => {
      pdfDocCache.delete(data);
      throw recoveryErr;
    });
  });

  const tracked = docPromise.then(doc => {
    pendingTasks.delete(loadingTask);
    activeDocuments.add(doc);
    return doc;
  }, error => {
    pendingTasks.delete(loadingTask);
    throw error;
  });
  pdfDocCache.set(data, tracked);
  return tracked;
}

