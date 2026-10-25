import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { computePdfFingerprint } from '../src/utils/recentDocuments';
import { computeDocumentStateSignature } from '../src/hooks/useDocumentHistory';
import {
  buildExportFileName,
  sanitizeFileNamePart,
  parsePageRangeInput,
  formatPageNumbersToRangeString,
  DEFAULT_EXPORT_SETTINGS,
} from '../src/utils/exportSettings';
import {
  embedSignaturesIntoPdf,
  applyPageModifications,
  buildStagedPageExportSnapshot,
} from '../src/utils/pdfExportEngine';
import { savePdfDocumentAs } from '../src/utils/nativeBridge';
import { createAppError, formatAppErrorReport } from '../src/utils/appError';

/**
 * Extracts all raw bytes + decompressed FlateDecode stream contents from a serialized PDF buffer
 * so tests can verify at the binary and object level that confidential strings from removed
 * pages do not exist anywhere in the file.
 */
async function extractFullBinaryAndStreamCorpus(pdfBytes: Uint8Array): Promise<string> {
  const chunks: string[] = [Buffer.from(pdfBytes).toString('latin1')];
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    chunks.push(obj.toString());
    if (obj instanceof PDFRawStream) {
      const raw = Buffer.from(obj.contents);
      chunks.push(raw.toString('latin1'));
      try {
        const inflated = zlib.inflateSync(raw);
        chunks.push(inflated.toString('latin1'));
      } catch {
        // Stream is uncompressed or uses non-zlib encoding
      }
    }
  }
  return chunks.join('\n');
}

/**
 * Checks whether `needle` appears in `corpus` as plain text, Latin-1 hex (<4142...>),
 * or UTF-16BE hex (<00410042...>) as emitted by pdf-lib's font and string encoders.
 */
function corpusContainsPdfString(corpus: string, needle: string): boolean {
  if (corpus.includes(needle)) return true;
  const latin1Hex = Buffer.from(needle, 'latin1').toString('hex');
  if (
    corpus.includes(latin1Hex.toUpperCase()) ||
    corpus.includes(latin1Hex.toLowerCase())
  ) {
    return true;
  }
  const utf16Le = Buffer.from(needle, 'utf16le');
  const utf16Be = Buffer.from(utf16Le);
  utf16Be.swap16();
  const utf16BeHex = utf16Be.toString('hex');
  return (
    corpus.includes(utf16BeHex.toUpperCase()) ||
    corpus.includes(utf16BeHex.toLowerCase())
  );
}

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

