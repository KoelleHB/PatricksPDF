import {
  PDFDocument,
  degrees,
  PDFHexString,
  PDFArray,
  PDFDict,
  PDFName,
  PDFRef,
  StandardFonts,
  rgb,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { SignatureItem, TextOverlayItem, FormValuesState, PageSpec } from '../types';

// Cache for Caveat script font ArrayBuffer
let cachedScriptFontBytes: ArrayBuffer | null = null;

async function getScriptFontBytes(): Promise<ArrayBuffer> {
  if (cachedScriptFontBytes) return cachedScriptFontBytes;
  try {
    const res = await fetch('/Caveat-Regular.ttf');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    cachedScriptFontBytes = await res.arrayBuffer();
    return cachedScriptFontBytes;
  } catch {
    throw new Error(
      'Lokale Schriftdatei Caveat-Regular.ttf konnte nicht geladen werden. Bitte die App neu installieren oder den PWA-Cache aktualisieren.'
    );
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
  const box = cropBox || mediaBox;
  const originX = (box && box.x) || 0;
  const originY = (box && box.y) || 0;
  const boxWidth = (box && box.width) || page.getWidth();
  const boxHeight = (box && box.height) || page.getHeight();

  const isTransposed = rotation === 90 || rotation === 270;
  const visWidth = isTransposed ? boxHeight : boxWidth;
  const visHeight = isTransposed ? boxWidth : boxHeight;

  const w_vis = (widthPercent / 100) * visWidth;
  const h_vis = w_vis / aspectRatio;
  const x_vis = (xPercent / 100) * visWidth;
  const y_vis = (yPercent / 100) * visHeight;

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
 * Calculates text placement for rotated and offset pages with sub-pixel typography alignment.
 */
export function calculatePdfTextPlacement(
  page: any,
  xPercent: number,
  yPercent: number,
  fontSize: number,
  lineIndex: number = 0,
  lineHeight: number = 0
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
  const baselineOffset = fontSize * 0.925;
  const y_vis =
    (yPercent / 100) * visHeight + baselineOffset + lineIndex * (lineHeight || fontSize * 1.25);

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
  /** Optional 1-based page numbers to include in the exported PDF (subset export) */
  selectedPages?: number[];
}

/**
 * Checks whether a PDF object (e.g. a Link destination array or Action dictionary)
 * references any excluded page PDFRef.
 */
function referencesAnyExcludedPage(
  context: PDFDocument['context'],
  obj: any,
  excludedPageRefs: Set<PDFRef>,
  visited = new Set<any>()
): boolean {
  if (!obj || visited.has(obj)) return false;
  visited.add(obj);

  if (obj instanceof PDFRef) {
    if (excludedPageRefs.has(obj)) return true;
    const resolved = context.lookup(obj);
    return resolved ? referencesAnyExcludedPage(context, resolved, excludedPageRefs, visited) : false;
  }

  if (obj instanceof PDFArray) {
    for (let i = 0; i < obj.size(); i++) {
      if (referencesAnyExcludedPage(context, obj.get(i), excludedPageRefs, visited)) {
        return true;
      }
    }
    return false;
  }

  if (obj instanceof PDFDict) {
    const dest = obj.get(PDFName.of('Dest')) || obj.get(PDFName.of('D'));
    if (dest && referencesAnyExcludedPage(context, dest, excludedPageRefs, visited)) {
      return true;
    }
    const action = obj.get(PDFName.of('A'));
    if (action && referencesAnyExcludedPage(context, action, excludedPageRefs, visited)) {
      return true;
    }
  }

  return false;
}

/**
 * Purges excluded page contents, resources, and annotations from the source PDFDocument
 * and severs cross-page references on selected pages prior to copying into a fresh PDFDocument.
 */
export function isolateSelectedPagesInSourceDoc(
  pdfDoc: PDFDocument,
  selectedPageSet: Set<number>
): void {
  const pages = pdfDoc.getPages();
  const excludedPageRefs = new Set<PDFRef>();
  const selectedAnnotRefs = new Set<PDFRef>();
  const selectedAnnotDicts = new Set<any>();

  for (let pIdx = 0; pIdx < pages.length; pIdx++) {
    const page = pages[pIdx];
    const pageNum = pIdx + 1;
    if (!selectedPageSet.has(pageNum)) {
      excludedPageRefs.add(page.ref);
    } else {
      const rawAnnots = page.node.Annots();
      const annots = rawAnnots ? pdfDoc.context.lookup(rawAnnots) : null;
      if (annots instanceof PDFArray) {
        for (let i = 0; i < annots.size(); i++) {
          const item = annots.get(i);
          if (item instanceof PDFRef) {
            selectedAnnotRefs.add(item);
          }
          const resolved = pdfDoc.context.lookup(item);
          if (resolved) {
            selectedAnnotDicts.add(resolved);
          }
        }
      }
    }
  }

  // 1. Strip all streams, resources, and annotations from excluded pages so they can never be transitively copied
  for (let pIdx = 0; pIdx < pages.length; pIdx++) {
    const pageNum = pIdx + 1;
    if (selectedPageSet.has(pageNum)) continue;

    const page = pages[pIdx];
    const rawContents = page.node.get(PDFName.of('Contents'));
    if (rawContents instanceof PDFRef) {
      pdfDoc.context.delete(rawContents);
    } else {
      const resolvedContents = rawContents ? pdfDoc.context.lookup(rawContents) : null;
      if (resolvedContents instanceof PDFArray) {
        for (let i = 0; i < resolvedContents.size(); i++) {
          const item = resolvedContents.get(i);
          if (item instanceof PDFRef) pdfDoc.context.delete(item);
        }
      }
    }

    const rawAnnots = page.node.get(PDFName.of('Annots'));
    const resolvedAnnots = rawAnnots ? pdfDoc.context.lookup(rawAnnots) : null;
    if (resolvedAnnots instanceof PDFArray) {
      for (let i = 0; i < resolvedAnnots.size(); i++) {
        const item = resolvedAnnots.get(i);
        if (item instanceof PDFRef && !selectedAnnotRefs.has(item)) {
          pdfDoc.context.delete(item);
        }
      }
    }
    if (rawAnnots instanceof PDFRef) {
      pdfDoc.context.delete(rawAnnots);
    }

    page.node.delete(PDFName.of('Contents'));
    page.node.delete(PDFName.of('Resources'));
    page.node.delete(PDFName.of('Annots'));
    page.node.delete(PDFName.of('B'));
    page.node.delete(PDFName.of('Thumb'));
    page.node.delete(PDFName.of('PieceInfo'));
    page.node.delete(PDFName.of('StructParents'));
  }

  // 2. Sanitize selected pages to sever any references to excluded pages or excluded widgets
  for (let pIdx = 0; pIdx < pages.length; pIdx++) {
    const pageNum = pIdx + 1;
    if (!selectedPageSet.has(pageNum)) continue;

    const page = pages[pIdx];
    page.node.delete(PDFName.of('B'));
    page.node.delete(PDFName.of('StructParents'));

    const rawAnnots = page.node.Annots();
    const annots = rawAnnots ? pdfDoc.context.lookup(rawAnnots) : null;
    if (annots instanceof PDFArray) {
      for (let i = annots.size() - 1; i >= 0; i--) {
        const annotItem = annots.get(i);
        const annotDict = pdfDoc.context.lookup(annotItem);
        if (!(annotDict instanceof PDFDict)) continue;

        // If annotation points to an excluded page via /Dest or /A, remove the link annotation
        if (referencesAnyExcludedPage(pdfDoc.context, annotDict, excludedPageRefs)) {
          annots.remove(i);
          continue;
        }

        const pRef = annotDict.get(PDFName.of('P'));
        if (pRef instanceof PDFRef && excludedPageRefs.has(pRef)) {
          annotDict.delete(PDFName.of('P'));
        }

        // If widget has a /Parent field dictionary, prune /Kids to only widgets on selected pages
        const parentRef = annotDict.get(PDFName.of('Parent'));
        const parentDict = parentRef ? pdfDoc.context.lookup(parentRef) : null;
        if (parentDict instanceof PDFDict) {
          const parentPageRef = parentDict.get(PDFName.of('P'));
          if (parentPageRef instanceof PDFRef && excludedPageRefs.has(parentPageRef)) {
            parentDict.delete(PDFName.of('P'));
          }
          const rawKids = parentDict.get(PDFName.of('Kids'));
          const kids = rawKids ? pdfDoc.context.lookup(rawKids) : null;
          if (kids instanceof PDFArray) {
            for (let k = kids.size() - 1; k >= 0; k--) {
              const kidItem = kids.get(k);
              const kidDict = pdfDoc.context.lookup(kidItem);
              const keepKid =
                (kidItem instanceof PDFRef && selectedAnnotRefs.has(kidItem)) ||
                (kidDict && selectedAnnotDicts.has(kidDict));
              if (!keepKid) {
                kids.remove(k);
              }
            }
          }
        }
      }
    }
  }
}

/**
 * Reconstructs a clean /AcroForm dictionary in `freshDoc` containing ONLY the interactive
 * widget/field objects that actually exist on `freshDoc`'s pages.
 */
export function rebuildAcroFormForCopiedPages(freshDoc: PDFDocument): void {
  const pages = freshDoc.getPages();
  const fieldRefs: PDFRef[] = [];
  const seenRefs = new Set<PDFRef>();

  for (const page of pages) {
    const rawAnnots = page.node.Annots();
    const annots = rawAnnots ? freshDoc.context.lookup(rawAnnots) : null;
    if (!(annots instanceof PDFArray)) continue;

    for (let i = 0; i < annots.size(); i++) {
      const annotItem = annots.get(i);
      const annotDict = freshDoc.context.lookup(annotItem);
      if (!(annotDict instanceof PDFDict)) continue;

      const subtype = annotDict.get(PDFName.of('Subtype'));
      if (subtype !== PDFName.of('Widget')) continue;

      // Update /P to point to the new page ref in freshDoc
      annotDict.set(PDFName.of('P'), page.ref);

      const parentRef = annotDict.get(PDFName.of('Parent'));
      if (parentRef instanceof PDFRef) {
        if (!seenRefs.has(parentRef)) {
          seenRefs.add(parentRef);
          fieldRefs.push(parentRef);
        }
      } else if (annotItem instanceof PDFRef) {
        if (!seenRefs.has(annotItem)) {
          seenRefs.add(annotItem);
          fieldRefs.push(annotItem);
        }
      }
    }
  }

  if (fieldRefs.length > 0) {
    const fieldsArray = PDFArray.withContext(freshDoc.context);
    for (const ref of fieldRefs) {
      fieldsArray.push(ref);
    }
    const acroFormDict = freshDoc.context.obj({
      Fields: fieldsArray,
    });
    freshDoc.catalog.set(PDFName.of('AcroForm'), freshDoc.context.register(acroFormDict));
  }
}

/**
 * Embeds transparent signatures, custom text overlays (Regular & Script font in Black, Blue, or Red),
 * and fills native interactive AcroForm fields with optional flattening and optional page subset filtering.
 *
 * When `options.selectedPages` specifies a subset of pages, only the selected pages and their
 * associated resources/annotations are copied into a fresh `PDFDocument`, guaranteeing that
 * no objects, text streams, or form values from excluded pages remain in the exported binary.
 */
export async function embedSignaturesIntoPdf(
  originalPdfBytes: ArrayBuffer,
  signatures: SignatureItem[],
  textOverlays: TextOverlayItem[] = [],
  formValues: FormValuesState = {},
  options: ExportPdfOptions = {}
): Promise<Uint8Array> {
  if (!originalPdfBytes || originalPdfBytes.byteLength === 0) {
    throw new Error('Die PDF-Quelldaten sind leer oder ungültig.');
  }

  const copy = originalPdfBytes.slice(0);

  let pdfDoc: PDFDocument;
  try {
    pdfDoc = await PDFDocument.load(copy, {
      ignoreEncryption: false,
      updateMetadata: false,
      throwOnInvalidObject: false,
      capNumbers: true,
    });
  } catch (err: any) {
    if (err?.name === 'EncryptedPDFError' || /encrypt/i.test(String(err?.message || ''))) {
      throw new Error(
        'Diese PDF ist verschlüsselt oder bearbeitungsgeschützt. PatricksPDF kann sie anzeigen, aber mit pdf-lib nicht sicher bearbeiten oder neu speichern. Bitte verwende eine vom Rechteinhaber zur Bearbeitung freigegebene, unverschlüsselte PDF.'
      );
    }
    throw err;
  }

  pdfDoc.registerFontkit(fontkit);

  const totalPages = pdfDoc.getPageCount();
  let selectedPagesList: number[] | null = null;
  if (options.selectedPages !== undefined) {
    const valid = Array.from(
      new Set(
        options.selectedPages.filter(
          (p) => Number.isInteger(p) && p >= 1 && p <= totalPages
        )
      )
    ).sort((a, b) => a - b);

    if (valid.length === 0) {
      throw new Error('Keine gültigen Seiten für den Teil-Export ausgewählt.');
    }
    if (valid.length < totalPages) {
      selectedPagesList = valid;
    }
  }

  const selectedPageSet = selectedPagesList ? new Set(selectedPagesList) : null;

  // 1. Process Native AcroForm Fields if present or if formValues were supplied
  const hasCatalogAcroForm = Boolean(pdfDoc.catalog.lookup(PDFName.of('AcroForm')));
  const formEntries = Object.entries(formValues || {}).filter(
    ([, val]) => val !== undefined && val !== null
  );

  if (hasCatalogAcroForm || formEntries.length > 0) {
    const form = pdfDoc.getForm();
    const pages = pdfDoc.getPages();

    // Map each widget dictionary/ref and page ref to its 1-based page number
    const pageRefToPageNum = new Map<any, number>();
    const annotToPageNum = new Map<any, number>();
    for (let pIdx = 0; pIdx < pages.length; pIdx++) {
      const page = pages[pIdx];
      const pageNum = pIdx + 1;
      pageRefToPageNum.set(page.ref, pageNum);
      const rawAnnots = page.node.Annots();
      const annots = rawAnnots ? pdfDoc.context.lookup(rawAnnots) : null;
      if (annots instanceof PDFArray) {
        for (let j = 0; j < annots.size(); j++) {
          const item = annots.get(j);
          const resolved = pdfDoc.context.lookup(item);
          if (item) annotToPageNum.set(item, pageNum);
          if (resolved) annotToPageNum.set(resolved, pageNum);
        }
      }
    }

    const excludedFieldNames = new Set<string>();
    const existingFields = form.getFields();

    if (selectedPageSet && existingFields.length > 0) {
      for (const field of existingFields) {
        const widgets = (field as any).acroField?.getWidgets?.() || [];
        let hasWidgetOnSelectedPage = false;
        for (const w of widgets) {
          const pNum =
            annotToPageNum.get(w.dict) ??
            (typeof w.P === 'function' ? pageRefToPageNum.get(w.P()) : undefined);
          if (pNum === undefined || selectedPageSet.has(pNum)) {
            hasWidgetOnSelectedPage = true;
            break;
          }
        }
        if (!hasWidgetOnSelectedPage) {
          excludedFieldNames.add(field.getName());
          try {
            form.removeField(field);
          } catch {
            // Field will also be excluded when copying selected pages to freshDoc
          }
        }
      }
    }

    let modifiedOrHasActiveFields = existingFields.length > excludedFieldNames.size;

    for (const [name, val] of formEntries) {
      if (selectedPageSet && excludedFieldNames.has(name)) {
        continue;
      }

      const field = form.getFieldMaybe(name);
      if (!field) {
        const isNonEmptyValue =
          val !== '' && val !== false && !(Array.isArray(val) && val.length === 0);
        if (isNonEmptyValue) {
          throw new Error(
            `Formularfeld "${name}" konnte beim Export nicht im PDF gefunden werden.`
          );
        }
        continue;
      }

      modifiedOrHasActiveFields = true;

      try {
        if ('setText' in field && typeof (field as any).setText === 'function') {
          let textVal = String(val ?? '');
          if (typeof (field as any).getMaxLength === 'function') {
            const maxLen = (field as any).getMaxLength();
            if (typeof maxLen === 'number' && maxLen > 0 && textVal.length > maxLen) {
              textVal = textVal.slice(0, maxLen);
            }
          }
          (field as any).setText(textVal);
        } else if ('check' in field && 'uncheck' in field) {
          if (val === true || val === 'true' || val === 'Yes') {
            (field as any).check();
          } else {
            (field as any).uncheck();
          }
        } else if ('select' in field && typeof (field as any).select === 'function') {
          const availableOptions: string[] | null =
            typeof (field as any).getOptions === 'function'
              ? (field as any).getOptions() || []
              : null;

          if (typeof val === 'string') {
            if (!val) {
              if (typeof (field as any).clear === 'function') {
                (field as any).clear();
              }
            } else if (
              !availableOptions ||
              availableOptions.length === 0 ||
              availableOptions.includes(val)
            ) {
              (field as any).select(val);
            } else {
              throw new Error(
                `Die Option "${val}" ist im Auswahlfeld "${name}" nicht vorhanden.`
              );
            }
          } else if (Array.isArray(val) && val.length > 0) {
            if (availableOptions && availableOptions.length > 0) {
              const invalid = val.filter((v) => !availableOptions.includes(v));
              if (invalid.length > 0) {
                throw new Error(
                  `Ungültige Auswahl (${invalid.join(', ')}) für Formularfeld "${name}".`
                );
              }
            }
            (field as any).select(val);
          }
        }
      } catch (fieldErr: any) {
        throw new Error(
          `Formularfeld "${name}" konnte beim Export nicht gesetzt werden: ${
            fieldErr?.message || String(fieldErr)
          }`
        );
      }
    }

    if (modifiedOrHasActiveFields && (formEntries.length > 0 || options.flattenForm)) {
      try {
        const appearanceFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
        form.updateFieldAppearances(appearanceFont);
      } catch (appearanceErr: any) {
        throw new Error(
          `Formulardarstellung konnte beim Export nicht aktualisiert werden: ${
            appearanceErr?.message || String(appearanceErr)
          }`
        );
      }
    }

    if (options.flattenForm && modifiedOrHasActiveFields && form.getFields().length > 0) {
      try {
        form.flatten();
      } catch (flattenErr: any) {
        throw new Error(
          `Formularfelder konnten beim Export nicht abgeflacht (flattened) werden: ${
            flattenErr?.message || String(flattenErr)
          }`
        );
      }
    }
  }

  // 2. If exporting a page subset, copy ONLY the selected pages into a brand-new PDFDocument
  // so no indirect objects, text streams, or form fields from excluded pages remain in the binary.
  let targetDoc: PDFDocument = pdfDoc;
  const origPageNumToTargetIdx = new Map<number, number>();

  if (selectedPagesList && selectedPageSet) {
    isolateSelectedPagesInSourceDoc(pdfDoc, selectedPageSet);

    const freshDoc = await PDFDocument.create();
    freshDoc.registerFontkit(fontkit);

    const selectedZeroBasedIndices = selectedPagesList.map((p) => p - 1);
    const copiedPages = await freshDoc.copyPages(pdfDoc, selectedZeroBasedIndices);
    copiedPages.forEach((copiedPage, newIdx) => {
      freshDoc.addPage(copiedPage);
      origPageNumToTargetIdx.set(selectedPagesList![newIdx], newIdx);
    });

    if (!options.flattenForm && hasCatalogAcroForm) {
      rebuildAcroFormForCopiedPages(freshDoc);
    }

    // Preserve basic document info metadata on the fresh subset document
    try {
      const title = pdfDoc.getTitle();
      if (title) freshDoc.setTitle(title);
      const author = pdfDoc.getAuthor();
      if (author) freshDoc.setAuthor(author);
      const subject = pdfDoc.getSubject();
      if (subject) freshDoc.setSubject(subject);
      const creator = pdfDoc.getCreator();
      if (creator) freshDoc.setCreator(creator);
      const producer = pdfDoc.getProducer();
      if (producer) freshDoc.setProducer(producer);
    } catch {
      // Optional metadata copy
    }

    targetDoc = freshDoc;
  } else {
    for (let p = 1; p <= totalPages; p++) {
      origPageNumToTargetIdx.set(p, p - 1);
    }
  }

  // 3. Embed Text Overlays onto targetDoc (only for included pages)
  const activeTextOverlays = (textOverlays || []).filter(
    (t) => Boolean(t.text) && origPageNumToTargetIdx.has(t.pageNumber)
  );

  if (activeTextOverlays.length > 0) {
    const helveticaFont = await targetDoc.embedFont(StandardFonts.Helvetica);
    let scriptFont: any = null;
    const hasScript = activeTextOverlays.some((t) => t.fontFamily === 'script');
    if (hasScript) {
      try {
        const fontBytes = await getScriptFontBytes();
        scriptFont = await targetDoc.embedFont(fontBytes);
      } catch (fontErr) {
        console.warn('Failed to embed script font, falling back to Times Roman:', fontErr);
        scriptFont = await targetDoc.embedFont(StandardFonts.TimesRomanItalic);
      }
    }

    const blackColor = rgb(0.04, 0.04, 0.05);
    const blueColor = rgb(0.12, 0.23, 0.54);
    const redColor = rgb(0.86, 0.15, 0.15);

    for (const textItem of activeTextOverlays) {
      const targetPageIdx = origPageNumToTargetIdx.get(textItem.pageNumber);
      if (targetPageIdx === undefined) continue;

      const page = targetDoc.getPage(targetPageIdx);
      const font = textItem.fontFamily === 'script' && scriptFont ? scriptFont : helveticaFont;
      const color =
        textItem.color === 'red'
          ? redColor
          : textItem.color === 'blue'
          ? blueColor
          : blackColor;
      const effectiveSize =
        textItem.fontFamily === 'script' ? textItem.fontSize * 1.25 : textItem.fontSize;

      const lines = textItem.text.split('\n');
      const lineHeight = effectiveSize * 1.25;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line && i > 0) continue;

        const linePlacement = calculatePdfTextPlacement(
          page,
          textItem.xPercent,
          textItem.yPercent,
          effectiveSize,
          i,
          lineHeight
        );

        page.drawText(line, {
          x: linePlacement.x,
          y: linePlacement.y,
          size: effectiveSize,
          font: font,
          color: color,
          rotate: linePlacement.rotate,
        });
      }
    }
  }

  // 4. Embed Transparent Signatures onto targetDoc (only for included pages)
  for (const sig of signatures) {
    const targetPageIdx = origPageNumToTargetIdx.get(sig.pageNumber);
    if (targetPageIdx === undefined) continue;

    const embeddedImage = await targetDoc.embedPng(sig.pngBytes);
    const page = targetDoc.getPage(targetPageIdx);

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

  // 5. Preserve original document metadata while setting ModificationDate
  try {
    targetDoc.setModificationDate(new Date());
  } catch (e) {
    console.warn('Could not set modification date on PDF:', e);
  }

  // 6. Preserve and refresh Trailer /ID [permanentId, revisionId]
  try {
    const existingId = pdfDoc.context.trailerInfo.ID;
    const generateHexId = () => {
      const bytes = new Uint8Array(16);
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        crypto.getRandomValues(bytes);
      } else {
        for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
      }
      return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    };

    const newRevId = PDFHexString.of(generateHexId());
    const idArray = PDFArray.withContext(targetDoc.context);

    if (!selectedPagesList && existingId instanceof PDFArray && existingId.size() > 0) {
      idArray.push(existingId.get(0));
    } else {
      idArray.push(PDFHexString.of(generateHexId()));
    }
    idArray.push(newRevId);
    targetDoc.context.trailerInfo.ID = idArray;
  } catch (e) {
    console.warn('Could not update trailer /ID:', e);
  }

  return targetDoc.save({
    useObjectStreams: false,
  });
}

async function loadUnencryptedPdfForModification(bytes: ArrayBuffer): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes.slice(0), {
      ignoreEncryption: false,
      updateMetadata: false,
      throwOnInvalidObject: false,
      capNumbers: true,
    });
  } catch (err: any) {
    if (err?.name === 'EncryptedPDFError' || /encrypt/i.test(String(err?.message || ''))) {
      throw new Error(
        'Diese PDF ist verschlüsselt oder bearbeitungsgeschützt. PatricksPDF kann sie anzeigen, aber mit pdf-lib nicht sicher bearbeiten oder neu speichern. Bitte verwende eine vom Rechteinhaber zur Bearbeitung freigegebene, unverschlüsselte PDF.'
      );
    }
    throw err;
  }
}

