import {
  PDFDocument,
  degrees,
  PDFHexString,
  PDFArray,
  StandardFonts,
  rgb,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { SignatureItem, TextOverlayItem, FormFieldItem, FormFieldType, FormValuesState, PageInfo, PageSpec, PdfLinkAnnotation, PdfOutlineItem } from '../types';
import { pdfjsLib } from './pdfWorker';

// Cache for Caveat script font ArrayBuffer
let cachedScriptFontBytes: ArrayBuffer | null = null;

async function getScriptFontBytes(): Promise<ArrayBuffer> {
  if (cachedScriptFontBytes) return cachedScriptFontBytes;
  try {
    const res = await fetch('/Caveat-Regular.ttf');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    cachedScriptFontBytes = await res.arrayBuffer();
    return cachedScriptFontBytes;
  } catch (err) {
    console.warn('Failed to load local /Caveat-Regular.ttf, trying CDN fallback:', err);
    const res = await fetch('https://raw.githubusercontent.com/google/fonts/main/ofl/caveat/Caveat%5Bwght%5D.ttf');
    cachedScriptFontBytes = await res.arrayBuffer();
    return cachedScriptFontBytes;
  }
}

export interface RenderPageResult {
  width: number;
  height: number;
  aspectRatio: number;
}

// Cache loaded PDFDocumentProxy promises by ArrayBuffer so the PDF is parsed once
// and reused across page switches, zoom changes, and re-renders
const pdfDocCache = new WeakMap<ArrayBuffer, Promise<any>>();

// Track active render pipeline per canvas element to cancel overlapping renders safely
interface CanvasRenderPipeline {
  currentSessionId: number;
  currentTask: any | null;
  busyPromise: Promise<void> | null;
}

const canvasPipelines = new WeakMap<HTMLCanvasElement, CanvasRenderPipeline>();

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
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(bufferCopy),
    // Configure CMaps for non-ASCII fonts and international character encodings
    cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/cmaps/',
    cMapPacked: true,
    // Configure standard 14 PDF fonts data fallback
    standardFontDataUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/standard_fonts/',
    // Tolerantly continue parsing despite minor syntax anomalies or object stream variations
    stopAtErrors: false,
    // Enable dynamic XFA forms commonly produced by Adobe Acrobat & LiveCycle
    enableXfa: true,
    // Fallback to system fonts if non-embedded fonts are present
    useSystemFonts: true,
    // Unlimited image dimensions in object streams
    maxImageSize: -1,
    // Support function evaluation for blend modes and shading patterns
    isEvalSupported: true,
    password: password || undefined,
  });

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
    const recoveryTask = pdfjsLib.getDocument({
      data: new Uint8Array(recoveryBuffer),
      cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/standard_fonts/',
      stopAtErrors: false,
      enableXfa: true,
      useSystemFonts: true,
      maxImageSize: -1,
      isEvalSupported: true,
      disableStream: true,
      disableAutoFetch: true,
      disableRange: true,
      password: password || undefined,
    });

    return recoveryTask.promise.catch((recoveryErr: any) => {
      pdfDocCache.delete(data);
      throw recoveryErr;
    });
  });

  pdfDocCache.set(data, docPromise);
  return docPromise;
}

/**
 * Renders a specific PDF page onto a target canvas with sharp resolution, concurrency mutex,
 * interactive form annotations (AcroForms), white opaque backdrop, and graceful fallback.
 */
export async function renderPdfPageToCanvas(
  data: ArrayBuffer,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scaleMultiplier: number = 1.5
): Promise<RenderPageResult | null> {
  // Get or initialize the pipeline queue for this canvas
  let pipeline = canvasPipelines.get(canvas);
  if (!pipeline) {
    pipeline = {
      currentSessionId: 0,
      currentTask: null,
      busyPromise: null,
    };
    canvasPipelines.set(canvas, pipeline);
  }

  // Increment session ID to immediately invalidate any in-flight or waiting rendering operations
  pipeline.currentSessionId++;
  const thisSessionId = pipeline.currentSessionId;

  // Signal cancellation to any active PDF.js render task
  if (pipeline.currentTask) {
    try {
      pipeline.currentTask.cancel();
    } catch {
      // Ignore cancellation errors
    }
  }

  // Wait for any ongoing render operation to completely finish or reject before touching this canvas
  if (pipeline.busyPromise) {
    await pipeline.busyPromise.catch(() => {});
  }

  // If a newer render request arrived while waiting, gracefully exit
  if (pipeline.currentSessionId !== thisSessionId) {
    return null;
  }

  // Establish the lock promise for this render session
  let resolveBusy: () => void = () => {};
  pipeline.busyPromise = new Promise<void>((resolve) => {
    resolveBusy = resolve;
  });

  try {
    const pdfDoc = await loadPdfJsDoc(data);
    if (pipeline.currentSessionId !== thisSessionId) {
      return null;
    }

    const page = await pdfDoc.getPage(pageNumber);
    if (pipeline.currentSessionId !== thisSessionId) {
      return null;
    }

    const initialViewport = page.getViewport({ scale: 1.0 });
    const viewport = page.getViewport({ scale: scaleMultiplier });

    // Render onto an off-screen buffer first to eliminate white-flashing, layout jumps, and flickering
    const offscreen = document.createElement('canvas');
    offscreen.width = Math.round(viewport.width);
    offscreen.height = Math.round(viewport.height);

    const offCtx = offscreen.getContext('2d');
    if (!offCtx) throw new Error('Could not get offscreen canvas context');

    // Pre-paint a solid white background: Adobe Acrobat documents and annotations
    // expect an opaque white base to prevent inverted colors, dark backgrounds, or transparency anomalies
    offCtx.fillStyle = '#ffffff';
    offCtx.fillRect(0, 0, offscreen.width, offscreen.height);

    // Render with ENABLE_FORMS to render Adobe Acrobat interactive forms, stamps, and appearance streams
    const annotationMode = (pdfjsLib as any).AnnotationMode?.ENABLE_FORMS ?? 2;
    const renderContext = {
      canvasContext: offCtx,
      viewport: viewport,
      intent: 'display',
      annotationMode: annotationMode,
      background: 'rgba(255, 255, 255, 1)',
    };

    let renderTask = page.render(renderContext);
    pipeline.currentTask = renderTask;

    try {
      await renderTask.promise;
    } catch (err: any) {
      if (err?.name === 'RenderingCancelledException') {
        return null;
      }
      // If rendering failed due to an annotation appearance or widget stream error,
      // fallback to basic page rendering without annotations to ensure user can still view the page
      console.warn('Annotation rendering encountered an issue, falling back to base page render:', err);
      if (pipeline.currentSessionId === thisSessionId) {
        offCtx.fillStyle = '#ffffff';
        offCtx.fillRect(0, 0, offscreen.width, offscreen.height);
        const fallbackRenderContext = {
          canvasContext: offCtx,
          viewport: viewport,
          intent: 'display',
          annotationMode: (pdfjsLib as any).AnnotationMode?.DISABLE ?? 0,
        };
        renderTask = page.render(fallbackRenderContext);
        pipeline.currentTask = renderTask;
        await renderTask.promise;
      } else {
        return null;
      }
    } finally {
      if (pipeline.currentTask === renderTask) {
        pipeline.currentTask = null;
      }
    }

    if (pipeline.currentSessionId !== thisSessionId) {
      return null;
    }

    // Atomically transfer the off-screen buffer onto the on-screen canvas in a single paint frame.
    // The previous canvas pixels stay visible until this exact call, ensuring zero white frames or visual tearing.
    canvas.width = offscreen.width;
    canvas.height = offscreen.height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(offscreen, 0, 0);
    }

    return {
      width: initialViewport.width,
      height: initialViewport.height,
      aspectRatio: initialViewport.width / initialViewport.height,
    };
  } finally {
    resolveBusy();
    if (pipeline.currentSessionId === thisSessionId) {
      pipeline.busyPromise = null;
    }
  }
}

