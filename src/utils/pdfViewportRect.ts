/**
 * Map a PDF annotation rectangle into a PDF.js viewport.
 *
 * PDF.js v6 removed PageViewport.convertToViewportRectangle() but retains
 * convertToViewportPoint(). A rectangle is defined by two opposite corners;
 * transforming both respects rotation, crop box offsets, and viewport scale.
 */
export function pdfRectToViewport(
  viewport: { convertToViewportPoint(x: number, y: number): number[] },
  rectangle: readonly number[],
): [number, number, number, number] {
  if (rectangle.length < 4 || rectangle.slice(0,4).some(v => !Number.isFinite(v))) {
    throw new Error('Invalid PDF annotation rectangle');
  }
  const first = viewport.convertToViewportPoint(rectangle[0],rectangle[1]);
  const second = viewport.convertToViewportPoint(rectangle[2],rectangle[3]);
  return [first[0],first[1],second[0],second[1]];
}
