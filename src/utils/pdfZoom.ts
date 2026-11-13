/**
 * Page-width fit is calculated from the page at the reading focus, not the
 * first (or widest) page in the PDF. Floor prevents 1-pixel horizontal overflow.
 */
export function computeFitWidthZoom(availableWidth: number, pageWidth: number): number {
  if (!Number.isFinite(availableWidth) || !Number.isFinite(pageWidth) ||
      availableWidth <= 0 || pageWidth <= 0) return 100;
  return Math.max(10, Math.min(500, Math.floor(availableWidth / pageWidth * 100)));
}

/**
 * Computes the PDF.js canvas render scale multiplier, supporting modern 3x smartphone
 * displays without exceeding GPU canvas limits (4096px edge / ~12 MP pixel budget).
 */
export function computeCanvasRenderScale(
  zoomLevel: number,
  devicePixelRatio: number,
  basePageWidth: number,
  basePageHeight: number
): number {
  const safeZoom = Number.isFinite(zoomLevel) && zoomLevel > 0 ? zoomLevel : 100;
  const effectiveDpr = Math.min(
    3,
    Math.max(1, Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1)
  );
  const minScale = effectiveDpr >= 2.5 ? 2.0 : 1.5;
  const targetScale = Math.max(minScale, (safeZoom / 100) * effectiveDpr);

  const safeW = Number.isFinite(basePageWidth) && basePageWidth > 0 ? basePageWidth : 595;
  const safeH = Number.isFinite(basePageHeight) && basePageHeight > 0 ? basePageHeight : 842;
  const maxDimScale = 4096 / Math.max(safeW, safeH);
  const maxAreaScale = Math.sqrt(12_000_000 / (safeW * safeH));
  const maxSafeScale = Math.min(4.5, maxDimScale, maxAreaScale);

  return Math.max(0.5, Math.min(maxSafeScale, targetScale));
}