/**
 * Renders the selectable text layer for a PDF page into a target container div.
 * Enables user text marking, cursor selection, dragging, and standard clipboard copying.
 */
export async function renderPdfTextLayer(
  data: ArrayBuffer,
  pageNumber: number,
  container: HTMLDivElement,
  targetWidth: number
): Promise<any> {
  if (!container || !data) return null;

  try {
    const pdfDoc = await loadPdfJsDoc(data);
    const page = await pdfDoc.getPage(pageNumber);

    const baseViewport = page.getViewport({ scale: 1.0 });
    const scale = targetWidth / baseViewport.width;
    const viewport = page.getViewport({ scale });

    // Reset container contents
    container.innerHTML = '';
    container.style.width = `${Math.round(viewport.width)}px`;
    container.style.height = `${Math.round(viewport.height)}px`;

    const textContent = await page.getTextContent();

    const TextLayerClass = (pdfjsLib as any).TextLayer;
    if (TextLayerClass) {
      const textLayer = new TextLayerClass({
        textContentSource: textContent,
        container,
        viewport,
      });
      await textLayer.render();
      return textLayer;
    }
  } catch (err: any) {
    if (err?.name !== 'RenderingCancelledException') {
      console.warn(`[TextLayer] Render warning for page ${pageNumber}:`, err);
    }
    return null;
  }
}

/**
 * Calculates the exact PDF image coordinates, bounding box, and rotation angle
 * taking into account page rotation (0, 90, 180, 270 deg) and MediaBox/CropBox origin offsets.
 */
export function calculatePdfImagePlacement(
  page: any,
  xPercent: number,
  yPercent: number,
  widthPercent: number,
  aspectRatio: number
) {
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;
  const mediaBox = page.getMediaBox();
  const cropBox = page.getCropBox();
  // In ISO 32000-1, visual viewport boundaries are determined by CropBox (fallback to MediaBox)
  const box = cropBox || mediaBox;
  const originX = (box && box.x) || 0;
  const originY = (box && box.y) || 0;
  const boxWidth = (box && box.width) || page.getWidth();
  const boxHeight = (box && box.height) || page.getHeight();

  // In rotated pages, the visual dimensions presented in the viewer are swapped
  const isTransposed = rotation === 90 || rotation === 270;
  const visWidth = isTransposed ? boxHeight : boxWidth;
  const visHeight = isTransposed ? boxWidth : boxHeight;

  const w_vis = (widthPercent / 100) * visWidth;
  const h_vis = w_vis / aspectRatio;
  const x_vis = (xPercent / 100) * visWidth;
  const y_vis = (yPercent / 100) * visHeight;

  // Visual Bottom-Left of the signature image mapped into PDF unrotated user space
  // Verified mathematically against PDF.js convertToPdfPoint for 0, 90, 180, 270 deg
  let x = 0;
  let y = 0;

  if (rotation === 0) {
    x = originX + x_vis;
    y = originY + boxHeight - (y_vis + h_vis);
  } else if (rotation === 90) {
    x = originX + (y_vis + h_vis);
    y = originY + x_vis;
  } else if (rotation === 180) {
    x = originX + boxWidth - x_vis;
    y = originY + (y_vis + h_vis);
  } else if (rotation === 270) {
    x = originX + boxWidth - (y_vis + h_vis);
    y = originY + boxHeight - x_vis;
  }

  return {
    x,
    y,
    width: w_vis,
    height: h_vis,
    rotate: degrees(rotation),
  };
}

/**
 * Extracts interactive AcroForm fields (text fields, comb fields, multiline text,
 * checkboxes, radio groups with individual choices, dropdowns, listboxes, and action buttons)
 * from the PDF with their page numbers, pixel-perfect bounding percentages, and current values.
 *
 * Uses PDF.js getAnnotations with viewport coordinate conversion for 100% accurate alignment
 * across page rotations, crop boxes, and all PDF versions, with a defensive pdf-lib fallback.
 */
