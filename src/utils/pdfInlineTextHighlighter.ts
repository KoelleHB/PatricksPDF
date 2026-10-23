import { getPdfInlineMatchSegments } from './pdfInlineSearch';

/**
 * Small adapter implementing PDF.js TextLayerBuilder's highlighter interface.
 * Upstream passes the precise textDivs/textContentItemsStr in setTextMapping,
 * then calls enable/disable with the lifetime of the text layer.
 * Search marks are part of the real text spans, never absolute-positioned
 * rectangles computed from browser Range geometry.
 */
export class PdfInlineTextHighlighter {
  private divs: HTMLElement[] = [];
  private texts: string[] = [];
  private enabled = false;
  private query = '';
  private selectedOrdinal = -1;
  private modifiedDivIndices = new Set<number>();
  private selectedElement: HTMLElement | null = null;

  setTextMapping(divs: HTMLElement[], texts: string[]): void {
    this.divs = divs;
    this.texts = texts;
  }

  enable(): void {
    this.enabled = true;
    this.update();
  }

  disable(): void {
    this.enabled = false;
    this.clear();
  }

  setSearch(query: string, selectedOrdinal: number): HTMLElement | null {
    const normalized = query.trim();
    if (this.query === normalized && this.selectedOrdinal === selectedOrdinal) {
      return this.selectedElement;
    }
    this.query = normalized;
    this.selectedOrdinal = selectedOrdinal;
    this.update();
    return this.selectedElement;
  }

  private clear(): void {
    for (const index of this.modifiedDivIndices) {
      const div = this.divs[index];
      if (div) div.textContent = this.texts[index] || '';
    }
    this.modifiedDivIndices.clear();
    this.selectedElement = null;
  }

  private update(): void {
    this.clear();
    if (!this.enabled || !this.query || !this.divs.length) return;

    const segments = getPdfInlineMatchSegments(
      this.texts, this.query, this.selectedOrdinal,
    );
    const grouped = new Map<number, typeof segments>();
    for (const segment of segments) {
      if (!grouped.has(segment.divIndex)) grouped.set(segment.divIndex, []);
      grouped.get(segment.divIndex)!.push(segment);
    }
    for (const [index, pieces] of grouped) {
      const div = this.divs[index];
      if (!div) continue;
      const text = this.texts[index] || '';
      const fragment = document.createDocumentFragment();
      let cursor = 0;
      for (const piece of pieces) {
        if (piece.start < cursor) continue;
        if (piece.start > cursor) {
          fragment.append(document.createTextNode(text.slice(cursor, piece.start)));
        }
        const mark = document.createElement('span');
        mark.className = piece.selected
          ? 'pdf-inline-search-match pdf-inline-search-selected'
          : 'pdf-inline-search-match';
        mark.textContent = text.slice(piece.start, piece.end);
        fragment.append(mark);
        if (piece.selected && !this.selectedElement) this.selectedElement = mark;
        cursor = piece.end;
      }
      if (cursor < text.length) {
        fragment.append(document.createTextNode(text.slice(cursor)));
      }
      div.replaceChildren(fragment);
      this.modifiedDivIndices.add(index);
    }
  }
}