/**
 * Executes arbitrary page management operations: reordering, deletion, blank page insertions,
 * external PDF page imports, and 90° step rotations.
 * When any original pages are deleted, copies surviving pages into a fresh PDFDocument so
 * no indirect objects from removed pages remain in the resulting PDF bytes.
 */
export async function applyPageModifications(
  originalPdfBytes: ArrayBuffer,
  pages: PageSpec[]
): Promise<Uint8Array> {
  if (!pages || pages.length === 0) {
    throw new Error('A PDF document must have at least one page.');
  }

  const pdfDoc = await loadUnencryptedPdfForModification(originalPdfBytes);

  const originalPageCount = pdfDoc.getPageCount();
  const survivingOneBasedSet = new Set<number>();
  for (const spec of pages) {
    if (
      spec.source === 'existing' &&
      spec.originalPageIndex >= 0 &&
      spec.originalPageIndex < originalPageCount
    ) {
      survivingOneBasedSet.add(spec.originalPageIndex + 1);
    }
  }

  const hasDeletedOriginalPages = survivingOneBasedSet.size < originalPageCount;
  const externalDocCache = new Map<ArrayBuffer, PDFDocument>();

  if (hasDeletedOriginalPages) {
    if (survivingOneBasedSet.size > 0) {
      isolateSelectedPagesInSourceDoc(pdfDoc, survivingOneBasedSet);
    }

    const freshDoc = await PDFDocument.create();
    for (let i = 0; i < pages.length; i++) {
      const spec = pages[i];
      const targetAngle = ((spec.rotationAngle % 360) + 360) % 360;

      if (spec.source === 'existing') {
        const origIdx = spec.originalPageIndex;
        if (origIdx >= 0 && origIdx < originalPageCount) {
          const [copied] = await freshDoc.copyPages(pdfDoc, [origIdx]);
          copied.setRotation(degrees(targetAngle));
          freshDoc.insertPage(i, copied);
        }
      } else if (spec.source === 'blank') {
        const w = spec.width || 595.28;
        const h = spec.height || 841.89;
        const page = freshDoc.insertPage(i, [w, h]);
        if (targetAngle !== 0) {
          page.setRotation(degrees(targetAngle));
        }
      } else if (spec.source === 'imported' && spec.sourceBuffer) {
        let extDoc = externalDocCache.get(spec.sourceBuffer);
        if (!extDoc) {
          extDoc = await loadUnencryptedPdfForModification(spec.sourceBuffer);
          externalDocCache.set(spec.sourceBuffer, extDoc);
        }
        const pIdx = spec.sourceDocPageIndex ?? 0;
        if (pIdx >= 0 && pIdx < extDoc.getPageCount()) {
          const [copied] = await freshDoc.copyPages(extDoc, [pIdx]);
          copied.setRotation(degrees(targetAngle));
          freshDoc.insertPage(i, copied);
        }
      }
    }

    rebuildAcroFormForCopiedPages(freshDoc);

    try {
      const title = pdfDoc.getTitle();
      if (title) freshDoc.setTitle(title);
      const author = pdfDoc.getAuthor();
      if (author) freshDoc.setAuthor(author);
      const subject = pdfDoc.getSubject();
      if (subject) freshDoc.setSubject(subject);
      freshDoc.setModificationDate(new Date());
    } catch {
      // Ignore metadata copy error
    }

    return freshDoc.save({
      useObjectStreams: false,
    });
  }

  let cloneDoc: PDFDocument | null = null;
  const originalPages = pdfDoc.getPages();
  const usedOriginalIndices = new Set<number>();

  while (pdfDoc.getPageCount() > 0) {
    pdfDoc.removePage(0);
  }

  for (let i = 0; i < pages.length; i++) {
    const spec = pages[i];
    const targetAngle = ((spec.rotationAngle % 360) + 360) % 360;

    if (spec.source === 'existing') {
      const origIdx = spec.originalPageIndex;
      if (origIdx >= 0 && origIdx < originalPages.length) {
        if (!usedOriginalIndices.has(origIdx)) {
          const page = originalPages[origIdx];
          page.setRotation(degrees(targetAngle));
          pdfDoc.insertPage(i, page);
          usedOriginalIndices.add(origIdx);
        } else {
          if (!cloneDoc) {
            cloneDoc = await loadUnencryptedPdfForModification(originalPdfBytes);
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
        extDoc = await loadUnencryptedPdfForModification(spec.sourceBuffer);
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

  try {
    pdfDoc.setModificationDate(new Date());
  } catch {
    // Ignore date update error
  }

  return pdfDoc.save({
    useObjectStreams: false,
  });
}

export interface StagedPageExportSnapshot {
  pdfState: {
    file: File;
    name: string;
    arrayBuffer: ArrayBuffer;
    numPages: number;
    currentPage: number;
    pageWidth: number;
    pageHeight: number;
  };
  signatures: SignatureItem[];
  textOverlays: TextOverlayItem[];
  hasPageModifications: boolean;
}

/**
 * Builds an isolated, temporary export snapshot from uncommitted `PageSpec[]` in PageManagementModal
 * without mutating the active working document, undo/redo history, or saved status.
 */
export async function buildStagedPageExportSnapshot(
  workingPdfState: StagedPageExportSnapshot['pdfState'],
  workingSignatures: SignatureItem[],
  workingTextOverlays: TextOverlayItem[],
  stagedPages: PageSpec[]
): Promise<StagedPageExportSnapshot> {
  const modifiedBytes = await applyPageModifications(workingPdfState.arrayBuffer, stagedPages);
  const newBuffer = modifiedBytes.buffer.slice(
    modifiedBytes.byteOffset,
    modifiedBytes.byteOffset + modifiedBytes.byteLength
  ) as ArrayBuffer;

  const oldToNewPageMap = new Map<number, number>();
  stagedPages.forEach((spec, idx) => {
    if (spec.source === 'existing' && !oldToNewPageMap.has(spec.originalPageIndex + 1)) {
      oldToNewPageMap.set(spec.originalPageIndex + 1, idx + 1);
    }
  });

  const mappedSignatures = stagedPages.flatMap((spec, idx) => {
    if (spec.source !== 'existing') return [];
    return workingSignatures
      .filter((s) => s.pageNumber === spec.originalPageIndex + 1)
      .map((s) => ({
        ...s,
        id: idx + 1 === oldToNewPageMap.get(s.pageNumber) ? s.id : `${s.id}-copy-${spec.id}`,
        pageNumber: idx + 1,
      }));
  });

  const mappedTextOverlays = stagedPages.flatMap((spec, idx) => {
    if (spec.source !== 'existing') return [];
    return workingTextOverlays
      .filter((t) => t.pageNumber === spec.originalPageIndex + 1)
      .map((t) => ({
        ...t,
        id: idx + 1 === oldToNewPageMap.get(t.pageNumber) ? t.id : `${t.id}-copy-${spec.id}`,
        pageNumber: idx + 1,
      }));
  });

  const numPages = stagedPages.length;
  let nextCurrentPage = oldToNewPageMap.get(workingPdfState.currentPage) || 1;
  if (nextCurrentPage > numPages) nextCurrentPage = numPages;

  return {
    pdfState: {
      ...workingPdfState,
      arrayBuffer: newBuffer,
      numPages,
      currentPage: nextCurrentPage,
    },
    signatures: mappedSignatures,
    textOverlays: mappedTextOverlays,
    hasPageModifications: true,
  };
}