export async function extractPdfFormFields(
  pdfBytes: ArrayBuffer
): Promise<{ fields: FormFieldItem[]; initialValues: FormValuesState }> {
  try {
    const pdfDoc = await loadPdfJsDoc(pdfBytes);
    const numPages = pdfDoc.numPages;
    const extractedFields: FormFieldItem[] = [];
    const initialValues: FormValuesState = {};

    for (let p = 1; p <= numPages; p++) {
      const page = await pdfDoc.getPage(p);
      const viewport = page.getViewport({ scale: 1.0 });
      const annotations = await page.getAnnotations({ intent: 'display' });

      for (let i = 0; i < annotations.length; i++) {
        const annot = annotations[i];
        if (!annot) continue;

        // Form field widgets have subtype === 'Widget' or annotationType === 19
        const isWidget =
          annot.subtype === 'Widget' ||
          annot.annotationType === 19 ||
          (annot.fieldType && annot.fieldType !== 'Sig');

        if (!isWidget) continue;
        if (annot.hidden || annot.noView) continue;

        const rect = annot.rect;
        if (!rect || rect.length < 4) continue;

        // Convert PDF coordinates (origin bottom-left) to Viewport coordinates (origin top-left)
        // This automatically handles page rotation (0, 90, 180, 270), cropBox, and mediaBox offsets
        const [vx1, vy1, vx2, vy2] = viewport.convertToViewportRectangle(rect);
        const x = Math.min(vx1, vx2);
        const y = Math.min(vy1, vy2);
        const width = Math.abs(vx2 - vx1);
        const height = Math.abs(vy2 - vy1);

        if (width <= 0 || height <= 0) continue;

        const xPercent = (x / viewport.width) * 100;
        const yPercent = (y / viewport.height) * 100;
        const widthPercent = (width / viewport.width) * 100;
        const heightPercent = (height / viewport.height) * 100;

        const name = annot.fieldName || `field_p${p}_${i}`;
        let fieldType: FormFieldType = 'text';
        let options: string[] | undefined = undefined;
        let optionValue: string | undefined = undefined;

        if (annot.fieldType === 'Btn') {
          if (annot.radioButton) {
            fieldType = 'radio';
            optionValue = annot.buttonValue || '';
            // Radio button value matching
            if (annot.fieldValue && annot.fieldValue !== 'Off' && annot.fieldValue === annot.buttonValue) {
              initialValues[name] = annot.buttonValue;
            } else if (initialValues[name] === undefined) {
              initialValues[name] = annot.fieldValue && annot.fieldValue !== 'Off' ? annot.fieldValue : '';
            }
          } else if (annot.checkBox) {
            fieldType = 'checkbox';
            const isChecked =
              annot.fieldValue === true ||
              annot.fieldValue === 'Yes' ||
              annot.fieldValue === 'true' ||
              (annot.buttonValue && annot.fieldValue === annot.buttonValue);
            if (initialValues[name] === undefined) {
              initialValues[name] = isChecked;
            }
          } else if (annot.pushbutton) {
            fieldType = 'button';
          }
        } else if (annot.fieldType === 'Ch') {
          // Choice: dropdown or listbox
          const rawOptions = annot.options || [];
          options = rawOptions.map((opt: any) => {
            if (typeof opt === 'string') return opt;
            return opt.displayValue || opt.exportValue || String(opt);
          });

          if (annot.combo) {
            fieldType = 'dropdown';
          } else {
            fieldType = 'listbox';
          }

          if (initialValues[name] === undefined) {
            initialValues[name] = annot.fieldValue || (options.length > 0 ? options[0] : '');
          }
        } else if (annot.fieldType === 'Tx') {
          fieldType = 'text';
          if (initialValues[name] === undefined) {
            initialValues[name] = annot.fieldValue || annot.defaultFieldValue || '';
          }
        } else {
          continue;
        }

        extractedFields.push({
          id: `field-${name}-${annot.id || extractedFields.length}`,
          name,
          type: fieldType,
          pageNumber: p,
          xPercent: Math.max(0, Math.min(99, xPercent)),
          yPercent: Math.max(0, Math.min(99, yPercent)),
          widthPercent: Math.max(0.5, Math.min(100, widthPercent)),
          heightPercent: Math.max(0.5, Math.min(100, heightPercent)),
          options,
          value: optionValue,
          multiline: !!annot.multiline,
          comb: !!annot.comb,
          maxLen: annot.maxLen || undefined,
          readOnly: !!annot.readOnly,
        });
      }
    }

    if (extractedFields.length > 0) {
      return { fields: extractedFields, initialValues };
    }
  } catch (pdfJsErr) {
    console.warn('PDF.js form field extraction encountered an issue, trying pdf-lib fallback:', pdfJsErr);
  }

  // Fallback to pdf-lib if PDF.js returned no fields or threw
  return extractPdfFormFieldsViaPdfLib(pdfBytes);
}

/**
 * Defensive AcroForm extraction fallback via pdf-lib
 */
async function extractPdfFormFieldsViaPdfLib(
  pdfBytes: ArrayBuffer
): Promise<{ fields: FormFieldItem[]; initialValues: FormValuesState }> {
  try {
    const copy = pdfBytes.slice(0);
    const pdfDoc = await PDFDocument.load(copy, {
      ignoreEncryption: true,
      updateMetadata: false,
      throwOnInvalidObject: false,
      capNumbers: true,
    });

    const form = pdfDoc.getForm();
    if (!form) return { fields: [], initialValues: {} };

    const acroFields = form.getFields();
    if (!acroFields || acroFields.length === 0) {
      return { fields: [], initialValues: {} };
    }

    const pages = pdfDoc.getPages();
    const extractedFields: FormFieldItem[] = [];
    const initialValues: FormValuesState = {};

    for (const field of acroFields) {
      const name = field.getName();
      let fieldType: FormFieldType = 'other';
      let options: string[] | undefined = undefined;
      let initialVal: string | boolean | string[] = '';
      let isMultiline = false;

      if ('getText' in field) {
        fieldType = 'text';
        try {
          initialVal = (field as any).getText() || '';
          isMultiline = (field as any).isMultiline ? (field as any).isMultiline() : false;
        } catch {
          initialVal = '';
        }
      } else if ('isChecked' in field) {
        fieldType = 'checkbox';
        try {
          initialVal = (field as any).isChecked() || false;
        } catch {
          initialVal = false;
        }
      } else if ('getOptions' in field && 'isMultiselect' in field) {
        fieldType = 'listbox';
        try {
          options = (field as any).getOptions() || [];
          const selected = (field as any).getSelected() || [];
          initialVal = selected.length > 0 ? selected[0] : (options && options[0]) || '';
        } catch {
          initialVal = '';
        }
      } else if ('getOptions' in field && 'getSelected' in field) {
        try {
          options = (field as any).getOptions() || [];
          initialVal = (field as any).getSelected() || '';
          if ((field as any).isRadioGroup || field.constructor.name.includes('Radio')) {
            fieldType = 'radio';
          } else {
            fieldType = 'dropdown';
          }
        } catch {
          initialVal = '';
        }
      } else {
        continue;
      }

      initialValues[name] = initialVal;

      const widgets = (field as any).acroField?.getWidgets?.() || [];
      for (let wIdx = 0; wIdx < widgets.length; wIdx++) {
        const widget = widgets[wIdx];
        let widgetPageIndex = 0;

        for (let p = 0; p < pages.length; p++) {
          try {
            const rawAnnots = pages[p].node.Annots();
            const annots = rawAnnots ? pdfDoc.context.lookup(rawAnnots) : null;
            if (annots && typeof (annots as any).size === 'function') {
              for (let j = 0; j < (annots as any).size(); j++) {
                const annotItem = (annots as any).get(j);
                const resolved = pdfDoc.context.lookup(annotItem);
                const widgetRef = (widget as any).ref || (widget as any).dict;
                if (annotItem === widgetRef || resolved === (widget as any).dict) {
                  widgetPageIndex = p;
                  break;
                }
              }
            }
          } catch {
            // Ignore page annotation resolution error
          }
        }

        const targetPage = pages[widgetPageIndex];
        const mediaBox = targetPage.getMediaBox();
        const cropBox = targetPage.getCropBox();
        const box = cropBox || mediaBox;
        const originX = (box && box.x) || 0;
        const originY = (box && box.y) || 0;
        const boxWidth = (box && box.width) || targetPage.getWidth();
        const boxHeight = (box && box.height) || targetPage.getHeight();

        const rect = widget.getRectangle?.();
        if (!rect) continue;

        const xRel = rect.x - originX;
        const yRel = rect.y - originY;

        const xPercent = (xRel / boxWidth) * 100;
        const yPercent = ((boxHeight - (yRel + rect.height)) / boxHeight) * 100;
        const widthPercent = (rect.width / boxWidth) * 100;
        const heightPercent = (rect.height / boxHeight) * 100;

        let radioOptValue: string | undefined = undefined;
        if (fieldType === 'radio' && options && options[wIdx]) {
          radioOptValue = options[wIdx];
        }

        extractedFields.push({
          id: `field-${name}-${extractedFields.length}`,
          name,
          type: fieldType,
          pageNumber: widgetPageIndex + 1,
          xPercent: Math.max(0, Math.min(95, xPercent)),
          yPercent: Math.max(0, Math.min(95, yPercent)),
          widthPercent: Math.max(1, Math.min(100, widthPercent)),
          heightPercent: Math.max(1, Math.min(100, heightPercent)),
          options,
          value: radioOptValue,
          multiline: isMultiline,
          readOnly: (field as any).isReadOnly ? (field as any).isReadOnly() : false,
        });
      }
    }

    return { fields: extractedFields, initialValues };
  } catch (err) {
    console.warn('pdf-lib fallback extraction failed:', err);
    return { fields: [], initialValues: {} };
  }
}

