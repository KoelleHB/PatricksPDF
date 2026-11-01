import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { PDFArray, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFString } from 'pdf-lib';
import {
  applyHideActionToVisibility,
  isFormFieldVisible,
  readFormActions,
} from '../src/utils/pdfFormActions';
import { embedSignaturesIntoPdf } from '../src/utils/pdfExportEngine';
import { extractPdfFormFieldsViaPdfLib as extractPdfFormFields } from '../src/utils/pdfFormFormatting';
import { computeDocumentStateSignature } from '../src/hooks/useDocumentHistory';
import {
  getDocumentDraft,
  resetRecentDocumentsMemoryStoreForTests,
  saveDocumentDraft,
} from '../src/utils/recentDocuments';

async function extractDecompressedStreamText(pdfBytes: Uint8Array): Promise<string> {
  const chunks: string[] = [Buffer.from(pdfBytes).toString('latin1')];
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    chunks.push(obj.toString());
    if (obj instanceof PDFRawStream) {
      const raw = Buffer.from(obj.contents);
      chunks.push(raw.toString('latin1'));
      try {
        chunks.push(zlib.inflateSync(raw).toString('latin1'));
      } catch {
        // non-zlib stream
      }
    }
  }
  return chunks.join('\n');
}

function corpusContainsString(corpus: string, needle: string): boolean {
  if (corpus.includes(needle)) return true;
  const hex = Buffer.from(needle, 'latin1').toString('hex');
  return corpus.toLowerCase().includes(hex.toLowerCase());
}

test('reads declarative hide and selective reset actions without interpreting JavaScript', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const form = doc.getForm();
  const button = form.createButton('hide');
  button.addToPage('Hide', page);
  const widget = button.acroField.getWidgets()[0];
  widget.dict.set(PDFName.of('A'), doc.context.obj({ S: 'Hide', T: PDFString.of('group.item'), H: false }));
  const reset = form.createButton('reset');
  reset.addToPage('Reset', page);
  reset.acroField.getWidgets()[0].dict.set(PDFName.of('A'), doc.context.obj({ S: 'ResetForm', Fields: [PDFString.of('group')], Flags: 1 }));
  const script = form.createButton('script');
  script.addToPage('Script', page);
  script.acroField.getWidgets()[0].dict.set(PDFName.of('A'), doc.context.obj({ S: 'JavaScript', JS: PDFString.of('app.alert(1)') }));
  const data = await doc.save();
  const actionMap = await readFormActions(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
  const actions = [...actionMap.values()].filter((v, i, a) => a.findIndex(t => t.type === v.type && JSON.stringify(t) === JSON.stringify(v)) === i);
  assert.deepEqual(actions, [
    { type: 'hide', targets: ['group.item'], hide: false },
    { type: 'reset', fields: ['group'], exclude: true },
  ]);
  assert.ok(actionMap.has('name:hide'));
  assert.ok(actionMap.has('name:reset'));
  assert.deepEqual(actionMap.get('name:hide'), { type: 'hide', targets: ['group.item'], hide: false });
});

