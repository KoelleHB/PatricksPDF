import assert from 'node:assert/strict';
import test from 'node:test';
import { pdfRectToViewport } from '../src/utils/pdfViewportRect';

test('PDF.js 6 viewport rectangle conversion with flipped Y axis', () => {
  const viewport={convertToViewportPoint:(x:number,y:number)=>[x,595-y]};
  assert.deepEqual(pdfRectToViewport(viewport,[42.52,496.253,167.67,506.252]),
    [42.52,98.74700000000001,167.67,88.74800000000005]);
});

test('viewport rectangle conversion respects 90° rotation', () => {
  const viewport={convertToViewportPoint:(x:number,y:number)=>[y,x]};
  assert.deepEqual(pdfRectToViewport(viewport,[20,30,50,70]),[30,20,70,50]);
});

test('viewport rectangle conversion respects zoom and offsets', () => {
  const viewport={convertToViewportPoint:(x:number,y:number)=>[2*(x-10),2*(300-y)]};
  assert.deepEqual(pdfRectToViewport(viewport,[15,20,45,40]),[10,560,70,520]);
});
