import assert from 'node:assert/strict';
import test from 'node:test';
import { selectionTouchesPdfTextLayer } from '../src/utils/pdfSelection';

// Minimal DOM-shaped objects let the selection guard be tested in Node without
// introducing JSDOM or any user PDF contents.
const pageLayer = { id: 'pdf-text-layer' };
const makeElement = (layer: unknown) => ({
  closest: (selector: string) => selector === '.textLayer' ? layer : null,
});
const textNode = (parent: unknown) => ({ nodeType: 3, parentElement: parent });
const pageRoot = { contains: (element: unknown) => element === pageLayer };

test('detects a live Android PDF selection through the text node parent', () => {
  const text = textNode(makeElement(pageLayer));
  assert.equal(selectionTouchesPdfTextLayer({
    rangeCount: 1, isCollapsed: false, anchorNode: text, focusNode: null,
  } as any, pageRoot as any), true);
});

test('keeps a selection protected when only the focus endpoint is within the PDF', () => {
  const text = textNode(makeElement(pageLayer));
  assert.equal(selectionTouchesPdfTextLayer({
    rangeCount: 1, isCollapsed: false,
    anchorNode: textNode(makeElement(null)), focusNode: text,
  } as any, pageRoot as any), true);
});

test('does not freeze a collapsed, missing, or non-PDF selection', () => {
  const text = textNode(makeElement(pageLayer));
  const selection = { rangeCount: 1, isCollapsed: true, anchorNode: text, focusNode: text };
  assert.equal(selectionTouchesPdfTextLayer(selection as any, pageRoot as any), false);
  assert.equal(selectionTouchesPdfTextLayer(null, pageRoot as any), false);
  assert.equal(selectionTouchesPdfTextLayer({
    ...selection, rangeCount: 0, isCollapsed: false,
  } as any, pageRoot as any), false);
  assert.equal(selectionTouchesPdfTextLayer({
    ...selection, isCollapsed: false,
  } as any, { contains: () => false } as any), false);
});
