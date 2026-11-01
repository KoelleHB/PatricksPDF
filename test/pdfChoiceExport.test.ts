import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFString, PDFArray, PDFDict, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { embedSignaturesIntoPdf } from '../src/utils/pdfExportEngine';

test('choice exports preserve export values while rendering their display labels', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const form = doc.getForm();
  const dropdown = form.createDropdown('choice');
  dropdown.addToPage(page);
  dropdown.acroField.dict.set(PDFName.of('Opt'), doc.context.obj([
    [PDFString.of('code-a'), PDFString.of('Alpha')],
    [PDFString.of('code-b'), PDFString.of('Beta')],
  ]));
  const list = form.createOptionList('list');
  list.enableMultiselect();
  list.addToPage(page);
  list.acroField.dict.set(PDFName.of('Opt'), doc.context.obj([
    [PDFString.of('a'), PDFString.of('First')],
    [PDFString.of('b'), PDFString.of('Second')],
    [PDFString.of('c'), PDFString.of('Third')],
  ]));
  const editable = form.createDropdown('editable');
  editable.addOptions(['First', 'Second']);
  editable.enableEditing();
  editable.addToPage(page);
  const source = await doc.save({ updateFieldAppearances: false });
  const buffer = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) as ArrayBuffer;
  const saved = await embedSignaturesIntoPdf(buffer, [], [], { choice: 'code-b', list: ['a', 'c'], editable: 'Custom' });
  const reopened = await PDFDocument.load(saved);
  const f = reopened.getForm();
  assert.deepEqual(f.getDropdown('choice').getSelected(), ['code-b']);
  assert.deepEqual(f.getOptionList('list').getSelected(), ['a', 'c']);
  assert.deepEqual(f.getDropdown('editable').getSelected(), ['Custom']);
  assert.equal(f.getDropdown('editable').isEditable(), true);
  const indices = f.getOptionList('list').acroField.dict.lookup(PDFName.of('I'), PDFArray);
  assert.equal(indices.toString(), '[ 0 2 ]');
  const widget = f.getDropdown('choice').acroField.getWidgets()[0];
  const ap = reopened.context.lookup(widget.dict.lookup(PDFName.of('AP'), PDFDict).get(PDFName.of('N')));
  assert.ok(ap instanceof PDFRawStream);
  const appearance = new TextDecoder().decode(decodePDFRawStream(ap).decode());
  assert.match(appearance, new RegExp(Buffer.from('Beta', 'ascii').toString('hex'), 'i'));
});