/**
 * Calculates text placement for rotated and offset pages.
 */
export function calculatePdfTextPlacement(
  page: any,
  xPercent: number,
  yPercent: number,
  fontSize: number
) {
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;
  const mediaBox = page.getMediaBox();
  const cropBox = page.getCropBox();
  const box = cropBox || mediaBox;
  const originX = (box && box.x) || 0;
  const originY = (box && box.y) || 0;
  const boxWidth = (box && box.width) || page.getWidth();
  const boxHeight = (box && box.height) || page.getHeight();

  const isTransposed = rotation === 90 || rotation === 270;
  const visWidth = isTransposed ? boxHeight : boxWidth;
  const visHeight = isTransposed ? boxWidth : boxHeight;

  const x_vis = (xPercent / 100) * visWidth;
  // Font baseline is slightly lower than top box bound
  const y_vis = (yPercent / 100) * visHeight + fontSize * 0.85;

  let x = 0;
  let y = 0;

  if (rotation === 0) {
    x = originX + x_vis;
    y = originY + boxHeight - y_vis;
  } else if (rotation === 90) {
    x = originX + y_vis;
    y = originY + x_vis;
  } else if (rotation === 180) {
    x = originX + boxWidth - x_vis;
    y = originY + y_vis;
  } else if (rotation === 270) {
    x = originX + boxWidth - y_vis;
    y = originY + boxHeight - x_vis;
  }

  return {
    x,
    y,
    rotate: degrees(rotation),
  };
}

export interface ExportPdfOptions {
  flattenForm?: boolean;
}

/**
 * Embeds transparent signatures, custom text overlays (Regular & Script font in Black or Blue),
 * and fills native interactive AcroForm fields with optional flattening.
 */
