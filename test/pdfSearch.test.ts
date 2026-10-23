import assert from 'node:assert/strict';
import test from 'node:test';
import { findPageMatches } from '../src/utils/pdfSearchMatcher';
import { computeFitWidthZoom } from '../src/utils/pdfZoom';

test('fit width follows the focused page, not page 1', () => {
  const available = 328;
  assert.equal(computeFitWidthZoom(available, 595), 55);
  assert.equal(computeFitWidthZoom(available, 842), 38);
  assert.equal(computeFitWidthZoom(available, 1191), 27);
});

test('fit-width never exceeds screen width by rounding up', () => {
  const zoom = computeFitWidthZoom(300, 842);
  assert.ok((zoom / 100) * 842 <= 300);
  assert.equal(computeFitWidthZoom(0, 595), 100);
});

test('search finds all occurrences on a page, case-insensitively', () => {
  const matches = findPageMatches('Alpha and alpha and ALPHA', 'alpha', 3);
  assert.deepEqual(matches.map(x => [x.pageNumber, x.ordinal, x.start]), [
    [3, 0, 0], [3, 1, 10], [3, 2, 20],
  ]);
});

test('search supports matches across PDF.js text run boundaries', () => {
  const matches = findPageMatches(['Achtung', ' bei', ' der', ' Datei'].join(''), 'bei der', 2);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].match, 'bei der');
});

test('search respects result limits and empty terms', () => {
  assert.equal(findPageMatches('aaaaa', 'a', 1, 2).length, 2);
  assert.deepEqual(findPageMatches('anything', '   ', 1), []);
  assert.deepEqual(findPageMatches('anything', 'x', 1), []);
});
