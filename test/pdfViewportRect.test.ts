import assert from 'node:assert/strict';
import test from 'node:test';
import { pdfRectToViewport } from '../src/utils/pdfViewportRect';

test('PDF.js 6 viewport rectangle conversion with flipped Y axis', () => {
  const viewport={convertToViewportPoint:(x:number,y:number)=>[x,595-y]};
  const [x1,y1,x2,y2] = pdfRectToViewport(viewport,[42.52,496.253,167.67,506.252]);
  assert.ok(Math.abs(x1-42.52)<1e-6);
  assert.ok(Math.abs(y1-98.747)<1e-6);
  assert.ok(Math.abs(x2-167.67)<1e-6);
  assert.ok(Math.abs(y2-88.748)<1e-6);
});

test('viewport rectangle conversion respects 90° rotation', () => {
  const viewport={convertToViewportPoint:(x:number,y:number)=>[y,x]};
  assert.deepEqual(pdfRectToViewport(viewport,[20,30,50,70]),[30,20,70,50]);
});

test('viewport rectangle conversion respects zoom and offsets', () => {
  const viewport={convertToViewportPoint:(x:number,y:number)=>[2*(x-10),2*(300-y)]};
  assert.deepEqual(pdfRectToViewport(viewport,[15,20,45,40]),[10,560,70,520]);
});