export async function embedSignaturesIntoPdf(
  originalPdfBytes: ArrayBuffer,
  signatures: SignatureItem[],
  textOverlays: TextOverlayItem[] = [],
  formValues: FormValuesState = {},
  options: ExportPdfOptions = {}
): Promise<Uint8Array> {
  // Defensive copy to ensure PDFDocument.load never mutates or detaches the original buffer
  const copy = originalPdfBytes.slice(0);
  
  // Load original PDF with options that maximize tolerance and preserve original document metadata
  const pdfDoc = await PDFDocument.load(copy, {
    ignoreEncryption: true,
    updateMetadata: false,
    throwOnInvalidObject: false,
    capNumbers: true,
  });

  // Register fontkit for custom true-type fonts (Caveat)
  pdfDoc.registerFontkit(fontkit);

  // 1. Process Native AcroForm Fields if values are provided
  try {
    const form = pdfDoc.getForm();
    if (form) {
      for (const [name, val] of Object.entries(formValues)) {
        try {
          const field = form.getFieldMaybe(name);
          if (!field) continue;
          if ('setText' in field) {
            (field as any).setText(String(val ?? ''));
          } else if ('check' in field && 'uncheck' in field) {
            if (val === true || val === 'true' || val === 'Yes') {
              (field as any).check();
            } else {
              (field as any).uncheck();
            }
          } else if ('select' in field) {
            if (typeof val === 'string' && val) {
              (field as any).select(val);
            } else if (Array.isArray(val) && val.length > 0) {
              (field as any).select(val);
            }
          }
        } catch (fieldErr) {
          console.warn(`Could not set form field "${name}":`, fieldErr);
        }
      }

      // Flatten form fields into page content if requested (locks values permanently)
      if (options.flattenForm) {
        try {
          form.flatten();
        } catch (flattenErr) {
          console.warn('Could not flatten form fields:', flattenErr);
        }
      }
    }
  } catch (formErr) {
    console.warn('AcroForm processing skipped:', formErr);
  }

  // 2. Embed Text Overlays (Regular Helvetica & Script Caveat font)
  if (textOverlays && textOverlays.length > 0) {
    // Prepare fonts
    const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    let scriptFont: any = null;
    const hasScript = textOverlays.some((t) => t.fontFamily === 'script');
    if (hasScript) {
      try {
        const fontBytes = await getScriptFontBytes();
        scriptFont = await pdfDoc.embedFont(fontBytes);
      } catch (fontErr) {
        console.warn('Failed to embed script font, falling back to Times Roman:', fontErr);
        scriptFont = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);
      }
    }

    const blackColor = rgb(0.04, 0.04, 0.05); // #09090b
    const blueColor = rgb(0.12, 0.23, 0.54);  // #1e3a8a Document Royal Blue
    const redColor = rgb(0.86, 0.15, 0.15);   // #dc2626 Vibrant Stamp/Document Red

    for (const textItem of textOverlays) {
      if (!textItem.text || textItem.pageNumber < 1 || textItem.pageNumber > pdfDoc.getPageCount()) {
        continue;
      }

      const page = pdfDoc.getPage(textItem.pageNumber - 1);
      const font = textItem.fontFamily === 'script' && scriptFont ? scriptFont : helveticaFont;
      const color =
        textItem.color === 'red'
          ? redColor
          : textItem.color === 'blue'
          ? blueColor
          : blackColor;
      // Caveat script font is optically slightly smaller than Helvetica, so boost size slightly for optical balance
      const effectiveSize = textItem.fontFamily === 'script' ? textItem.fontSize * 1.25 : textItem.fontSize;

      // Handle multiline text cleanly
      const lines = textItem.text.split('\n');
      const lineHeight = effectiveSize * 1.25;

      const initialPlacement = calculatePdfTextPlacement(
        page,
        textItem.xPercent,
        textItem.yPercent,
        effectiveSize
      );

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line && i > 0) continue;

        // Offset subsequent lines downwards
        const lineY = initialPlacement.y - i * lineHeight;

        page.drawText(line, {
          x: initialPlacement.x,
          y: lineY,
          size: effectiveSize,
          font: font,
          color: color,
          rotate: initialPlacement.rotate,
        });
      }
    }
  }

  // 3. Embed Transparent Signatures
  for (const sig of signatures) {
    if (sig.pageNumber < 1 || sig.pageNumber > pdfDoc.getPageCount()) {
      continue;
    }

    // Embed PNG with alpha channel (transparent background)
    const embeddedImage = await pdfDoc.embedPng(sig.pngBytes);
    const page = pdfDoc.getPage(sig.pageNumber - 1);

    const placement = calculatePdfImagePlacement(
      page,
      sig.xPercent,
      sig.yPercent,
      sig.widthPercent,
      sig.aspectRatio
    );

    page.drawImage(embeddedImage, {
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
      rotate: placement.rotate,
      opacity: sig.opacity ?? 1.0,
    });
  }

  // 4. Preserve original document metadata while setting ModificationDate
  try {
    pdfDoc.setModificationDate(new Date());
  } catch (e) {
    console.warn('Could not set modification date on PDF:', e);
  }

  // 5. Preserve and refresh Trailer /ID [permanentId, revisionId] (ISO 32000-1 Section 14.4)
  try {
    const existingId = pdfDoc.context.trailerInfo.ID;
    const generateHexId = () => {
      const bytes = new Uint8Array(16);
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        crypto.getRandomValues(bytes);
      } else {
        for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
      }
      return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    };

    const newRevId = PDFHexString.of(generateHexId());
    const idArray = PDFArray.withContext(pdfDoc.context);

    if (existingId instanceof PDFArray && existingId.size() > 0) {
      idArray.push(existingId.get(0));
    } else {
      idArray.push(PDFHexString.of(generateHexId()));
    }
    idArray.push(newRevId);
    pdfDoc.context.trailerInfo.ID = idArray;
  } catch (e) {
    console.warn('Could not update trailer /ID:', e);
  }

  // Save with classic cross-reference table (xref) format for 100% Adobe Acrobat compliance
  return pdfDoc.save({
    useObjectStreams: false,
  });
}

/**
 * Extracts dimension, orientation, and rotation information for every page in a document.
 */
export async function getPageInfoList(data: ArrayBuffer): Promise<PageInfo[]> {
  const pdfJsDoc = await loadPdfJsDoc(data);
  const numPages = pdfJsDoc.numPages;
  const list: PageInfo[] = [];

  for (let i = 1; i <= numPages; i++) {
    const page = await pdfJsDoc.getPage(i);
    const viewport = page.getViewport({ scale: 1.0 });
    const rotation = ((page.rotate % 360) + 360) % 360;
    list.push({
      pageNumber: i,
      width: viewport.width,
      height: viewport.height,
      rotation,
      aspectRatio: viewport.width / viewport.height,
    });
  }

  return list;
}

// In-memory cache for rendered thumbnails
const thumbnailCache = new Map<string, string>();

/**
 * Clears the in-memory thumbnail cache.
 */
export function clearThumbnailCache() {
  thumbnailCache.clear();
}

/**
 * Renders an individual PDF page as a lightweight high-res thumbnail data URL.
 */
export async function renderPageThumbnail(
  data: ArrayBuffer,
  pageNumber: number,
  targetWidth: number = 240
): Promise<string> {
  const cacheKey = `${data.byteLength}-${pageNumber}-${targetWidth}`;
  if (thumbnailCache.has(cacheKey)) {
    return thumbnailCache.get(cacheKey)!;
  }

  const pdfJsDoc = await loadPdfJsDoc(data);
  const page = await pdfJsDoc.getPage(pageNumber);
  const unscaledViewport = page.getViewport({ scale: 1.0 });
  const scale = targetWidth / Math.max(1, unscaledViewport.width);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context unavailable');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const renderContext = {
    canvasContext: ctx,
    viewport,
    intent: 'display',
    annotationMode: (pdfjsLib as any).AnnotationMode?.ENABLE_FORMS ?? 2,
    background: 'rgba(255, 255, 255, 1)',
  };

  try {
    await page.render(renderContext).promise;
  } catch (err: any) {
    if (err?.name !== 'RenderingCancelledException') {
      try {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({
          canvasContext: ctx,
          viewport,
          annotationMode: 0,
        }).promise;
      } catch {
        // Fallback placeholder
      }
    }
  }

  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  thumbnailCache.set(cacheKey, dataUrl);
  return dataUrl;
}

/**
 * Executes arbitrary page management operations: reordering, deletion, blank page insertions,
 * external PDF page imports, and 90° step rotations.
 */
