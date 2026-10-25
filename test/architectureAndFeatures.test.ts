import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { computePdfFingerprint } from '../src/utils/recentDocuments';
import { computeDocumentStateSignature } from '../src/hooks/useDocumentHistory';
import {
  buildExportFileName,
  sanitizeFileNamePart,
  parsePageRangeInput,
  formatPageNumbersToRangeString,
  DEFAULT_EXPORT_SETTINGS,
} from '../src/utils/exportSettings';
import { embedSignaturesIntoPdf } from '../src/utils/pdfExportEngine';
import { createAppError, formatAppErrorReport } from '../src/utils/appError';

test('computePdfFingerprint distinguishes different PDFs with identical byteLength (<= 2 MB and > 2 MB)', async () => {
  const bufA = new Uint8Array(1024);
  const bufB = new Uint8Array(1024);
  bufA.fill(0x41);
  bufB.fill(0x41);
  bufB[512] = 0x42; // 1 byte difference, identical byteLength

  const fpA1 = await computePdfFingerprint(bufA.buffer);
  const fpA2 = await computePdfFingerprint(bufA.slice().buffer);
  const fpB = await computePdfFingerprint(bufB.buffer);

  assert.equal(fpA1, fpA2, 'Identical buffers must yield identical fingerprint');
  assert.notEqual(fpA1, fpB, 'Distinct buffers of identical size must not collide');

  // > 2 MB multi-slice sampling check
  const largeSize = 3 * 1024 * 1024;
  const largeA = new Uint8Array(largeSize);
  const largeB = new Uint8Array(largeSize);
  largeB[Math.floor(largeSize / 2)] = 0x99; // Difference in middle slice
  const fpLargeA = await computePdfFingerprint(largeA.buffer);
  const fpLargeB = await computePdfFingerprint(largeB.buffer);
  assert.notEqual(fpLargeA, fpLargeB, 'Large (>2 MB) buffers differing in middle slice must not collide');
});

test('computeDocumentStateSignature deterministically tracks edits, docRevisionId, and signature metadata', () => {
  const initialSig = computeDocumentStateSignature('rev_1', [], [], { name: 'Max' });
  const rotatedPageDocSig = computeDocumentStateSignature('rev_2', [], [], { name: 'Max' });
  assert.notEqual(
    initialSig,
    rotatedPageDocSig,
    'Changing docRevisionId alone (e.g. page rotation without overlays) must update state signature'
  );

  const editedSig = computeDocumentStateSignature(
    'rev_1',
    [],
    [
      {
        id: 't1',
        text: 'Confirmed',
        pageNumber: 1,
        xPercent: 20,
        yPercent: 30,
        widthPercent: 25,
        fontSize: 14,
        fontFamily: 'standard',
        color: 'black',
      },
    ],
    { name: 'Max' }
  );

  assert.notEqual(initialSig, editedSig, 'Adding text overlay must change state signature');

  const sigItemA = {
    id: 's1',
    name: 'Paraphe',
    transparentDataUrl: 'data:image/png;base64,AA==',
    pngBytes: new Uint8Array([1, 2, 3]),
    originalDataUrl: 'data:image/png;base64,AA==',
    pageNumber: 1,
    xPercent: 50,
    yPercent: 50,
    widthPercent: 28,
    aspectRatio: 2,
    opacity: 1,
    rotation: 0,
  };
  const sigItemB = {
    ...sigItemA,
    pngBytes: new Uint8Array([1, 2, 3, 4, 5]),
  };
  assert.notEqual(
    computeDocumentStateSignature('rev_1', [sigItemA], [], {}),
    computeDocumentStateSignature('rev_1', [sigItemB], [], {}),
    'Replacing signature binary payload must update state signature'
  );

  const undoneSig = computeDocumentStateSignature('rev_1', [], [], { name: 'Max' });
  assert.equal(initialSig, undoneSig, 'Undoing back to initial state must restore saved state signature');
});