test('P0 Privacy & Data Integrity: subset PDF export physically purges all objects, text streams, and form fields of excluded pages', async () => {
  const doc = await PDFDocument.create();
  const page1 = doc.addPage([400, 600]);
  page1.drawText('PUBLIC_CONTRACT_PAGE_1', { x: 50, y: 500, size: 16 });

  const page2 = doc.addPage([400, 600]);
  page2.drawText('CONFIDENTIAL_SECRET_PAGE_2_SALARY_950000', { x: 50, y: 500, size: 16 });

  const page3 = doc.addPage([400, 600]);
  page3.drawText('PUBLIC_APPENDIX_PAGE_3', { x: 50, y: 500, size: 16 });

  const page4 = doc.addPage([400, 600]);
  page4.drawText('INTERNAL_AUDIT_NOTE_PAGE_4_DO_NOT_SHARE', { x: 50, y: 500, size: 16 });

  // Add a cross-page internal link annotation on Page 1 pointing to excluded Page 2
  const linkAnnot = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [50, 450, 200, 470],
    Dest: [page2.ref, 'XYZ', null, null, null],
  });
  const linkRef = doc.context.register(linkAnnot);
  page1.node.addAnnot(linkRef);

  const form = doc.getForm();
  const textFieldP1 = form.createTextField('customer_name');
  textFieldP1.setMaxLength(10);
  textFieldP1.addToPage(page1, { x: 50, y: 400, width: 150, height: 24 });

  // Form field on excluded Page 2 with sensitive initial value
  const secretFieldP2 = form.createTextField('secret_clearance_code');
  secretFieldP2.setText('CLEARANCE_OMEGA_999');
  secretFieldP2.addToPage(page2, { x: 50, y: 400, width: 150, height: 24 });

  const dropdownP3 = form.createDropdown('country');
  dropdownP3.addOptions(['DE', 'AT', 'CH']);
  dropdownP3.addToPage(page3, { x: 50, y: 400, width: 120, height: 24 });

  const rawBytes = await doc.save({ useObjectStreams: false });
  const arrayBuffer = rawBytes.buffer.slice(
    rawBytes.byteOffset,
    rawBytes.byteOffset + rawBytes.byteLength
  ) as ArrayBuffer;

  // Positive control on source PDF: verify all confidential markers ARE detected in the source corpus
  const sourceCorpus = await extractFullBinaryAndStreamCorpus(rawBytes);
  assert.equal(corpusContainsPdfString(sourceCorpus, 'PUBLIC_CONTRACT_PAGE_1'), true);
  assert.equal(corpusContainsPdfString(sourceCorpus, 'CONFIDENTIAL_SECRET_PAGE_2_SALARY_950000'), true);
  assert.equal(corpusContainsPdfString(sourceCorpus, 'INTERNAL_AUDIT_NOTE_PAGE_4_DO_NOT_SHARE'), true);
  assert.equal(corpusContainsPdfString(sourceCorpus, 'secret_clearance_code'), true);
  assert.equal(corpusContainsPdfString(sourceCorpus, 'CLEARANCE_OMEGA_999'), true);

  for (const flattenForm of [true, false]) {
    const exportedBytes = await embedSignaturesIntoPdf(
      arrayBuffer,
      [],
      [
        {
          id: 'txt-p1',
          text: 'VISIBLE_OVERLAY_PAGE_1',
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
          text: 'CONFIDENTIAL_OVERLAY_PAGE_2',
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
        secret_clearance_code: 'CLEARANCE_ALPHA_777',
        country: 'DE',
      },
      {
        selectedPages: [1, 3],
        flattenForm,
      }
    );

    const exportedDoc = await PDFDocument.load(exportedBytes);
    assert.equal(exportedDoc.getPageCount(), 2, 'Exported PDF must contain only the 2 selected pages');

    const corpus = await extractFullBinaryAndStreamCorpus(exportedBytes);

    // Included page contents and overlays must be present
    assert.equal(corpusContainsPdfString(corpus, 'PUBLIC_CONTRACT_PAGE_1'), true, 'Page 1 content must be present');
    assert.equal(corpusContainsPdfString(corpus, 'PUBLIC_APPENDIX_PAGE_3'), true, 'Page 3 content must be present');
    assert.equal(corpusContainsPdfString(corpus, 'VISIBLE_OVERLAY_PAGE_1'), true, 'Page 1 overlay must be present');
    assert.equal(corpusContainsPdfString(corpus, 'AlexanderT'), true, 'Clamped Page 1 form value must be present');

    // Excluded page text streams, form field names, form field values, and overlays must NOT exist anywhere in binary/streams
    assert.equal(
      corpusContainsPdfString(corpus, 'CONFIDENTIAL_SECRET_PAGE_2_SALARY_950000'),
      false,
      `Confidential text from excluded Page 2 must not exist in exported PDF (flattenForm=${flattenForm})`
    );
    assert.equal(
      corpusContainsPdfString(corpus, 'INTERNAL_AUDIT_NOTE_PAGE_4_DO_NOT_SHARE'),
      false,
      `Confidential text from excluded Page 4 must not exist in exported PDF (flattenForm=${flattenForm})`
    );
    assert.equal(
      corpusContainsPdfString(corpus, 'secret_clearance_code'),
      false,
      `Form field name from excluded Page 2 must not exist in exported PDF (flattenForm=${flattenForm})`
    );
    assert.equal(
      corpusContainsPdfString(corpus, 'CLEARANCE_OMEGA_999'),
      false,
      `Initial form value from excluded Page 2 must not exist in exported PDF (flattenForm=${flattenForm})`
    );
    assert.equal(
      corpusContainsPdfString(corpus, 'CLEARANCE_ALPHA_777'),
      false,
      `Updated form value from excluded Page 2 must not exist in exported PDF (flattenForm=${flattenForm})`
    );
    assert.equal(
      corpusContainsPdfString(corpus, 'CONFIDENTIAL_OVERLAY_PAGE_2'),
      false,
      `Overlay from excluded Page 2 must not exist in exported PDF (flattenForm=${flattenForm})`
    );
  }

  // Also verify applyPageModifications purges deleted page objects when deleting pages
  const afterDeleteBytes = await applyPageModifications(arrayBuffer, [
    {
      id: 'p1',
      source: 'existing',
      originalPageIndex: 0,
      rotationAngle: 0,
      rotationDelta: 0,
      width: 400,
      height: 600,
      aspectRatio: 400 / 600,
    },
    {
      id: 'p3',
      source: 'existing',
      originalPageIndex: 2,
      rotationAngle: 90,
      rotationDelta: 90,
      width: 400,
      height: 600,
      aspectRatio: 400 / 600,
    },
  ]);
  const deleteCorpus = await extractFullBinaryAndStreamCorpus(afterDeleteBytes);
  assert.equal(
    corpusContainsPdfString(deleteCorpus, 'PUBLIC_CONTRACT_PAGE_1'),
    true,
    'Surviving Page 1 content must remain present after applyPageModifications'
  );
  assert.equal(
    corpusContainsPdfString(deleteCorpus, 'CONFIDENTIAL_SECRET_PAGE_2_SALARY_950000'),
    false,
    'applyPageModifications must purge deleted page streams from PDF context'
  );
  assert.equal(
    corpusContainsPdfString(deleteCorpus, 'INTERNAL_AUDIT_NOTE_PAGE_4_DO_NOT_SHARE'),
    false,
    'applyPageModifications must purge all deleted pages from PDF context'
  );
});