test('resolves multi-level /Parent hierarchies, indirect PDFRef action targets, multiple widgets,同-leaf name isolation, and cyclic references safely', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([500, 500]);
  const annots = PDFArray.withContext(doc.context);
  page.node.set(PDFName.of('Annots'), annots);

  // 1. Multi-level hierarchy: billing.address.street vs shipping.address.street (same leaf name "street")
  const billingRoot = doc.context.register(doc.context.obj({ T: PDFString.of('billing') }));
  const billingAddress = doc.context.register(
    doc.context.obj({ T: PDFString.of('address'), Parent: billingRoot })
  );
  const billingStreetField = doc.context.register(
    doc.context.obj({
      Subtype: 'Widget',
      FT: 'Tx',
      T: PDFString.of('street'),
      Parent: billingAddress,
      Rect: [20, 20, 120, 40],
    })
  );
  annots.push(billingStreetField);

  const shippingRoot = doc.context.register(doc.context.obj({ T: PDFString.of('shipping') }));
  const shippingAddress = doc.context.register(
    doc.context.obj({ T: PDFString.of('address'), Parent: shippingRoot })
  );
  const shippingStreetField = doc.context.register(
    doc.context.obj({
      Subtype: 'Widget',
      FT: 'Tx',
      T: PDFString.of('street'),
      Parent: shippingAddress,
      Rect: [20, 60, 120, 80],
    })
  );
  annots.push(shippingStreetField);

  // 2. Button whose /A is on its parent field dictionary and targets `billingStreetField` via indirect PDFRef!
  const hideParentDict = doc.context.obj({
    FT: 'Btn',
    Ff: 65536,
    T: PDFString.of('toggleBillingBtn'),
    A: doc.context.obj({
      S: 'Hide',
      T: [billingStreetField], // Indirect PDFRef instead of string!
      H: true,
    }),
  });
  const hideParentRef = doc.context.register(hideParentDict);
  const hideWidgetDict = doc.context.obj({
    Subtype: 'Widget',
    Parent: hideParentRef,
    Rect: [150, 20, 220, 40],
  });
  const hideWidgetRef = doc.context.register(hideWidgetDict);
  hideParentDict.set(PDFName.of('Kids'), doc.context.obj([hideWidgetRef]));
  annots.push(hideWidgetRef);

  // 3. Button with /AA -> /U (Mouse Up) ResetForm referencing `shippingAddress` via indirect PDFRef
  const resetWidgetRef = doc.context.register(
    doc.context.obj({
      Subtype: 'Widget',
      FT: 'Btn',
      Ff: 65536,
      T: PDFString.of('resetShippingBtn'),
      Rect: [150, 60, 220, 80],
      AA: doc.context.obj({
        U: doc.context.obj({
          S: 'ResetForm',
          Fields: [shippingAddress],
          Flags: 0,
        }),
      }),
    })
  );
  annots.push(resetWidgetRef);

  // 4. Multi-widget field with two distinct widgets having different actions (must resolve per widget ref without colliding on field name)
  const multiParentRef = doc.context.register(
    doc.context.obj({
      FT: 'Btn',
      Ff: 65536,
      T: PDFString.of('multiActionBtn'),
    })
  );
  const multiWidget1Ref = doc.context.register(
    doc.context.obj({
      Subtype: 'Widget',
      Parent: multiParentRef,
      Rect: [250, 20, 300, 40],
      A: doc.context.obj({ S: 'Hide', T: PDFString.of('billing.address.street'), H: true }),
    })
  );
  const multiWidget2Ref = doc.context.register(
    doc.context.obj({
      Subtype: 'Widget',
      Parent: multiParentRef,
      Rect: [250, 60, 300, 80],
      A: doc.context.obj({ S: 'Hide', T: PDFString.of('shipping.address.street'), H: false }),
    })
  );
  annots.push(multiWidget1Ref);
  annots.push(multiWidget2Ref);

  // 5. Cyclic /Parent reference (must terminate cleanly without infinite recursion)
  const cycleADict = doc.context.obj({
    Subtype: 'Widget',
    FT: 'Btn',
    T: PDFString.of('cycleA'),
    Rect: [320, 20, 360, 40],
    A: doc.context.obj({ S: 'Hide', T: PDFString.of('billing'), H: true }),
  });
  const cycleARef = doc.context.register(cycleADict);
  const cycleBDict = doc.context.obj({
    T: PDFString.of('cycleB'),
    Parent: cycleARef,
  });
  const cycleBRef = doc.context.register(cycleBDict);
  cycleADict.set(PDFName.of('Parent'), cycleBRef);
  annots.push(cycleARef);

  // 6. Action with /Next chain or Launch/URI/SubmitForm must be ignored for form actions
  const chainedWidgetRef = doc.context.register(
    doc.context.obj({
      Subtype: 'Widget',
      FT: 'Btn',
      T: PDFString.of('chainedBtn'),
      Rect: [320, 60, 360, 80],
      A: doc.context.obj({
        S: 'Hide',
        T: PDFString.of('billing'),
        Next: doc.context.obj({ S: 'JavaScript', JS: PDFString.of('app.alert(1)') }),
      }),
    })
  );
  annots.push(chainedWidgetRef);

  const saved = await doc.save();
  const buffer = saved.buffer.slice(saved.byteOffset, saved.byteOffset + saved.byteLength) as ArrayBuffer;
  const actionMap = await readFormActions(buffer);

  // Indirect PDFRef target resolved to full hierarchical name `billing.address.street`
  assert.deepEqual(actionMap.get('name:toggleBillingBtn'), {
    type: 'hide',
    targets: ['billing.address.street'],
    hide: true,
  });
  assert.deepEqual(actionMap.get(`${hideWidgetRef.objectNumber}R`), {
    type: 'hide',
    targets: ['billing.address.street'],
    hide: true,
  });

  // /AA -> /U ResetForm resolved indirect ref to `shipping.address`
  assert.deepEqual(actionMap.get('name:resetShippingBtn'), {
    type: 'reset',
    fields: ['shipping.address'],
    exclude: false,
  });

  // Multi-widget field with conflicting actions: widget refs are mapped individually, ambiguous name fallback is omitted
  assert.deepEqual(actionMap.get(`${multiWidget1Ref.objectNumber}R`), {
    type: 'hide',
    targets: ['billing.address.street'],
    hide: true,
  });
  assert.deepEqual(actionMap.get(`${multiWidget2Ref.objectNumber}R`), {
    type: 'hide',
    targets: ['shipping.address.street'],
    hide: false,
  });
  assert.equal(actionMap.has('name:multiActionBtn'), false);

  // Chained /Next action is rejected
  assert.equal(actionMap.has('name:chainedBtn'), false);
});

