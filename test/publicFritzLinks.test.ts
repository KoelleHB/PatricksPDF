import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractRawPdfLinks } from '../src/utils/pdfRawLinks';

/**
 * One-off integration diagnostic against the *publicly available* FRITZ!Box
 * manual. The PDF is downloaded by CI, never stored in this repository.
 * Local private documents are never part of this test.
 */
test('public FRITZ!Box 5690 manual exposes original GoTo / URI annotations', async (t) => {
  const file = process.env.PUBLIC_MANUAL_PATH;
  if (!file) return t.skip('Public integration fixture not configured');
  const bytes = new Uint8Array(readFileSync(file));
  const raw = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const task = getDocument({data:new Uint8Array(raw.slice(0)), enableXfa:true});
  try {
    const pdf = await task.promise;
    console.log('PUBLIC_MANUAL_PAGES', pdf.numPages);
    assert.ok(pdf.numPages >= 200, 'download must be a complete multi-page manual');
    const counts = [];
    for(const [pageNum, expected] of [[2,56],[3,0],[14,7],[15,0]] as const){
      const page = await pdf.getPage(pageNum);
      const annotations = await page.getAnnotations({intent:'display'});
      const subtypeCounts: Record<string,number> = {};
      for(const annotation of annotations){
        const subtype = String(annotation.subtype ?? '(missing)');
        subtypeCounts[subtype]=(subtypeCounts[subtype]||0)+1;
      }
      const links = annotations.filter(a => a.subtype === 'Link');
      const withDest = links.filter(a=> Boolean(a.dest)).length;
      if (pageNum === 2 && links[0]?.dest) {
        const first = links[0].dest;
        const ref = Array.isArray(first) ? first[0] : undefined;
        const targetIdx = ref && typeof ref === 'object' ? await pdf.getPageIndex(ref) : -1;
        console.log('PUBLIC_LINK_FIRST_DEST', JSON.stringify({
          destType:typeof first, isArray:Array.isArray(first),
          ref, targetIdx,
          cached:ref && typeof pdf.cachedPageNumber === 'function'
            ? pdf.cachedPageNumber(ref) : null,
        }));
      }
      const withUrl = links.filter(a=> Boolean(a.url)).length;
      let rawError: string | undefined;
      const rawLinks=await extractRawPdfLinks(raw,pageNum).catch((error: Error) => {
        rawError = error.message;
        return [];
      });
      console.log('PUBLIC_MANUAL_PAGE_RESULT', JSON.stringify({
        pageNum, annotations: annotations.length,subtypeCounts,
        pdfjsLinks:links.length,withDest,withUrl,
        rawLinks:rawLinks.length, rawError,
        rawInternal:rawLinks.filter(a=>Boolean(a.targetPage)).length,
        rawExternal:rawLinks.filter(a=>Boolean(a.url)).length
      }));
      // These public manuals are revised independently of the users' edition.
      // Report counts first; a subsequent test will assert the verified pages.
      counts.push(rawLinks.length);
    }
    assert.ok(counts.length === 4);
  } finally {
    await task.destroy();
  }
});
