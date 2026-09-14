import { ProcessedImageResult, canvasToBlob, blobToUint8Array } from './imageProcessor';

export interface DrawPoint {
  x: number;
  y: number;
  time: number;
  width: number;
}

export type Stroke = DrawPoint[];

export type PenStyle = 'fountain' | 'gel' | 'ballpoint';

export interface PenConfig {
  minWidth: number;
  maxWidth: number;
  velocityFilterWeight: number;
  speedMultiplier: number;
}

export const PEN_CONFIGS: Record<PenStyle, PenConfig> = {
  fountain: {
    minWidth: 1.8,
    maxWidth: 5.2,
    velocityFilterWeight: 0.65,
    speedMultiplier: 2.2,
  },
  gel: {
    minWidth: 2.6,
    maxWidth: 4.2,
    velocityFilterWeight: 0.7,
    speedMultiplier: 1.0,
  },
  ballpoint: {
    minWidth: 1.8,
    maxWidth: 2.8,
    velocityFilterWeight: 0.8,
    speedMultiplier: 0.6,
  },
};

/**
 * Computes instantaneous speed and dynamic stroke width for a new point
 */
export function computePointWidth(
  current: { x: number; y: number; time: number },
  previous: DrawPoint | null,
  penStyle: PenStyle,
  scale = 1.0
): number {
  const config = PEN_CONFIGS[penStyle];
  const minW = config.minWidth * scale;
  const maxW = config.maxWidth * scale;

  if (!previous) {
    return (minW + maxW) / 2;
  }

  const dist = Math.hypot(current.x - previous.x, current.y - previous.y);
  const dt = Math.max(1, current.time - previous.time);
  const speed = dist / dt; // pixels per ms

  // Faster movement = thinner line (simulating ink flow of real fountain/ballpoint pen)
  const targetWidth = Math.max(minW, Math.min(maxW, maxW - speed * config.speedMultiplier * scale));
  return previous.width * config.velocityFilterWeight + targetWidth * (1 - config.velocityFilterWeight);
}

/**
 * Draws a single stroke onto a canvas context using smooth quadratic Bezier curves
 * and velocity-sensitive ink deposition.
 */
