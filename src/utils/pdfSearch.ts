import { loadPdfJsDoc } from './pdfDocumentLifecycle';

export interface PdfSearchHit {
  pageNumber: number;
  ordinal: number;
  start: number;
  before: string;
  match: string;
  after: string;
}

export interface PdfSearchProgress {
  scannedPages: number;
  totalPages: number;
  matches: number;
  unreadablePages: number;
  truncated: boolean;
}

export interface PdfSearchResult {
  hits: PdfSearchHit[];
  progress: PdfSearchProgress;
}

const MAX_RESULTS = 1000;

export function findPageMatches(
  pageText: string,
  phrase: string,
  pageNumber: number,
  remaining: number = MAX_RESULTS
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
    const before = pageText.slice(Math.max(0, position - 56), position)
      .replace(/\s+/g, ' ');
    const after = pageText.slice(position + query.length, position + query.length + 76)
      .replace(/\s+/g, ' ');
    results.push({
      pageNumber,
      ordinal: results.length,
      start: position,
      before,
      match: pageText.slice(position, position + query.length),
      after,
    });
    // Overlapping matches aren't useful for navigation or highlighting.
    start = position + Math.max(1, needle.length);
  }

  return results;
}

/**
 * Search text embedded in every PDF page using PDF.js' shared worker.
 * Results are bounded; stale jobs can be stopped without destroying a
 * document shared with the viewer. No document contents leave the device.
 */
export async function searchPdfDocument(
  buffer: ArrayBuffer,
  phrase: string,
  onProgress: (progress: PdfSearchProgress, hits: PdfSearchHit[]) => void,
  cancelled: () => boolean,
): Promise<PdfSearchResult> {
  const hits: PdfSearchHit[] = [];
  const progress: PdfSearchProgress = {
    scannedPages: 0, totalPages: 0, matches: 0,
    unreadablePages: 0, truncated: false,
  };
  if (!phrase.trim()) return { hits, progress };

  const doc = await loadPdfJsDoc(buffer);
  progress.totalPages = doc.numPages;

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    if (cancelled()) break;
    try {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      if (cancelled()) break;
      // Text runs sometimes end inside a word; join rather than inserting
      // artificial spaces. Real line breaks are respected via hasEOL.
      const fullText = (content.items as Array<{ str?: string; hasEOL?: boolean }>)
        .map((item) => (item.str || '') + (item.hasEOL ? '\n' : ''))
        .join('');
      hits.push(...findPageMatches(
        fullText, phrase, pageNumber, MAX_RESULTS - hits.length,
      ));
    } catch (err) {
      progress.unreadablePages++;
      console.warn(`Search skipped unreadable page ${pageNumber}:`, err);
    }
    progress.scannedPages = pageNumber;
    progress.matches = hits.length;
    if (hits.length >= MAX_RESULTS) {
      progress.truncated = true;
      onProgress({ ...progress }, [...hits]);
      break;
    }
    if (pageNumber % 5 === 0 || pageNumber === doc.numPages) {
      onProgress({ ...progress }, [...hits]);
    }
    if (pageNumber % 8 === 0) {
      // Let Android paint the search panel while the PDF worker is busy.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  return { hits, progress: { ...progress } };
}
