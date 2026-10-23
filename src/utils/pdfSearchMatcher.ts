export interface PdfSearchHit {
  pageNumber: number;
  ordinal: number;
  start: number;
  before: string;
  match: string;
  after: string;
}

/** Pure case-insensitive text matcher used by the PDF.js search pipeline. */
export function findPageMatches(
  pageText: string,
  phrase: string,
  pageNumber: number,
  remaining: number = 1000
): PdfSearchHit[] {
  const query = phrase.trim();
  if (!query || remaining <= 0) return [];
  const haystack = pageText.toLowerCase();
  const needle = query.toLowerCase();
  const results: PdfSearchHit[] = [];
  let start = 0;
  while (start < haystack.length && results.length < remaining) {
    const position = haystack.indexOf(needle, start);
    if (position === -1) break;
    results.push({
      pageNumber,
      ordinal: results.length,
      start: position,
      before: pageText.slice(Math.max(0, position - 56), position).replace(/\s+/g, ' '),
      match: pageText.slice(position, position + query.length),
      after: pageText.slice(position + query.length, position + query.length + 76).replace(/\s+/g, ' '),
    });
    start = position + Math.max(1, needle.length);
  }
  return results;
}
