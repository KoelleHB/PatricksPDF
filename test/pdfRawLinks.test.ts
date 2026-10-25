import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PDFDocument, PDFName, PDFString, PDFHexString,
} from 'pdf-lib';
import { extractRawPdfLinks } from '../src/utils/pdfRawLinks';

/**
 * Actual PDF action shape used by the public FRITZ!Box 5690 manual:
 * /A << /S /GoTo /D [indirect pageRef /XYZ x y null] >>
 * and /A << /S /URI /URI (https://...) >>.
 * No copyrighted PDF pages or confidential documents are checked in.
 */
test('extracts multiple GoTo page references directly from PDF objects', async () => {
  const pdf = await PDFDocument.create();
  const first = pdf.addPage([420, 595]);
  const destination = pdf.addPage([420, 595]);
  const third = pdf.addPage([420, 595]);
  const refs = [destination.ref, destination.ref, third.ref];

  refs.forEach((ref, i) => {
    const action = pdf.context.obj({
      S: PDFName.of('GoTo'),
      D: pdf.context.obj([ref, PDFName.of('XYZ'), 70, 540, null]),
      Type: PDFName.of('Action'),
    });
    const annot = pdf.context.obj({
      Type: PDFName.of('Annot'), Subtype: PDFName.of('Link'),
      Rect: pdf.context.obj([42, 490 - i * 16, 168, 500 - i * 16]),
      A: action,
    });
    first.node.addAnnot(pdf.context.register(annot));
  });

  const links = await extractRawPdfLinks((await pdf.save()).buffer as ArrayBuffer, 1);
  assert.equal(links.length, 3);
  assert.deepEqual(links.map(link => link.targetPage), [2, 2, 3]);
  assert.ok(links.every(link => link.xPercent > 9 && link.xPercent < 11));
  assert.ok(links.every(link => link.yPercent > 15 && link.yPercent < 24));
});

test('extracts and sanitizes external URI actions independently of PDF.js', async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([420, 595]);
  for (const [candidate, y, hex] of [
    ['https://fritz.com/service', 350, false],
    ['javascript:alert(1)', 310, false],
    ['https://fritz.com/service/handbuecher/', 280, true],
  ] as const) {
    const annot = pdf.context.obj({
      Type: PDFName.of('Annot'),
      Subtype: PDFName.of('Link'),
      Rect: pdf.context.obj([282, y, 355, y + 10]),
      A: pdf.context.obj({
        S: PDFName.of('URI'),
        URI: hex
          ? PDFHexString.fromText(candidate)
          : PDFString.of(candidate),
      }),
    });
    page.node.addAnnot(pdf.context.register(annot));
  }
  const links=await extractRawPdfLinks((await pdf.save()).buffer as ArrayBuffer,1);
  assert.equal(links.length,2);
  assert.deepEqual(links.map(link=>link.url),[
    'https://fritz.com/service',
    'https://fritz.com/service/handbuecher/',
  ]);
  assert.ok(links.every(link=>link.xPercent>65 && link.xPercent<70));
});

test('does not confuse blank pages or pages without annotation links', async () => {
  const pdf=await PDFDocument.create();
  pdf.addPage();
  const buffer=(await pdf.save()).buffer as ArrayBuffer;
  assert.deepEqual(await extractRawPdfLinks(buffer,1),[]);
  assert.deepEqual(await extractRawPdfLinks(buffer,3),[]);
});
