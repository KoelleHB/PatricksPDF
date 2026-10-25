import assert from 'node:assert/strict';
import test from 'node:test';
import { getPdfInlineMatchSegments } from '../src/utils/pdfInlineSearch';

test('finds the active occurrence within the correct PDF.js span', () => {
  const spans = ['The orbit lasts 34 ', 'minutes', ' and a daylight time of 54 minutes.'];
  const matches = getPdfInlineMatchSegments(spans, 'Minute', 0);
  const active = matches.filter(x => x.selected);
  assert.deepEqual(active.map(x => [x.divIndex, x.start, x.end]), [[1,0,6]]);
  assert.equal(spans[active[0].divIndex].slice(active[0].start,active[0].end), 'minute');
});

test('highlights a match split across successive PDF text spans', () => {
  const spans = ['The ', 'min', 'utes go by.'];
  const active = getPdfInlineMatchSegments(spans, 'minute', 0).filter(x=>x.selected);
  assert.deepEqual(active.map(x=>[x.divIndex,x.start,x.end]), [[1,0,3],[2,0,3]]);
});

test('distinguishes repeated matches and selects exact ordinal', () => {
  const spans=['Minutes ', 'and ', 'minutes'];
  const result=getPdfInlineMatchSegments(spans, 'minutes', 1);
  assert.deepEqual(result.filter(x=>x.selected).map(x=>[x.divIndex,x.start,x.end]), [[2,0,7]]);
  assert.equal(getPdfInlineMatchSegments(spans,' ',0).filter(x=>x.selected).length,0);
});

test('does not corrupt offsets for empty PDF text spans', () => {
  const spans=['foo','','minutes', ''];
  assert.deepEqual(getPdfInlineMatchSegments(spans,'minute',0).filter(x=>x.selected).map(x=>x.divIndex), [2]);
});
