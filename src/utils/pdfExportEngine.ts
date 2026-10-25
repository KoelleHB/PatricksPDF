import {
  PDFDocument,
  degrees,
  PDFHexString,
  PDFArray,
  StandardFonts,
  rgb,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { SignatureItem, TextOverlayItem, FormValuesState } from '../types';

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
 * Embeds transparent signatures, custom text overlays (Regular & Script font in Black, Blue, or Red),
 * and fills native interactive AcroForm fields with optional flattening and optional page subset filtering.
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

  const selectedPageSet =
    options.selectedPages && options.selectedPages.length > 0
      ? new Set(
          options.selectedPages.filter(
            (p) => Number.isInteger(p) && p >= 1 && p <= pdfDoc.getPageCount()
          )
        )
      : null;

  // 1. Process Native AcroForm Fields if values are provided
  try {
    const form = pdfDoc.getForm();
    if (form) {
      const formEntries = Object.entries(formValues || {});
      for (const [name, val] of formEntries) {
        if (val === undefined || val === null) continue;
        try {
          const field = form.getFieldMaybe(name);
          if (!field) continue;
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
              }
            } else if (Array.isArray(val) && val.length > 0) {
              const validSelections = availableOptions
                ? val.filter((v) => availableOptions.includes(v))
                : val;
              if (validSelections.length > 0) {
                (field as any).select(validSelections);
              }
            }
          }
        } catch (fieldErr) {
          console.warn(`Could not set form field "${name}":`, fieldErr);
        }
      }

      if (formEntries.length > 0 || options.flattenForm) {
        try {
          const appearanceFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
          form.updateFieldAppearances(appearanceFont);
        } catch (appearanceErr) {
          console.warn('Could not refresh AcroForm appearances:', appearanceErr);
        }
      }

      if (options.flattenForm) {
        try {
          form.flatten();
        } catch (flattenErr) {
          console.warn(
            'Could not flatten all form fields at once, keeping unflattened fallback:',
            flattenErr
          );
        }
      }
    }
  } catch (formErr) {
    console.warn('AcroForm processing skipped:', formErr);
  }

  // 2. Embed Text Overlays (Regular Helvetica & Script Caveat font)
  if (textOverlays && textOverlays.length > 0) {
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

    const blackColor = rgb(0.04, 0.04, 0.05);
    const blueColor = rgb(0.12, 0.23, 0.54);
    const redColor = rgb(0.86, 0.15, 0.15);

    for (const textItem of textOverlays) {
      if (
        !textItem.text ||
        textItem.pageNumber < 1 ||
        textItem.pageNumber > pdfDoc.getPageCount()
      ) {
        continue;
      }
      if (selectedPageSet && !selectedPageSet.has(textItem.pageNumber)) {
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

  // 3. Embed Transparent Signatures
  for (const sig of signatures) {
    if (sig.pageNumber < 1 || sig.pageNumber > pdfDoc.getPageCount()) {
      continue;
    }
    if (selectedPageSet && !selectedPageSet.has(sig.pageNumber)) {
      continue;
    }

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

  // 3b. If a subset of pages was requested, remove unselected pages in reverse order
  if (selectedPageSet && selectedPageSet.size > 0 && selectedPageSet.size < pdfDoc.getPageCount()) {
    for (let pIdx = pdfDoc.getPageCount() - 1; pIdx >= 0; pIdx--) {
      if (!selectedPageSet.has(pIdx + 1)) {
        pdfDoc.removePage(pIdx);
      }
    }
  }

  // 4. Preserve original document metadata while setting ModificationDate
  try {
    pdfDoc.setModificationDate(new Date());
  } catch (e) {
    console.warn('Could not set modification date on PDF:', e);
  }

  // 5. Preserve and refresh Trailer /ID [permanentId, revisionId]
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

  return pdfDoc.save({
    useObjectStreams: false,
  });
}