test('Form modifications & flattening fail explicitly on invalid field updates instead of succeeding silently', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 600]);
  const form = doc.getForm();
  const dropdown = form.createDropdown('country');
  dropdown.addOptions(['DE', 'AT', 'CH']);
  dropdown.addToPage(page, { x: 50, y: 400, width: 120, height: 24 });

  const rawBytes = await doc.save();
  const arrayBuffer = rawBytes.buffer.slice(
    rawBytes.byteOffset,
    rawBytes.byteOffset + rawBytes.byteLength
  ) as ArrayBuffer;

  // 1. Selecting an option that does not exist in dropdown must reject
  await assert.rejects(
    () =>
      embedSignaturesIntoPdf(
        arrayBuffer,
        [],
        [],
        { country: 'INVALID_COUNTRY_OPTION' },
        { flattenForm: true }
      ),
    /Option "INVALID_COUNTRY_OPTION" ist im Auswahlfeld "country" nicht vorhanden/
  );

  // 2. Setting a non-empty value for a non-existent field on an exported page must reject
  await assert.rejects(
    () =>
      embedSignaturesIntoPdf(
        arrayBuffer,
        [],
        [],
        { missing_field_id: 'Important Value' },
        { flattenForm: false }
      ),
    /Formularfeld "missing_field_id" konnte beim Export nicht im PDF gefunden werden/
  );
});

