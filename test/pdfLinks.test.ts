import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/**
 * A two-page, entirely synthetic PDF exercising the same annotation kinds
 * present in the public FRITZ!Box 5690 manual: GoTo and URI. We intentionally
 * do not upload or embed any original manual pages or private PDFs.
 */
test('PDF.js 6 keeps internal GoTo and external HTTPS link annotations', async () => {
  const src = await PDFDocument.create();
  const first = src.addPage([595, 842]);
  const second = src.addPage([595, 842]);
  const internalAction = src.context.obj({
    S: PDFName.of('GoTo'),
    D: src.context.obj([second.ref, PDFName.of('Fit')]),
  });
  const externalAction = src.context.obj({
    S: PDFName.of('URI'),
    URI: PDFString.of('https://fritz.com/service'),
  });
  for (const [rectangle, action] of [
    [[45, 715, 290, 735], internalAction],
    [[45, 660, 290, 680], externalAction],
  ] as const) {
    const annotation = src.context.obj({
      Type: PDFName.of('Annot'),
      Subtype: PDFName.of('Link'),
      Rect: src.context.obj(rectangle),
      Border: src.context.obj([0, 0, 0]),
      A: action,
    });
    first.node.addAnnot(src.context.register(annotation));
  }

  const data = await src.save();
  const task = getDocument({ data: new Uint8Array(data) });
  try {
    const pdf = await task.promise;
    assert.equal(pdf.numPages, 2);
    const annotations = (await (await pdf.getPage(1)).getAnnotations({
      intent: 'display',
    })).filter(item => item.subtype === 'Link');

    assert.equal(annotations.length, 2);
    const internal = annotations.find(a => a.dest);
    assert.ok(internal, 'GoTo destination is available to the PDF viewer');
    assert.ok(Array.isArray(internal.dest));
    assert.equal(await pdf.getPageIndex(internal.dest[0]), 1);

    const external = annotations.find(a => a.url);
    assert.ok(external, 'HTTPS URI is available to the PDF viewer');
    assert.equal(external.url, 'https://fritz.com/service');
  } finally {
    await task.destroy();
  }
});