export async function applyPageModifications(
  originalPdfBytes: ArrayBuffer,
  pages: PageSpec[]
): Promise<Uint8Array> {
  if (!pages || pages.length === 0) {
    throw new Error('A PDF document must have at least one page.');
  }

  // Load target document and clone document for safe page cloning/duplication
  const copy = originalPdfBytes.slice(0);
  const pdfDoc = await PDFDocument.load(copy, {
    ignoreEncryption: true,
    updateMetadata: false,
    throwOnInvalidObject: false,
    capNumbers: true,
  });

  let cloneDoc: PDFDocument | null = null;
  const originalPages = pdfDoc.getPages();
  const usedOriginalIndices = new Set<number>();

  // Remove existing pages from primary doc page tree
  while (pdfDoc.getPageCount() > 0) {
    pdfDoc.removePage(0);
  }

  // Cache for any imported external PDF documents
  const externalDocCache = new Map<ArrayBuffer, PDFDocument>();

  for (let i = 0; i < pages.length; i++) {
    const spec = pages[i];
    const targetAngle = ((spec.rotationAngle % 360) + 360) % 360;

    if (spec.source === 'existing') {
      const origIdx = spec.originalPageIndex;
      if (origIdx >= 0 && origIdx < originalPages.length) {
        if (!usedOriginalIndices.has(origIdx)) {
          // First use of this original page: insert directly into new position
          const page = originalPages[origIdx];
          page.setRotation(degrees(targetAngle));
          pdfDoc.insertPage(i, page);
          usedOriginalIndices.add(origIdx);
        } else {
          // Page was duplicated: copy from cloneDoc
          if (!cloneDoc) {
            cloneDoc = await PDFDocument.load(originalPdfBytes.slice(0), {
              ignoreEncryption: true,
              throwOnInvalidObject: false,
              capNumbers: true,
            });
          }
          const [copied] = await pdfDoc.copyPages(cloneDoc, [origIdx]);
          copied.setRotation(degrees(targetAngle));
          pdfDoc.insertPage(i, copied);
        }
      }
    } else if (spec.source === 'blank') {
      const w = spec.width || 595.28;
      const h = spec.height || 841.89;
      const page = pdfDoc.insertPage(i, [w, h]);
      if (targetAngle !== 0) {
        page.setRotation(degrees(targetAngle));
      }
    } else if (spec.source === 'imported' && spec.sourceBuffer) {
      let extDoc = externalDocCache.get(spec.sourceBuffer);
      if (!extDoc) {
        extDoc = await PDFDocument.load(spec.sourceBuffer.slice(0), {
          ignoreEncryption: true,
          throwOnInvalidObject: false,
          capNumbers: true,
        });
        externalDocCache.set(spec.sourceBuffer, extDoc);
      }
      const pIdx = spec.sourceDocPageIndex ?? 0;
      if (pIdx >= 0 && pIdx < extDoc.getPageCount()) {
        const [copied] = await pdfDoc.copyPages(extDoc, [pIdx]);
        copied.setRotation(degrees(targetAngle));
        pdfDoc.insertPage(i, copied);
      }
    }
  }

  // Update modification date
  try {
    pdfDoc.setModificationDate(new Date());
  } catch {
    // Ignore date update error
  }

  // Save with standard cross-reference table for universal PDF reader compatibility
  return pdfDoc.save({
    useObjectStreams: false,
  });
}

export interface ReflowParagraph {
  text: string;
  isHeading?: boolean;
}

export interface ReflowPageData {
  pageNumber: number;
  paragraphs: ReflowParagraph[];
  hasText: boolean;
}

/**
 * Extracts and structures text content from a PDF page for responsive reflow reading.
 * Groups positioned text glyphs into semantic lines and paragraphs.
 */
export async function extractPageReflowText(
  data: ArrayBuffer,
  pageNumber: number,
  password?: string
): Promise<ReflowPageData> {
  try {
    const doc = await loadPdfJsDoc(data, password);
    const page = await doc.getPage(pageNumber);
    const textContent = await page.getTextContent();

    if (!textContent || !textContent.items || textContent.items.length === 0) {
      return { pageNumber, paragraphs: [], hasText: false };
    }

    const items: Array<{
      str: string;
      x: number;
      y: number;
      width: number;
      height: number;
      hasEOL: boolean;
    }> = [];

    for (const item of textContent.items as any[]) {
      if ('str' in item && typeof item.str === 'string' && item.str.trim().length > 0) {
        const transform = item.transform || [1, 0, 0, 1, 0, 0];
        items.push({
          str: item.str,
          x: transform[4] || 0,
          y: transform[5] || 0,
          width: item.width || 0,
          height: item.height || Math.abs(transform[3]) || 12,
          hasEOL: !!item.hasEOL,
        });
      }
    }

    if (items.length === 0) {
      return { pageNumber, paragraphs: [], hasText: false };
    }

    // Sort by vertical position (top-to-bottom: higher Y in PDF coordinate system is higher on the page)
    items.sort((a, b) => {
      const yDiff = Math.abs(a.y - b.y);
      if (yDiff < 4) {
        return a.x - b.x;
      }
      return b.y - a.y;
    });

    // Calculate median font height across all items on page
    const allHeights = items.map((it) => it.height).sort((a, b) => a - b);
    const medianHeight = allHeights[Math.floor(allHeights.length / 2)] || 12;

    const paragraphs: ReflowParagraph[] = [];
    let currentParagraphLines: string[] = [];
    let currentLine = '';
    let currentMaxHeight = 0;
    let lastY = items[0].y;
    let lastHeight = items[0].height;

    const finalizeParagraph = () => {
      if (currentLine) {
        currentParagraphLines.push(currentLine.trim());
        currentLine = '';
      }
      if (currentParagraphLines.length > 0) {
        const fullText = currentParagraphLines.join(' ').replace(/\s+/g, ' ').trim();
        if (fullText.length > 0) {
          // A paragraph is only a heading if its font size is distinctly larger than median,
          // it's not a full sentence with terminal punctuation, and has reasonable title length
          const isLargeFont = currentMaxHeight >= medianHeight * 1.35;
          const isShortTitle = fullText.length >= 2 && fullText.length <= 80;
          const hasTerminalPunctuation = /[.,:;?!]$/.test(fullText);
          const isHeading = isLargeFont && isShortTitle && !hasTerminalPunctuation;

          paragraphs.push({
            text: fullText,
            isHeading,
          });
        }
        currentParagraphLines = [];
        currentMaxHeight = 0;
      }
    };

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const yDiff = Math.abs(item.y - lastY);
      const isNewLine = yDiff >= 6;
      const isNewParagraph = yDiff > lastHeight * 1.6 || item.hasEOL;

      if (isNewParagraph && currentLine) {
        finalizeParagraph();
        currentLine = item.str;
        currentMaxHeight = item.height;
      } else if (isNewLine) {
        if (currentLine) {
          currentParagraphLines.push(currentLine.trim());
        }
        currentLine = item.str;
        currentMaxHeight = Math.max(currentMaxHeight, item.height);
      } else {
        if (currentLine && !currentLine.endsWith(' ') && !item.str.startsWith(' ')) {
          currentLine += ' ' + item.str;
        } else {
          currentLine += item.str;
        }
        currentMaxHeight = Math.max(currentMaxHeight, item.height);
      }

      lastY = item.y;
      lastHeight = Math.max(lastHeight, item.height);
    }

    finalizeParagraph();

    return {
      pageNumber,
      paragraphs,
      hasText: paragraphs.length > 0,
    };
  } catch (error) {
    console.warn('Failed to extract text for reflow:', error);
    return { pageNumber, paragraphs: [], hasText: false };
  }
}

