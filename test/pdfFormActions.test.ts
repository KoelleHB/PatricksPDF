import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { readFormActions } from '../src/utils/pdfFormActions';

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

test('persists field visibility into exported PDF via /F flags', async () => {
  const { embedSignaturesIntoPdf } = await import('../src/utils/pdfExportEngine');
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const form = doc.getForm();
  const field1 = form.createTextField('text1');
  field1.addToPage(page, { x: 50, y: 50, width: 100, height: 20 });
  const field2 = form.createTextField('text2');
  field2.addToPage(page, { x: 50, y: 80, width: 100, height: 20 });
  const data = await doc.save();
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;

  const exported = await embedSignaturesIntoPdf(
    buffer,
    [],
    [],
    {},
    { formVisibility: { text1: false, text2: true } }
  );

  const reloaded = await PDFDocument.load(exported);
  const reloadedF1 = reloaded.getForm().getTextField('text1');
  const reloadedF2 = reloaded.getForm().getTextField('text2');
  const w1Flags = reloadedF1.acroField.getWidgets()[0].dict.lookup(PDFName.of('F')) as any;
  const w2Flags = reloadedF2.acroField.getWidgets()[0].dict.lookup(PDFName.of('F')) as any;

  assert.ok((w1Flags.asNumber() & 2) !== 0, 'text1 widget should have Hidden flag set');
  assert.ok((w2Flags.asNumber() & 2) === 0, 'text2 widget should not have Hidden flag set');
});

