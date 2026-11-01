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
  const actions = [...(await readFormActions(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer)).values()];
  assert.deepEqual(actions, [
    { type: 'hide', targets: ['group.item'], hide: false },
    { type: 'reset', fields: ['group'], exclude: true },
  ]);
});