/**
 * Cached map of named destinations per document to prevent redundant worker round-trips
 */
const docDestinationsCache = new WeakMap<any, Promise<Record<string, any>>>();

async function getCachedDocDestinations(doc: any): Promise<Record<string, any>> {
  let promise = docDestinationsCache.get(doc);
  if (!promise) {
    promise = (async () => {
      try {
        if (typeof doc.getDestinations === 'function') {
          const dests = await doc.getDestinations();
          return dests || {};
        }
      } catch (e) {
        // graceful destinations lookup fallback
      }
      return {};
    })();
    docDestinationsCache.set(doc, promise);
  }
  return promise;
}

/**
 * Resolves a PDF destination (named string, explicit destination array, or dictionary) to a 1-based target page number.
 * Engineered to handle:
 * - Named destinations (exact, URI-decoded, "#"-stripped, and case-insensitive lookup)
 * - Explicit destination arrays with RefProxy or integer page offsets
 * - Numerical destination values (distinguishing between 0-based page indices and indirect object IDs)
 * - Nested Action dictionaries (/GoTo with /D) and URI hash anchors (#page=12)
 */
export async function resolveDestinationPage(
  doc: any,
  dest: any
): Promise<number | undefined> {
  if (dest === null || dest === undefined) return undefined;
  try {
    // 1. Direct number destination
    if (typeof dest === 'number') {
      if (Number.isInteger(dest)) {
        // If within 1..numPages, could be 1-based or 0-based
        if (dest >= 1 && dest <= doc.numPages) {
          return dest;
        }
        if (dest >= 0 && dest < doc.numPages) {
          return dest + 1;
        }
        // If >= numPages, it is likely an indirect object ID (num)
        try {
          const pIdx = await doc.getPageIndex({ num: dest, gen: 0 });
          if (typeof pIdx === 'number' && pIdx >= 0 && pIdx < doc.numPages) {
            return pIdx + 1;
          }
        } catch {
          // ignore
        }
      }
      return undefined;
    }

    let destArray = dest;

    // 2. Named destination string resolution
    if (typeof dest === 'string') {
      const trimmed = dest.trim();
      if (!trimmed) return undefined;

      // 2a. Direct page notation: "#page=14", "page=14", "page.14", "#14", "page-14"
      const directPageMatch = trimmed.match(/^(?:#|#page=|page=|page[._-]?)(\d+)$/i);
      if (directPageMatch) {
        const pageNum = parseInt(directPageMatch[1], 10);
        if (pageNum >= 1 && pageNum <= doc.numPages) {
          return pageNum;
        }
      }

      // 2b. Standard PDF.js getDestination call
      try {
        destArray = await doc.getDestination(trimmed);
      } catch {
        destArray = null;
      }

      // 2c. Try without leading hashtag (#)
      if (!destArray && trimmed.startsWith('#')) {
        const unhashed = trimmed.replace(/^#+/, '');
        try {
          destArray = await doc.getDestination(unhashed);
        } catch {
          destArray = null;
        }
      }

      // 2d. Try URI decoded string
      if (!destArray) {
        try {
          const decoded = decodeURIComponent(trimmed);
          if (decoded !== trimmed) {
            destArray = await doc.getDestination(decoded);
          }
        } catch {
          // ignore URI error
        }
      }

      // 2e. Check entire document destinations dictionary
      if (!destArray) {
        const allDests = await getCachedDocDestinations(doc);
        if (allDests) {
          if (allDests[trimmed]) {
            destArray = allDests[trimmed];
          } else {
            const clean = trimmed.replace(/^#+/, '');
            if (allDests[clean]) {
              destArray = allDests[clean];
            } else {
              // Case-insensitive lookup
              const lower = clean.toLowerCase();
              for (const key of Object.keys(allDests)) {
                if (key.toLowerCase() === lower) {
                  destArray = allDests[key];
                  break;
                }
              }
            }
          }
        }
      }
    }

    // 3. Unwrap dictionary wrappers (e.g. { D: [...] } or { Dest: [...] })
    if (destArray && !Array.isArray(destArray) && typeof destArray === 'object') {
      if (Array.isArray(destArray.D)) {
        destArray = destArray.D;
      } else if (Array.isArray(destArray.Dest)) {
        destArray = destArray.Dest;
      }
    }

    // 4. Resolve destination array: [ pageRef, /XYZ, left, top, zoom ]
    if (Array.isArray(destArray) && destArray.length > 0) {
      const targetRef = destArray[0];

      // 4a. Target is an object (Ref proxy: { num, gen })
      if (targetRef && typeof targetRef === 'object') {
        // Fast synchronous check if page number was already cached by PDF.js
        if (typeof doc.cachedPageNumber === 'function') {
          try {
            const cached = doc.cachedPageNumber(targetRef);
            if (typeof cached === 'number' && cached >= 1 && cached <= doc.numPages) {
              return cached;
            }
          } catch {
            // ignore
          }
        }

        // Normalize Ref proxy structure with default gen 0
        const refObj = {
          num: typeof targetRef.num === 'number' ? targetRef.num : 0,
          gen: typeof targetRef.gen === 'number' ? targetRef.gen : 0,
        };

        try {
          const pageIdx = await doc.getPageIndex(refObj);
          if (typeof pageIdx === 'number' && !isNaN(pageIdx) && pageIdx >= 0 && pageIdx < doc.numPages) {
            return pageIdx + 1;
          }
        } catch {
          // If direct call fails, check if targetRef.num is itself a page index or object ID
        }
      }

      // 4b. Target is a number
      if (typeof targetRef === 'number') {
        // If within 0..doc.numPages - 1, standard PDF.js treats it as a 0-based page index
        if (targetRef >= 0 && targetRef < doc.numPages) {
          return targetRef + 1;
        }

        // If targetRef >= doc.numPages, it is an indirect object number (num)
        try {
          const pageIdx = await doc.getPageIndex({ num: targetRef, gen: 0 });
          if (typeof pageIdx === 'number' && !isNaN(pageIdx) && pageIdx >= 0 && pageIdx < doc.numPages) {
            return pageIdx + 1;
          }
        } catch {
          // ignore
        }
      }
    }
  } catch (err) {
    console.warn('Destination resolution exception:', err);
  }
  return undefined;
}

/**
 * Extracts interactive link annotations (internal TOC / chapter jumps and external URLs)
 * from a specific PDF page.
 */
export async function extractPageLinks(
  data: ArrayBuffer,
  pageNumber: number,
  password?: string
): Promise<PdfLinkAnnotation[]> {
  try {
    const doc = await loadPdfJsDoc(data, password);
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.0 });
    const annotations = await page.getAnnotations({ intent: 'display' });

    if (!annotations || annotations.length === 0) return [];

    const links: PdfLinkAnnotation[] = [];

    for (let i = 0; i < annotations.length; i++) {
      const annot = annotations[i];
      if (annot.subtype !== 'Link') continue;
      if (!annot.rect || annot.rect.length < 4) continue;

      // Convert PDF coordinate rect to viewport display coordinates
      const vpRect = viewport.convertToViewportRectangle(annot.rect);
      const minX = Math.min(vpRect[0], vpRect[2]);
      const minY = Math.min(vpRect[1], vpRect[3]);
      const width = Math.abs(vpRect[2] - vpRect[0]);
      const height = Math.abs(vpRect[3] - vpRect[1]);

      if (width <= 0 || height <= 0) continue;

      const xPercent = (minX / viewport.width) * 100;
      const yPercent = (minY / viewport.height) * 100;
      const widthPercent = (width / viewport.width) * 100;
      const heightPercent = (height / viewport.height) * 100;

      let targetPage: number | undefined;
      let url: string | undefined;

      // Check Named Actions (e.g. NextPage, PrevPage, FirstPage, LastPage)
      if (annot.action === 'Named' && typeof annot.actionName === 'string') {
        const act = annot.actionName.toLowerCase();
        if (act === 'nextpage') targetPage = Math.min(doc.numPages, pageNumber + 1);
        else if (act === 'prevpage') targetPage = Math.max(1, pageNumber - 1);
        else if (act === 'firstpage') targetPage = 1;
        else if (act === 'lastpage') targetPage = doc.numPages;
      }

      // Check direct destination or action /GoTo
      if (!targetPage) {
        if (annot.dest) {
          targetPage = await resolveDestinationPage(doc, annot.dest);
        } else if (annot.action === 'GoTo' && (annot.A?.D || annot.d)) {
          targetPage = await resolveDestinationPage(doc, annot.A?.D || annot.d);
        }
      }

      // Check URLs: determine if it's an internal reference (e.g. #page=12, #12, file.pdf#page=12)
      if (!targetPage && annot.url) {
        const rawUrl = String(annot.url).trim();
        const pageHashMatch = rawUrl.match(/(?:#|#page=|\.pdf#page=|\.pdf#)(\d+)$/i);
        if (pageHashMatch) {
          const p = parseInt(pageHashMatch[1], 10);
          if (p >= 1 && p <= doc.numPages) {
            targetPage = p;
          }
        } else if (rawUrl.startsWith('#')) {
          targetPage = await resolveDestinationPage(doc, rawUrl.substring(1));
        }

        if (!targetPage) {
          url = rawUrl;
        }
      } else if (!targetPage && !url && annot.unsafeUrl) {
        const rawUnsafe = String(annot.unsafeUrl).trim();
        const match = rawUnsafe.match(/(?:#|#page=|\.pdf#page=|\.pdf#)(\d+)$/i);
        if (match) {
          const p = parseInt(match[1], 10);
          if (p >= 1 && p <= doc.numPages) {
            targetPage = p;
          }
        }
      }

      let title = '';
      if (targetPage) {
        title = `Zu Seite ${targetPage} springen`;
      } else if (url) {
        title = `Link öffnen: ${url}`;
      }

      if (targetPage !== undefined || url) {
        links.push({
          id: `link-${pageNumber}-${i}`,
          pageNumber,
          xPercent,
          yPercent,
          widthPercent,
          heightPercent,
          targetPage,
          url,
          title,
        });
      }
    }

    return links;
  } catch (err) {
    console.warn(`Failed to extract links for page ${pageNumber}:`, err);
    return [];
  }
}

/**
 * Extracts the document outline (embedded Table of Contents tree) from a PDF.
 */
export async function extractDocumentOutline(
  data: ArrayBuffer,
  password?: string
): Promise<PdfOutlineItem[]> {
  try {
    const doc = await loadPdfJsDoc(data, password);
    const outline = await doc.getOutline();
    if (!outline || outline.length === 0) return [];

    async function processOutlineNodes(nodes: any[]): Promise<PdfOutlineItem[]> {
      const results: PdfOutlineItem[] = [];
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        let targetPage: number | undefined;
        let url: string | undefined;

        if (node.url) {
          const rawUrl = String(node.url).trim();
          const match = rawUrl.match(/(?:#|#page=|\.pdf#page=|\.pdf#)(\d+)$/i);
          if (match) {
            const p = parseInt(match[1], 10);
            if (p >= 1 && p <= doc.numPages) {
              targetPage = p;
            }
          } else if (rawUrl.startsWith('#')) {
            targetPage = await resolveDestinationPage(doc, rawUrl.substring(1));
          }
          if (!targetPage) {
            url = rawUrl;
          }
        }

        if (!targetPage && node.dest) {
          targetPage = await resolveDestinationPage(doc, node.dest);
        }

        const childItems =
          node.items && node.items.length > 0
            ? await processOutlineNodes(node.items)
            : undefined;

        results.push({
          id: `toc-${i}-${Math.random().toString(36).substring(2, 7)}`,
          title: node.title ? String(node.title).trim() : 'Untitled Section',
          targetPage,
          url,
          items: childItems,
        });
      }
      return results;
    }

    return await processOutlineNodes(outline);
  } catch (err) {
    console.warn('Failed to extract document outline:', err);
    return [];
  }
}

/**
 * Generates a lightweight JPEG data URL thumbnail of a specific page for recent documents and page overviews.
 */
export async function generatePageThumbnail(
  data: ArrayBuffer,
  pageNumber: number = 1,
  maxWidth: number = 180,
  password?: string
): Promise<string | null> {
  try {
    const pdfDoc = await loadPdfJsDoc(data, password);
    const targetPage = Math.min(Math.max(1, pageNumber), pdfDoc.numPages);
    const page = await pdfDoc.getPage(targetPage);
    const unscaledViewport = page.getViewport({ scale: 1.0 });
    const scale = maxWidth / unscaledViewport.width;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvasContext: ctx,
      viewport,
      intent: 'display',
      background: 'rgba(255, 255, 255, 1)',
    }).promise;

    return canvas.toDataURL('image/jpeg', 0.85);
  } catch (err) {
    console.warn('Failed to generate page thumbnail:', err);
    return null;
  }
}





