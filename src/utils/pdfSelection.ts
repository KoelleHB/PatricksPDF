/**
 * Checks whether the browser's live native selection belongs to an actual
 * PDF.js text layer. Reading the selection is side-effect free: never edit
 * ranges, highlight markup, scroll position or PDF page state here.
 *
 * Inspect anchor AND focus because Android can relocate one endpoint while
 * dragging a selection handle.
 */
export function selectionTouchesPdfTextLayer(
  selection: Pick<Selection, 'rangeCount' | 'isCollapsed' | 'anchorNode' | 'focusNode'> | null,
  root: Element | null = null,
): boolean {
  if (!selection || selection.rangeCount < 1 || selection.isCollapsed) return false;
  for (const node of [selection.anchorNode, selection.focusNode]) {
    if (!node) continue;
    const element = node.nodeType === 1
      ? node as Element
      : node.parentElement;
    const layer = element?.closest('.textLayer');
    if (layer && (!root || root.contains(layer))) return true;
  }
  return false;
}