test('parsePageRangeInput and buildExportFileName handle page subsets, naming templates, and unsafe characters', () => {
  const valid = parsePageRangeInput('1-3, 5, 2', 6);
  assert.equal(valid.error, null);
  assert.deepEqual(valid.pages, [1, 2, 3, 5]);
  assert.equal(formatPageNumbersToRangeString(valid.pages), '1-3, 5');

  const outOfBounds = parsePageRangeInput('1-8', 5);
  assert.notEqual(outOfBounds.error, null);

  const reversedRange = parsePageRangeInput('4-2', 5);
  assert.notEqual(reversedRange.error, null);

  const emptyRange = parsePageRangeInput('   ', 5);
  assert.notEqual(emptyRange.error, null);

  const fixedDate = new Date(2026, 9, 25); // 2026-10-25
  assert.equal(
    buildExportFileName('Vertrag.pdf', DEFAULT_EXPORT_SETTINGS),
    'Vertrag_unterschrieben'
  );
  assert.equal(
    buildExportFileName(
      'Vertrag.pdf',
      { namingPreset: 'date_prefix', customSuffix: '_neu', defaultFlattenForms: false },
      'S1-3',
      fixedDate
    ),
    '2026-10-25_Vertrag_S1-3'
  );
  assert.equal(
    buildExportFileName('Vertrag.pdf', {
      namingPreset: 'custom_suffix',
      customSuffix: 'geprueft',
      defaultFlattenForms: true,
    }),
    'Vertrag_geprueft'
  );

  // Path traversal / invalid character sanitization
  assert.equal(sanitizeFileNamePart('Rechnung:2026/04*Test?.pdf'), 'Rechnung_2026_04_Test_.pdf');
  assert.equal(
    buildExportFileName('A/B:C.pdf', {
      namingPreset: 'custom_suffix',
      customSuffix: 'v1:final/ok',
      defaultFlattenForms: false,
    }),
    'A_B_C_v1_final_ok'
  );
});

test('embedSignaturesIntoPdf exports selected pages only and hardens AcroForm values', async () => {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 4; i++) {
    const page = doc.addPage([400, 600]);
    page.drawText(`Original Page ${i + 1}`, { x: 50, y: 500, size: 16 });
  }
  const form = doc.getForm();
  const textField = form.createTextField('customer_name');
  textField.setMaxLength(10);
  textField.addToPage(doc.getPage(0), { x: 50, y: 400, width: 150, height: 24 });

  const dropdown = form.createDropdown('country');
  dropdown.addOptions(['DE', 'AT', 'CH']);
  dropdown.addToPage(doc.getPage(2), { x: 50, y: 400, width: 120, height: 24 });

  const rawBytes = await doc.save();
  const arrayBuffer = rawBytes.buffer.slice(
    rawBytes.byteOffset,
    rawBytes.byteOffset + rawBytes.byteLength
  ) as ArrayBuffer;

  // Export only pages 1 and 3, with overlong text and an invalid dropdown option that must be safely ignored
  const exportedBytes = await embedSignaturesIntoPdf(
    arrayBuffer,
    [],
    [
      {
        id: 'txt-p1',
        text: 'Overlay on Page 1',
        pageNumber: 1,
        xPercent: 10,
        yPercent: 20,
        widthPercent: 40,
        fontSize: 12,
        fontFamily: 'standard',
        color: 'blue',
      },
      {
        id: 'txt-p2',
        text: 'Overlay on Page 2 (should be excluded)',
        pageNumber: 2,
        xPercent: 10,
        yPercent: 20,
        widthPercent: 40,
        fontSize: 12,
        fontFamily: 'standard',
        color: 'red',
      },
    ],
    {
      customer_name: 'AlexanderTheGreatTooLong',
      country: 'INVALID_OPTION',
    },
    {
      selectedPages: [1, 3],
      flattenForm: true,
    }
  );

  const exportedDoc = await PDFDocument.load(exportedBytes);
  assert.equal(exportedDoc.getPageCount(), 2, 'Exported PDF must contain only the 2 selected pages');
});

test('createAppError and formatAppErrorReport generate structured diagnostics', () => {
  const err = createAppError(
    'PDF_EXPORT_FAILED',
    'Export fehlgeschlagen',
    'Die Datei konnte nicht erzeugt werden.',
    new Error('Test stack error'),
    { pages: 4 }
  );
  const report = formatAppErrorReport(err);
  assert.match(report, /PDF_EXPORT_FAILED/);
  assert.match(report, /Test stack error/);
  assert.match(report, /"pages":4/);
});
