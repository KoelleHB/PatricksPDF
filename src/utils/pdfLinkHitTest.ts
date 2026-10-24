import type { PdfLinkAnnotation } from '../types';

export interface PdfTapPoint { x: number; y: number; at: number }

/**
 * Screen-space hit testing based on the actual PDF annotation geometry.
 * This works even when a PDF.js text span would intercept an HTML <a> click.
 * The coordinates and sizes must all be measured in the same CSS pixel space.
 */
export function findPdfLinkAtPoint(
  links: readonly PdfLinkAnnotation[],
  x: number, y: number,
  width: number, height: number,
): PdfLinkAnnotation | undefined {
  if (![x, y, width, height].every(Number.isFinite) ||
      width <= 0 || height <= 0) return undefined;
  const px = (x / width) * 100;
  const py = (y / height) * 100;
  // Prefer the smallest rectangle if a reference overlaps a larger link.
  return links.filter((link) =>
    px >= link.xPercent && px <= link.xPercent + link.widthPercent &&
    py >= link.yPercent && py <= link.yPercent + link.heightPercent
  ).sort((a, b) =>
    (a.widthPercent * a.heightPercent) - (b.widthPercent * b.heightPercent)
  )[0];
}

/** Reject dragging/scrolling/long-press selection gestures. */
export function isTapGesture(
  start: PdfTapPoint,
  end: PdfTapPoint,
): boolean {
  const duration = end.at - start.at;
  if (!Number.isFinite(duration) || duration < 0 || duration > 450) return false;
  return Math.hypot(end.x - start.x, end.y - start.y) <= 12;
}
