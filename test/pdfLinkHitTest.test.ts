import assert from 'node:assert/strict';
import test from 'node:test';
import { findPdfLinkAtPoint, isTapGesture } from '../src/utils/pdfLinkHitTest';
import type { PdfLinkAnnotation } from '../src/types';

const links: PdfLinkAnnotation[] = [
  { id:'toc',pageNumber:2,xPercent:10,yPercent:14,widthPercent:30,heightPercent:4,targetPage:9,title:'Interner Verweis' },
  { id:'website',pageNumber:14,xPercent:67,yPercent:31,widthPercent:15,heightPercent:3,url:'https://fritz.com/service',title:'Externer Verweis' },
];

test('a PDF page tap resolves internal navigation by annotation rectangle', () => {
  const found=findPdfLinkAtPoint(links, 0.2*420, 0.16*595, 420, 595);
  assert.equal(found?.targetPage,9);
});

test('an external URL resolves on its own page-sized coordinate system', () => {
  const found=findPdfLinkAtPoint(links, 0.72*840, 0.325*1190, 840, 1190);
  assert.equal(found?.url,'https://fritz.com/service');
});

test('a tap outside an annotation never activates a link', () => {
  assert.equal(findPdfLinkAtPoint(links,300,300,420,595),undefined);
  assert.equal(findPdfLinkAtPoint(links,300,300,0,595),undefined);
});

test('tap-versus-selection drag protection', () => {
  const start={x:85,y:95,at:1000};
  assert.equal(isTapGesture(start,{x:87,y:96,at:1200}),true);
  assert.equal(isTapGesture(start,{x:130,y:96,at:1200}),false);
  assert.equal(isTapGesture(start,{x:87,y:96,at:1700}),false);
});
