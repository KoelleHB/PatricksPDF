import { PDFArray, PDFBool, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString } from 'pdf-lib';
import type { PdfFormAction } from '../types';

// Only interpret declarative PDF actions. Never execute embedded JavaScript.
export async function readFormActions(bytes: ArrayBuffer): Promise<Map<string, PdfFormAction>> {
  const actions = new Map<string, PdfFormAction>();
  const doc = await PDFDocument.load(bytes.slice(0), { updateMetadata: false });
  const decode = (v: unknown): string | null => v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : null;
  const readNames = (value: unknown): string[] | null => {
    if (value instanceof PDFString || value instanceof PDFHexString) return [value.decodeText()];
    if (!(value instanceof PDFArray)) return null;
    const names: string[] = [];
    for (let i = 0; i < value.size(); i++) {
      const name = decode(value.lookup(i));
      if (name === null) return null; // field/widget references require identity resolution
      names.push(name);
    }
    return names;
  };
  const getWidgetFieldName = (widget: PDFDict): string | null => {
    const t = decode(widget.lookup(PDFName.of('T')));
    if (t) return t;
    let parent = widget.lookup(PDFName.of('Parent'));
    while (parent instanceof PDFDict) {
      const pt = decode(parent.lookup(PDFName.of('T')));
      if (pt) return pt;
      parent = parent.lookup(PDFName.of('Parent'));
    }
    return null;
  };
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i++) {
      const ref = annots.get(i), widget = annots.lookup(i);
      if (!(ref instanceof PDFRef) || !(widget instanceof PDFDict)) continue;
      const action = widget.lookup(PDFName.of('A'));
      if (!(action instanceof PDFDict) || action.has(PDFName.of('Next'))) continue;
      const kind = action.lookup(PDFName.of('S'));
      let parsed: PdfFormAction | undefined;
      if (kind === PDFName.of('Hide')) {
        const targets = readNames(action.lookup(PDFName.of('T')));
        const flag = action.lookup(PDFName.of('H'));
        if (targets && (!flag || flag instanceof PDFBool)) parsed = { type: 'hide', targets, hide: flag instanceof PDFBool ? flag.asBoolean() : true };
      } else if (kind === PDFName.of('ResetForm')) {
        const raw = action.lookup(PDFName.of('Fields'));
        const fields = raw === undefined ? [] : readNames(raw);
        const flags = action.lookup(PDFName.of('Flags'));
        if (fields && (!flags || flags instanceof PDFNumber)) parsed = { type: 'reset', fields, exclude: flags instanceof PDFNumber && (flags.asNumber() & 1) !== 0 };
      }
      if (parsed) {
        actions.set(`${ref.objectNumber}R${ref.generationNumber || ''}`, parsed);
        const fieldName = getWidgetFieldName(widget);
        if (fieldName) actions.set(`name:${fieldName}`, parsed);
      }
    }
  }
  return actions;
}
