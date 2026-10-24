/**
 * Page-width fit is calculated from the page at the reading focus, not the
 * first (or widest) page in the PDF. Floor prevents 1-pixel horizontal overflow.
 */
export function computeFitWidthZoom(availableWidth: number, pageWidth: number): number {
  if (!Number.isFinite(availableWidth) || !Number.isFinite(pageWidth) ||
      availableWidth <= 0 || pageWidth <= 0) return 100;
  return Math.max(10, Math.min(500, Math.floor(availableWidth / pageWidth * 100)));
}
