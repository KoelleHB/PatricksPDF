import {
  PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber,
  PDFRef, PDFString,
} from 'pdf-lib';
import type { PdfLinkAnnotation } from '../types';

/**
 * Independent low-level link extraction: does not rely on PDF.js getAnnotations.
 * This is a fallback for valid PDFs whose link annotations are not exposed by
 * a particular PDF.js build or action variant.
 *
 * Read-only, cached once per original ArrayBuffer; no PDF content is uploaded.
 */
let rawDocumentCache = new WeakMap<ArrayBuffer, Promise<PDFDocument>>();

function getDocument(data: ArrayBuffer): Promise<PDFDocument> {
  let promise = rawDocumentCache.get(data);
  if (!promise) {
    promise = PDFDocument.load(data, { updateMetadata: false }).catch(error => {
      rawDocumentCache.delete(data);
      throw error;
    });
    rawDocumentCache.set(data, promise);
  }
  return promise;
}

const key = (ref: PDFRef) => ref.toString();

function readPdfString(value: unknown): string | undefined {
  if (value instanceof PDFString || value instanceof PDFHexString) {
    return value.decodeText();
  }
  return undefined;
}

function secureExternalUrl(candidate: string | undefined): string | undefined {
  if (!candidate) return undefined;
  try {
    const parsed = new URL(candidate.trim());
    if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
        parsed.hostname) return parsed.href;
  } catch {
    // Invalid or unsupported external action; do not launch arbitrary schemes.
  }
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  return value instanceof PDFNumber ? value.asNumber() : undefined;
}

function resolveInternalPage(
  pdf: PDFDocument,
  dest: unknown,
  pagesByRef: Map<string, number>,
): number | undefined {
  if (!dest) return undefined;
  const resolved = pdf.context.lookup(dest as any);
  if (!(resolved instanceof PDFArray) || resolved.size() === 0) return undefined;

  // PDF /Dest: [indirect page reference, /XYZ or /Fit, ...].
  // Numeric page indices in PDF destination arrays are zero-based.
  const ref = resolved.get(0);
  if (ref instanceof PDFRef) return pagesByRef.get(key(ref));
  const number = asNumber(ref);
  if (number !== undefined && Number.isInteger(number) &&
      number >= 0 && number < pdf.getPageCount()) return number + 1;
  return undefined;
}

function findAction(pdf: PDFDocument, annotation: PDFDict): PDFDict | undefined {
  const ref = annotation.get(PDFName.of('A'));
  if (!ref) return undefined;
  const action = pdf.context.lookup(ref);
  return action instanceof PDFDict ? action : undefined;
}

/**
 * Return percentage-based clickable boxes, including ordinary /GoTo and /URI
 * actions. Rotated pages are mapped to the same viewport orientation as PDF.js.
 */
export async function extractRawPdfLinks(
  data: ArrayBuffer,
  pageNumber: number,
): Promise<PdfLinkAnnotation[]> {
  if (pageNumber < 1) return [];
  const pdf = await getDocument(data);
  const pages = pdf.getPages();
  const page = pages[pageNumber - 1];
  if (!page) return [];
  const annots = page.node.Annots();
  if (!annots) return [];

  const pageRefs = new Map(pages.map((item, index) => [key(item.ref), index + 1]));
  const crop = page.getCropBox();
  if (!(crop.width > 0) || !(crop.height > 0)) return [];
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;

  const result: PdfLinkAnnotation[] = [];
  for (let index = 0; index < annots.size(); index++) {
    const raw = pdf.context.lookup(annots.get(index));
    if (!(raw instanceof PDFDict) ||
        raw.get(PDFName.of('Subtype'))?.toString() !== '/Link') continue;

    const rect = pdf.context.lookup(raw.get(PDFName.of('Rect')) as any);
    if (!(rect instanceof PDFArray) || rect.size() < 4) continue;
    const coords = [0, 1, 2, 3].map(i => asNumber(rect.lookup(i)));
    if (coords.some(n => n === undefined || !Number.isFinite(n))) continue;
    const [x1, y1, x2, y2] = coords as number[];
    const left = (Math.min(x1, x2) - crop.x) / crop.width;
    const right = (Math.max(x1, x2) - crop.x) / crop.width;
    const bottom = (Math.min(y1, y2) - crop.y) / crop.height;
    const top = (Math.max(y1, y2) - crop.y) / crop.height;
    if (right <= left || top <= bottom) continue;

    // PDF coordinates are bottom-left. CSS page coordinates are top-left.
    let bx = left, by = 1 - top, bw = right - left, bh = top - bottom;
    if (rotation === 90) {
      [bx, by, bw, bh] = [bottom, left, top - bottom, right - left];
    } else if (rotation === 180) {
      [bx, by, bw, bh] = [1 - right, bottom, right - left, top - bottom];
    } else if (rotation === 270) {
      [bx, by, bw, bh] = [1 - top, 1 - right, top - bottom, right - left];
    }

    const action = findAction(pdf, raw);
    const actionType = action?.get(PDFName.of('S'))?.toString();
    const destination = raw.get(PDFName.of('Dest')) ||
      (actionType === '/GoTo' ? action?.get(PDFName.of('D')) : undefined);

    let targetPage = resolveInternalPage(pdf, destination, pageRefs);
    let url: string | undefined;

    if (!targetPage && actionType === '/URI') {
      const candidate = readPdfString(pdf.context.lookup(action?.get(PDFName.of('URI')) as any));
      url = secureExternalUrl(candidate);
    }
    if (!targetPage && actionType === '/Named') {
      const named = action?.get(PDFName.of('N'))?.toString();
      if (named === '/NextPage') targetPage = Math.min(pageNumber + 1, pages.length);
      else if (named === '/PrevPage') targetPage = Math.max(pageNumber - 1, 1);
      else if (named === '/FirstPage') targetPage = 1;
      else if (named === '/LastPage') targetPage = pages.length;
    }

    if (!targetPage && !url) continue;
    result.push({
      id: `link-${pageNumber}-raw-${index}`,
      pageNumber,
      xPercent: bx * 100,
      yPercent: by * 100,
      widthPercent: bw * 100,
      heightPercent: bh * 100,
      targetPage,
      url,
      title: targetPage ? `Zu Seite ${targetPage} springen` : `Link öffnen: ${url}`,
    });
  }
  return result;
}
