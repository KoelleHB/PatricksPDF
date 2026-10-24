import assert from 'node:assert/strict';
import test from 'node:test';
import { calculatePdfFontCompensation } from '../src/utils/pdfTextMetrics';

test('compensates 15% Android CSS font inflation using observed metrics', () => {
  // Numbers only, from opt-in diagnostics; no original PDF or text.
  const adjustment = calculatePdfFontCompensation(
    286.67, 9.96, 2.71972853111141, 9.202381134033203,
  );
  assert.ok(adjustment > 0.868 && adjustment < 0.871);
  assert.ok(Math.abs(286.67 * adjustment -
    9.96 * 2.71972853111141 * 9.202381134033203) < 0.1);
});

test('keeps correct font metrics unchanged on desktop', () => {
  assert.equal(calculatePdfFontCompensation(249.28,9.96,2.71972853111141,9.202381134033203),1);
});

test('ignores rounding noise or impossible measurements', () => {
  assert.equal(calculatePdfFontCompensation(10.05,10,1,1),1);
  assert.equal(calculatePdfFontCompensation(0,10,1,1),1);
  assert.equal(calculatePdfFontCompensation(9999,10,1,1),1);
});
