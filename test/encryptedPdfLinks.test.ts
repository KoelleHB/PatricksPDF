import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/**
 * Two-page synthetic encrypted PDF with one internal GoTo and one HTTPS URI.
 * Generated with PyMuPDF; no private or third-party PDF pages in repository.
 */
test('PDF.js decrypts internal and external links in an AES-128 PDF', async () => {
  const file=new URL('./fixtures/encrypted-pdf-links.pdf', import.meta.url);
  const source=new Uint8Array(readFileSync(file));
  const task=getDocument({data:source});
  try {
    const pdf=await task.promise;
    assert.equal(pdf.numPages,2);
    const annots=(await(await pdf.getPage(1)).getAnnotations({intent:'display'}))
      .filter(a=>a.subtype==='Link');
    assert.equal(annots.length,2);
    const dest=annots.find(a=>Array.isArray(a.dest))?.dest;
    assert.ok(dest);
    assert.equal(await pdf.getPageIndex(dest[0]),1);
    assert.equal(annots.find(a=>a.url)?.url,'https://example.org/docs');
  } finally {
    await task.destroy();
  }
});