test('buildStagedPageExportSnapshot creates an isolated export snapshot without mutating the working document state', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([400, 600]).drawText('Working Page 1', { x: 50, y: 500, size: 16 });
  doc.addPage([400, 600]).drawText('Working Page 2', { x: 50, y: 500, size: 16 });
  const rawBytes = await doc.save();
  const workingBuffer = rawBytes.buffer.slice(
    rawBytes.byteOffset,
    rawBytes.byteOffset + rawBytes.byteLength
  ) as ArrayBuffer;

  const workingPdfState = {
    file: new File([workingBuffer], 'working.pdf', { type: 'application/pdf' }),
    name: 'working.pdf',
    arrayBuffer: workingBuffer,
    numPages: 2,
    currentPage: 1,
    pageWidth: 400,
    pageHeight: 600,
  };

  const workingTextOverlays = [
    {
      id: 'txt-1',
      text: 'Note on Page 1',
      pageNumber: 1,
      xPercent: 10,
      yPercent: 10,
      widthPercent: 30,
      fontSize: 12,
      fontFamily: 'standard' as const,
      color: 'black' as const,
    },
  ];

  // Stage a rotation and page order swap (Page 2 first, Page 1 second rotated 90°)
  const stagedPages = [
    {
      id: 'spec-p2',
      source: 'existing' as const,
      originalPageIndex: 1,
      rotationAngle: 90,
      rotationDelta: 90,
      width: 400,
      height: 600,
      aspectRatio: 400 / 600,
    },
    {
      id: 'spec-p1',
      source: 'existing' as const,
      originalPageIndex: 0,
      rotationAngle: 90,
      rotationDelta: 90,
      width: 400,
      height: 600,
      aspectRatio: 400 / 600,
    },
  ];

  const snapshot = await buildStagedPageExportSnapshot(
    workingPdfState,
    [],
    workingTextOverlays,
    stagedPages
  );

  // Working document state and overlays must remain 100% untouched
  assert.equal(workingPdfState.arrayBuffer, workingBuffer);
  assert.equal(workingPdfState.currentPage, 1);
  assert.equal(workingTextOverlays[0].pageNumber, 1);

  // Staged snapshot reflects the remapped page position (Page 1 moved to position 2)
  assert.notEqual(snapshot.pdfState.arrayBuffer, workingBuffer);
  assert.equal(snapshot.textOverlays[0].pageNumber, 2);
});

test('savePdfDocumentAs enforces requestId correlation, concurrency lock, timeout, and finally cleanup', async () => {
  const originalWindow = (globalThis as any).window;
  let capturedRequestId: string | null = null;
  let cancelledRequestId: string | null = null;

  try {
    // 1. Test requestId correlation (ignoring stale callback from another requestId)
    (globalThis as any).window = {
      NativePdfBridge: {
        beginSaveAsRequest: (reqId: string) => {
          capturedRequestId = reqId;
          return true;
        },
        cancelSaveAsRequest: (reqId: string) => {
          cancelledRequestId = reqId;
        },
        beginPdfTransfer: () => 'tok_1',
        appendPdfChunk: () => true,
        finishPdfTransfer: () => {
          setTimeout(() => {
            // Fire a stale callback with wrong requestId first (must be ignored)
            (globalThis as any).window.onNativeSaveAsCompleted?.(false, 'stale_req_id_999');
            // Then fire the matching requestId with true
            (globalThis as any).window.onNativeSaveAsCompleted?.(true, capturedRequestId);
          }, 15);
          return true;
        },
        cancelPdfTransfer: () => {},
      },
      addEventListener: () => {},
      removeEventListener: () => {},
    };

    const res = await savePdfDocumentAs('test.pdf', new Uint8Array([1, 2, 3]), {
      requestId: 'req_test_1',
      timeoutMs: 1000,
    });
    assert.equal(res.success, true);
    assert.equal(res.method, 'native-android-picker');
    assert.equal(capturedRequestId, 'req_test_1');
    assert.equal(cancelledRequestId, 'req_test_1');
    assert.equal(
      (globalThis as any).window.onNativeSaveAsCompleted,
      undefined,
      'Global callback must be cleaned up in finally'
    );

    // 2. Test timeout and concurrent-call rejection when Android picker hangs
    (globalThis as any).window.NativePdfBridge.finishPdfTransfer = () => true; // Never calls onNativeSaveAsCompleted
    const hangingPromise = savePdfDocumentAs('hang.pdf', new Uint8Array([1, 2, 3]), {
      requestId: 'req_hang',
      timeoutMs: 40,
    });

    // Concurrent call while hangingPromise is active must reject immediately
    await assert.rejects(
      () => savePdfDocumentAs('concurrent.pdf', new Uint8Array([1, 2, 3])),
      /bereits aktiv/
    );

    // Hanging promise must time out cleanly and release the lock
    await assert.rejects(hangingPromise, /Zeitüberschreitung/);
    assert.equal(
      (globalThis as any).window.onNativeSaveAsCompleted,
      undefined,
      'Global callback must be cleaned up after timeout'
    );
  } finally {
    (globalThis as any).window = originalWindow;
  }
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

