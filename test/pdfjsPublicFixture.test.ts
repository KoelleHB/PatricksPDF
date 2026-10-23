import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { findPageMatches } from '../src/utils/pdfSearchMatcher';
import { getPdfInlineMatchSegments } from '../src/utils/pdfInlineSearch';

/**
 * Generated locally during CI from a standard built-in font. Contains no
 * user files, external resources, document titles or private data.
 *
 * This exercises the actual upgraded PDF.js text extraction API and
 * PatricksPDF's cross-span search/highlight mapping.
 */
test('extract and search text in a synthetic public PDF on PDF.js v6', async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([595, 842]);
  const font = await source.embedFont(StandardFonts.Helvetica);
  page.drawText('Synthetic PDF.js regression test: solar minutes and daylight.', {
    x: 55, y: 715, size: 16, font,
  });
  page.drawText('Second line with another minute mentioned.', {
    x: 55, y: 677, size: 16, font,
  });
  const bytes = await source.save();
  const loading = getDocument({ data: new Uint8Array(bytes) });
  let document: Awaited<typeof loading.promise> | undefined;
  try {
    document = await loading.promise;
    assert.equal(document.numPages, 1);
    const content = await (await document.getPage(1)).getTextContent({
      disableNormalization: true,
    } as any);
    const strings = content.items.flatMap(item => 'str' in item ? [item.str] : []);
    assert.ok(strings.join(' ').includes('solar minutes and daylight'));
    const hits = findPageMatches(strings.join(''), 'minutes', 1);
    assert.equal(hits.length, 1);
    const segments = getPdfInlineMatchSegments(strings, 'minutes', 0);
    assert.ok(segments.some(segment => segment.selected));
  } finally {
    await document?.destroy();
    await loading.destroy();
  }
});
