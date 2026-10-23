/**
 * Map PDF.js TextLayerBuilder's own text runs to literal match ranges.
 * The resulting highlights are inline child spans of the actual selectable
 * PDF text spans, so Android WebView never needs Range.getClientRects()
 * to convert text positions into a separate overlay coordinate system.
 */
export interface PdfInlineMatchSegment {
  divIndex: number;
  start: number;
  end: number;
  ordinal: number;
  selected: boolean;
}

export function getPdfInlineMatchSegments(
  texts: readonly string[],
  phrase: string,
  selectedOrdinal: number,
  maxMatches = 1000,
): PdfInlineMatchSegment[] {
  const query = phrase.trim().toLowerCase();
  if (!query || maxMatches <= 0) return [];

  const combined = texts.join('');
  const lower = combined.toLowerCase();
  const offsets: number[] = [];
  let accumulated = 0;
  for (const text of texts) {
    offsets.push(accumulated);
    accumulated += text.length;
  }

  const results: PdfInlineMatchSegment[] = [];
  let foundAt = 0;
  let ordinal = 0;
  let divIndex = 0;
  while (foundAt < lower.length && ordinal < maxMatches) {
    const position = lower.indexOf(query, foundAt);
    if (position < 0) break;
    const matchEnd = position + query.length;

    // Mark the first few occurrences as well as the currently selected hit.
    if (ordinal < 32 || ordinal === selectedOrdinal) {
      while (divIndex < texts.length &&
             offsets[divIndex] + texts[divIndex].length <= position) {
        divIndex++;
      }
      let index = divIndex;
      while (index < texts.length && offsets[index] < matchEnd) {
        const start = Math.max(0, position - offsets[index]);
        const end = Math.min(texts[index].length, matchEnd - offsets[index]);
        if (start < end) {
          results.push({
            divIndex: index, start, end, ordinal,
            selected: ordinal === selectedOrdinal,
          });
        }
        index++;
      }
    }

    foundAt = position + Math.max(1, query.length);
    ordinal++;
  }
  return results;
}