test('full formVisibility integration: initial flags, /Hide state changes, Undo/Redo, isSaved, Draft save/restore, and non-flattened vs flattened export', async () => {
  resetRecentDocumentsMemoryStoreForTests();

  // 1. Build a synthetic PDF with:
  // - visibleField ("PUBLIC_VISIBLE_VALUE")
  // - dynamicHideA ("DYNAMIC_HIDE_VALUE_A")
  // - dynamicHideB ("DYNAMIC_HIDE_VALUE_B")
  // - initiallySecret ("ORIGINALLY_HIDDEN_SECRET", /F = 2 Hidden flag set in PDF)
  const doc = await PDFDocument.create();
  const page = doc.addPage([500, 500]);
  const form = doc.getForm();

  const visibleField = form.createTextField('visibleField');
  visibleField.addToPage(page, { x: 30, y: 400, width: 150, height: 24 });
  visibleField.setText('PUBLIC_VISIBLE_VALUE');

  const dynamicHideA = form.createTextField('dynamicHideA');
  dynamicHideA.addToPage(page, { x: 30, y: 350, width: 150, height: 24 });
  dynamicHideA.setText('DYNAMIC_HIDE_VALUE_A');

  const dynamicHideB = form.createTextField('dynamicHideB');
  dynamicHideB.addToPage(page, { x: 30, y: 300, width: 150, height: 24 });
  dynamicHideB.setText('DYNAMIC_HIDE_VALUE_B');

  const initiallySecret = form.createTextField('initiallySecret');
  initiallySecret.addToPage(page, { x: 30, y: 250, width: 150, height: 24 });
  initiallySecret.setText('ORIGINALLY_HIDDEN_SECRET');
  // Set PDF Annotation Flag Bit 2 (Hidden = 2) on initiallySecret
  initiallySecret.acroField.getWidgets()[0].dict.set(PDFName.of('F'), PDFNumber.of(2));

  const hideBothBtn = form.createButton('hideBothBtn');
  hideBothBtn.addToPage('Hide A & B', page, { x: 30, y: 200, width: 100, height: 24 });
  hideBothBtn.acroField.getWidgets()[0].dict.set(
    PDFName.of('A'),
    doc.context.obj({
      S: 'Hide',
      T: [PDFString.of('dynamicHideA'), PDFString.of('dynamicHideB')],
      H: true,
    })
  );

  const rawPdfBytes = await doc.save({ updateFieldAppearances: false });
  const baseBuffer = rawPdfBytes.buffer.slice(
    rawPdfBytes.byteOffset,
    rawPdfBytes.byteOffset + rawPdfBytes.byteLength
  ) as ArrayBuffer;

  // 2. Open form and check initial visibility
  const { fields: extractedFields, initialValues } = await extractPdfFormFields(baseBuffer);
  const byName = new Map(extractedFields.map((f) => [f.name, f]));

  assert.equal(byName.get('visibleField')?.initiallyHidden, false);
  assert.equal(byName.get('dynamicHideA')?.initiallyHidden, false);
  assert.equal(byName.get('dynamicHideB')?.initiallyHidden, false);
  assert.equal(byName.get('initiallySecret')?.initiallyHidden, true);

  let currentVisibility: Record<string, boolean> = {};
  assert.equal(isFormFieldVisible(byName.get('visibleField')!, currentVisibility), true);
  assert.equal(isFormFieldVisible(byName.get('dynamicHideA')!, currentVisibility), true);
  assert.equal(isFormFieldVisible(byName.get('dynamicHideB')!, currentVisibility), true);
  assert.equal(isFormFieldVisible(byName.get('initiallySecret')!, currentVisibility), false);

  const initialStateSig = computeDocumentStateSignature(
    'rev_1',
    [],
    [],
    initialValues,
    currentVisibility
  );

  // 3. Hide multiple fields (dynamicHideA & dynamicHideB) via /Hide action
  const hideAction = byName.get('hideBothBtn')?.action;
  assert.deepEqual(hideAction, {
    type: 'hide',
    targets: ['dynamicHideA', 'dynamicHideB'],
    hide: true,
  });

  const step1 = applyHideActionToVisibility(currentVisibility, hideAction!, extractedFields);
  assert.equal(step1.changed, true, '/Hide must be detected as state-changing');
  currentVisibility = step1.nextVisibility;
  assert.deepEqual(currentVisibility, { dynamicHideA: false, dynamicHideB: false });

  // Clicking the same /Hide button again when already hidden is a no-op
  const noopRepeat = applyHideActionToVisibility(currentVisibility, hideAction!, extractedFields);
  assert.equal(noopRepeat.changed, false, 'Repeated identical /Hide must not create redundant history state');

  // Verify document state signature marks the document as modified (unsaved)
  const hiddenStateSig = computeDocumentStateSignature(
    'rev_1',
    [],
    [],
    initialValues,
    currentVisibility
  );
  assert.notEqual(hiddenStateSig, initialStateSig, 'Visibility change must mark document as unsaved');

  // 4. Simulate Undo & Redo of the visibility snapshot
  const undoStack = [{ formVisibility: {} as Record<string, boolean> }, { formVisibility: currentVisibility }];
  // Undo -> index 0
  const undoneVisibility = undoStack[0].formVisibility;
  assert.equal(isFormFieldVisible(byName.get('dynamicHideA')!, undoneVisibility), true);
  assert.equal(isFormFieldVisible(byName.get('dynamicHideB')!, undoneVisibility), true);
  assert.equal(isFormFieldVisible(byName.get('initiallySecret')!, undoneVisibility), false);
  assert.equal(
    computeDocumentStateSignature('rev_1', [], [], initialValues, undoneVisibility),
    initialStateSig,
    'Undo must restore saved state signature'
  );

  // Redo -> index 1
  const redoneVisibility = undoStack[1].formVisibility;
  assert.equal(isFormFieldVisible(byName.get('dynamicHideA')!, redoneVisibility), false);
  assert.equal(isFormFieldVisible(byName.get('dynamicHideB')!, redoneVisibility), false);
  assert.equal(isFormFieldVisible(byName.get('initiallySecret')!, redoneVisibility), false);

  // 5. Save and restore Draft (verifying dynamic visibility persists and initiallySecret stays hidden)
  await saveDocumentDraft({
    id: 'doc_vis_test',
    name: 'visibility-form.pdf',
    originalBuffer: baseBuffer,
    isUnsavedDraft: true,
    currentPage: 1,
    numPages: 1,
    hasPageModifications: false,
    signatures: [],
    textOverlays: [],
    formValues: initialValues,
    formVisibility: redoneVisibility,
  });

  const restoredDraft = await getDocumentDraft('doc_vis_test');
  assert.ok(restoredDraft, 'Draft with visibility changes alone must be persisted');
  assert.deepEqual(restoredDraft.formVisibility, { dynamicHideA: false, dynamicHideB: false });
  assert.equal(
    isFormFieldVisible(byName.get('initiallySecret')!, restoredDraft.formVisibility),
    false,
    'Originally hidden field must not become visible upon draft restore'
  );

  // 6. Export WITHOUT flattening and reload
  const exportedInteractive = await embedSignaturesIntoPdf(
    baseBuffer,
    [],
    [],
    initialValues,
    { flattenForm: false, formVisibility: restoredDraft.formVisibility }
  );
  const reloadedInteractiveBuffer = exportedInteractive.buffer.slice(
    exportedInteractive.byteOffset,
    exportedInteractive.byteOffset + exportedInteractive.byteLength
  ) as ArrayBuffer;
  const { fields: reloadedFields } = await extractPdfFormFields(reloadedInteractiveBuffer);
  const reloadedByName = new Map(reloadedFields.map((f) => [f.name, f]));

  assert.equal(reloadedByName.get('visibleField')?.initiallyHidden, false);
  assert.equal(reloadedByName.get('dynamicHideA')?.initiallyHidden, true);
  assert.equal(reloadedByName.get('dynamicHideB')?.initiallyHidden, true);
  assert.equal(reloadedByName.get('initiallySecret')?.initiallyHidden, true);

  // 7. Export WITH flattening and reload: verify hidden fields (both dynamic and initial) are NOT burned into page content
  const exportedFlattened = await embedSignaturesIntoPdf(
    baseBuffer,
    [],
    [],
    initialValues,
    { flattenForm: true, formVisibility: restoredDraft.formVisibility }
  );
  const flattenedCorpus = await extractDecompressedStreamText(exportedFlattened);

  assert.equal(
    corpusContainsString(flattenedCorpus, 'PUBLIC_VISIBLE_VALUE'),
    true,
    'Visible field value must be flattened onto the page'
  );
  assert.equal(
    corpusContainsString(flattenedCorpus, 'DYNAMIC_HIDE_VALUE_A'),
    false,
    'Dynamically hidden field A must not be burned into flattened PDF'
  );
  assert.equal(
    corpusContainsString(flattenedCorpus, 'DYNAMIC_HIDE_VALUE_B'),
    false,
    'Dynamically hidden field B must not be burned into flattened PDF'
  );
  assert.equal(
    corpusContainsString(flattenedCorpus, 'ORIGINALLY_HIDDEN_SECRET'),
    false,
    'Originally hidden field must not be burned into flattened PDF'
  );
});