export function drawStrokeOnContext(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  color: string,
  offsetX = 0,
  offsetY = 0
) {
  if (stroke.length === 0) return;

  ctx.fillStyle = color;
  ctx.strokeStyle = color;

  // Single tap / dot
  if (stroke.length === 1) {
    const p = stroke[0];
    ctx.beginPath();
    ctx.arc(p.x + offsetX, p.y + offsetY, Math.max(1, p.width / 2), 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  // Short two-point segment
  if (stroke.length === 2) {
    const p0 = stroke[0];
    const p1 = stroke[1];
    drawTaperedSegment(
      ctx,
      p0.x + offsetX,
      p0.y + offsetY,
      p0.width,
      p1.x + offsetX,
      p1.y + offsetY,
      p1.width
    );
    return;
  }

  // Multi-point stroke: smooth quadratic Bezier between midpoints
  let prevMidX = (stroke[0].x + stroke[1].x) / 2 + offsetX;
  let prevMidY = (stroke[0].y + stroke[1].y) / 2 + offsetY;
  let prevWidth = (stroke[0].width + stroke[1].width) / 2;

  // Draw initial tip
  drawTaperedSegment(
    ctx,
    stroke[0].x + offsetX,
    stroke[0].y + offsetY,
    stroke[0].width,
    prevMidX,
    prevMidY,
    prevWidth
  );

  for (let i = 1; i < stroke.length - 1; i++) {
    const p1 = stroke[i];
    const p2 = stroke[i + 1];

    const currentMidX = (p1.x + p2.x) / 2 + offsetX;
    const currentMidY = (p1.y + p2.y) / 2 + offsetY;
    const currentWidth = (p1.width + p2.width) / 2;

    drawBezierCurveSegment(
      ctx,
      prevMidX,
      prevMidY,
      prevWidth,
      p1.x + offsetX,
      p1.y + offsetY,
      p1.width,
      currentMidX,
      currentMidY,
      currentWidth
    );

    prevMidX = currentMidX;
    prevMidY = currentMidY;
    prevWidth = currentWidth;
  }

  // Draw final trailing segment
  const lastPoint = stroke[stroke.length - 1];
  drawTaperedSegment(
    ctx,
    prevMidX,
    prevMidY,
    prevWidth,
    lastPoint.x + offsetX,
    lastPoint.y + offsetY,
    lastPoint.width
  );
}

/**
 * Draws a quadratic Bezier curve with smoothly varying line width
 */
function drawBezierCurveSegment(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  w0: number,
  cx: number,
  cy: number,
  wc: number,
  x1: number,
  y1: number,
  w1: number
) {
  // Approximate curve arc length
  const chord = Math.hypot(x1 - x0, y1 - y0);
  const netDist = Math.hypot(cx - x0, cy - y0) + Math.hypot(x1 - cx, y1 - cy);
  const approxLen = (chord + netDist) / 2;

  // Render dense overlapping dots to guarantee seamless, organic ink curves
  const steps = Math.max(6, Math.ceil(approxLen / 1.5));

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const invT = 1 - t;

    // Quadratic Bezier formula
    const x = invT * invT * x0 + 2 * invT * t * cx + t * t * x1;
    const y = invT * invT * y0 + 2 * invT * t * cy + t * t * y1;

    // Smooth width interpolation
    let width: number;
    if (t < 0.5) {
      const localT = t * 2;
      width = (1 - localT) * w0 + localT * wc;
    } else {
      const localT = (t - 0.5) * 2;
      width = (1 - localT) * wc + localT * w1;
    }

    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.6, width / 2), 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Draws a straight tapered segment between two points
 */
function drawTaperedSegment(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  w0: number,
  x1: number,
  y1: number,
  w1: number
) {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(4, Math.ceil(dist / 1.5));

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    const w = w0 + (w1 - w0) * t;

    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.6, w / 2), 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Exports drawn strokes into a clean, tight, auto-cropped transparent PNG
 * with 300+ DPI razor sharpness for pristine rendering in PDFs.
 */
export async function exportStrokesToPng(
  strokes: Stroke[],
  color: string,
  baseScale = 2.5
): Promise<ProcessedImageResult | null> {
  if (strokes.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxStrokeWidth = 0;

  for (const stroke of strokes) {
    for (const p of stroke) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
      if (p.width > maxStrokeWidth) maxStrokeWidth = p.width;
    }
  }

  if (minX >= maxX || minY >= maxY) return null;

  // Comfortable padding around the signature ink
  const padding = Math.round(maxStrokeWidth + 20 * baseScale);

  const inkWidth = maxX - minX;
  const inkHeight = maxY - minY;

  const cropW = Math.max(80, Math.round(inkWidth + padding * 2));
  const cropH = Math.max(50, Math.round(inkHeight + padding * 2));

  const offscreen = document.createElement('canvas');
  offscreen.width = cropW;
  offscreen.height = cropH;
  const ctx = offscreen.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  // Render on transparent background
  ctx.clearRect(0, 0, cropW, cropH);

  const offsetX = -minX + padding;
  const offsetY = -minY + padding;

  for (const stroke of strokes) {
    drawStrokeOnContext(ctx, stroke, color, offsetX, offsetY);
  }

  const transparentDataUrl = offscreen.toDataURL('image/png');
  const blob = await canvasToBlob(offscreen);
  const pngBytes = await blobToUint8Array(blob);

  return {
    transparentDataUrl,
    pngBytes,
    width: offscreen.width,
    height: offscreen.height,
    aspectRatio: offscreen.width / offscreen.height,
  };
}
