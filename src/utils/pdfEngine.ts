import {
  PDFDocument,
  degrees,
  PDFHexString,
  PDFArray,
  StandardFonts,
  rgb,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { SignatureItem, TextOverlayItem, FormFieldItem, FormFieldType, FormValuesState } from '../types';
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

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get canvas context');

    // Pre-paint a solid white background: Adobe Acrobat documents and annotations
    // expect an opaque white base to prevent inverted colors, dark backgrounds, or transparency anomalies
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Render with ENABLE_FORMS to render Adobe Acrobat interactive forms, stamps, and appearance streams
    const annotationMode = (pdfjsLib as any).AnnotationMode?.ENABLE_FORMS ?? 2;
    const renderContext = {
      canvasContext: ctx,
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
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const fallbackRenderContext = {
          canvasContext: ctx,
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


