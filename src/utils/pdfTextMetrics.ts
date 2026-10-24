/**
 * Android Chromium WebViews can inflate CSS font sizes even with
 * text-size-adjust:none. PDF.js calculates the expected font from
 * --font-height, viewport.scale and --min-font-size. When WebView applies
 * an additional text-autosizing multiplier, selection and search marks
 * drift relative to the underlying PDF canvas.
 *
 * Apply the inverse multiplier to each transformed text span.
 * No document bytes, text or PDF coordinates are changed or uploaded.
 */
export function calculatePdfFontCompensation(
  computedFontPx: number,
  baseFontHeightPx: number,
  viewportScale: number,
  minimumFontMultiplier: number,
): number {
  const target = baseFontHeightPx * viewportScale * minimumFontMultiplier;
  if (![computedFontPx, target].every(Number.isFinite) ||
      computedFontPx <= 0 || target <= 0) return 1;
  const ratio = target / computedFontPx;
  if (Math.abs(1 - ratio) <= 0.015 || ratio < 0.6 || ratio > 1.4) return 1;
  return ratio;
}

/** Preserve existing correct desktop rendering. */
export function compensatePdfTextLayerFonts(
  layer: HTMLDivElement,
  viewportScale: number,
): { adjusted: number; inspected: number } {
  if (typeof navigator === 'undefined' || !/Android/i.test(navigator.userAgent)) {
    return { adjusted: 0, inspected: 0 };
  }
  const minFactor = Number.parseFloat(
    getComputedStyle(layer).getPropertyValue('--min-font-size')
  );
  if (!Number.isFinite(minFactor) || minFactor <= 0) {
    return { adjusted: 0, inspected: 0 };
  }

  let adjusted = 0, inspected = 0;
  for (const span of layer.querySelectorAll<HTMLElement>('span[role="presentation"]')) {
    const css = getComputedStyle(span);
    const actual = Number.parseFloat(css.fontSize);
    const original = Number.parseFloat(css.getPropertyValue('--font-height'));
    if (!Number.isFinite(original) || original <= 0) continue;
    inspected++;
    const factor = calculatePdfFontCompensation(
      actual, original, viewportScale, minFactor,
    );
    if (factor !== 1) {
      span.style.setProperty('--font-metric-correction', String(factor));
      adjusted++;
    } else {
      span.style.removeProperty('--font-metric-correction');
    }
  }
  return { adjusted, inspected };
}
