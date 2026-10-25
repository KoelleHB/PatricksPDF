export interface RectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface ViewportPageSnapshot {
  pageNumber: number;
  pageWidthPx: number;
  pageHeightPx: number;
  visibleLeftPercent: number;
  visibleRightPercent: number;
  visibleTopPercent: number;
  visibleBottomPercent: number;
}

export interface ExistingPlacement {
  pageNumber: number;
  xPercent: number;
  yPercent: number;
}

export interface PlacementResult {
  pageNumber: number;
  xPercent: number;
  yPercent: number;
  widthPercent: number;
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.max(min, Math.min(max, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Computes which page is at the center of the scrollable viewport container
 * and returns the visible sub-rectangle of that page in percentage coordinates (0..100).
 */
export function extractViewportPageSnapshot(
  containerRect: RectLike,
  pageRects: Array<{ pageNumber: number; rect: RectLike }>,
  fallbackPageNumber: number = 1
): ViewportPageSnapshot | null {
  if (containerRect.width <= 0 || containerRect.height <= 0 || pageRects.length === 0) {
    return null;
  }

  const validPages = pageRects.filter((p) => p.rect.width > 0 && p.rect.height > 0);
  if (validPages.length === 0) {
    return null;
  }

  const viewportCenterY = containerRect.top + containerRect.height / 2;

  let chosen = validPages[0];
  let bestDistance = Infinity;

  for (const entry of validPages) {
    const { rect } = entry;
    if (viewportCenterY >= rect.top && viewportCenterY <= rect.bottom) {
      chosen = entry;
      bestDistance = 0;
      break;
    }
    const pageMidY = (rect.top + rect.bottom) / 2;
    const dist = Math.abs(viewportCenterY - pageMidY);
    if (dist < bestDistance || (dist === bestDistance && entry.pageNumber === fallbackPageNumber)) {
      bestDistance = dist;
      chosen = entry;
    }
  }

  const { pageNumber, rect: pageRect } = chosen;

  const intersectLeft = Math.max(containerRect.left, pageRect.left);
  const intersectRight = Math.min(containerRect.right, pageRect.right);
  const intersectTop = Math.max(containerRect.top, pageRect.top);
  const intersectBottom = Math.min(containerRect.bottom, pageRect.bottom);

  const visibleLeftPercent =
    intersectRight > intersectLeft
      ? clamp(((intersectLeft - pageRect.left) / pageRect.width) * 100, 0, 100)
      : 0;
  const visibleRightPercent =
    intersectRight > intersectLeft
      ? clamp(((intersectRight - pageRect.left) / pageRect.width) * 100, 0, 100)
      : 100;

  const visibleTopPercent =
    intersectBottom > intersectTop
      ? clamp(((intersectTop - pageRect.top) / pageRect.height) * 100, 0, 100)
      : 0;
  const visibleBottomPercent =
    intersectBottom > intersectTop
      ? clamp(((intersectBottom - pageRect.top) / pageRect.height) * 100, 0, 100)
      : 100;

  return {
    pageNumber,
    pageWidthPx: pageRect.width,
    pageHeightPx: pageRect.height,
    visibleLeftPercent: round2(visibleLeftPercent),
    visibleRightPercent: round2(visibleRightPercent),
    visibleTopPercent: round2(visibleTopPercent),
    visibleBottomPercent: round2(visibleBottomPercent),
  };
}

function resolveCascadeAndClamp(params: {
  pageNumber: number;
  baseX: number;
  baseY: number;
  itemWidthPercent: number;
  itemHeightPercent: number;
  visibleLeftPercent: number;
  visibleRightPercent: number;
  visibleTopPercent: number;
  visibleBottomPercent: number;
  existingPlacements: ExistingPlacement[];
}): { xPercent: number; yPercent: number } {
  const {
    pageNumber,
    baseX,
    baseY,
    itemWidthPercent,
    itemHeightPercent,
    visibleLeftPercent,
    visibleRightPercent,
    visibleTopPercent,
    visibleBottomPercent,
    existingPlacements,
  } = params;

  const visibleWidth = Math.max(5, visibleRightPercent - visibleLeftPercent);
  const visibleHeight = Math.max(5, visibleBottomPercent - visibleTopPercent);

  const marginX = Math.min(1.5, visibleWidth * 0.04);
  const marginY = Math.min(1.5, visibleHeight * 0.04);

  const minPageX = 1;
  const maxPageX = Math.max(minPageX, 99 - itemWidthPercent);
  const minPageY = 1;
  const maxPageY = Math.max(minPageY, 99 - itemHeightPercent);

  const minVisX = clamp(visibleLeftPercent + marginX, minPageX, maxPageX);
  const maxVisX = clamp(visibleRightPercent - itemWidthPercent - marginX, minVisX, maxPageX);
  const minVisY = clamp(visibleTopPercent + marginY, minPageY, maxPageY);
  const maxVisY = clamp(visibleBottomPercent - itemHeightPercent - marginY, minVisY, maxPageY);

  const stepX = clamp(visibleWidth * 0.04, 0.8, 3.5);
  const stepY = clamp(visibleHeight * 0.04, 0.8, 3.5);
  const collisionThresholdX = Math.max(0.5, stepX * 0.75);
  const collisionThresholdY = Math.max(0.5, stepY * 0.75);

  const samePageItems = existingPlacements.filter((item) => item.pageNumber === pageNumber);

  let candidateX = clamp(baseX, minVisX, maxVisX);
  let candidateY = clamp(baseY, minVisY, maxVisY);

  for (let attempt = 0; attempt < 10; attempt++) {
    const rawCandidateX = baseX + attempt * stepX;
    const rawCandidateY = baseY + attempt * stepY;
    candidateX = clamp(rawCandidateX, minVisX, maxVisX);
    candidateY = clamp(rawCandidateY, minVisY, maxVisY);

    const hasCollision = samePageItems.some(
      (existing) =>
        Math.abs(existing.xPercent - candidateX) < collisionThresholdX &&
        Math.abs(existing.yPercent - candidateY) < collisionThresholdY
    );

    if (!hasCollision) {
      break;
    }
  }

  return {
    xPercent: round2(candidateX),
    yPercent: round2(candidateY),
  };
}

/**
 * Computes viewport-centered, zoom-adapted placement for a newly inserted signature.
 */
export function computeSignaturePlacement(params: {
  snapshot: ViewportPageSnapshot | null;
  fallbackPageNumber: number;
  defaultWidthPercent?: number;
  aspectRatio?: number;
  existingPlacements?: ExistingPlacement[];
}): PlacementResult {
  const {
    snapshot,
    fallbackPageNumber,
    defaultWidthPercent = 28,
    aspectRatio = 2.2,
    existingPlacements = [],
  } = params;

  const safeAspect = Number.isFinite(aspectRatio) && aspectRatio > 0.1 ? aspectRatio : 2.2;
  const pageNumber = snapshot ? snapshot.pageNumber : fallbackPageNumber;

  const visibleLeft = snapshot ? snapshot.visibleLeftPercent : 0;
  const visibleRight = snapshot ? snapshot.visibleRightPercent : 100;
  const visibleTop = snapshot ? snapshot.visibleTopPercent : 0;
  const visibleBottom = snapshot ? snapshot.visibleBottomPercent : 100;

  const visibleWidth = Math.max(5, visibleRight - visibleLeft);
  const visibleHeight = Math.max(5, visibleBottom - visibleTop);

  const pageWidthPx = snapshot && snapshot.pageWidthPx > 0 ? snapshot.pageWidthPx : 595;
  const pageHeightPx = snapshot && snapshot.pageHeightPx > 0 ? snapshot.pageHeightPx : 842;
  const pageAspect = pageWidthPx / pageHeightPx;

  // Adapt initial width to the visible zoom window (~42% of visible width, capped at defaultWidthPercent)
  const minAllowedWidth = Math.min(6, visibleWidth * 0.75);
  let widthPercent = clamp(
    Math.min(defaultWidthPercent, visibleWidth * 0.42),
    minAllowedWidth,
    defaultWidthPercent
  );

  let heightPercent = (widthPercent * pageAspect) / safeAspect;
  const maxAllowedHeight = visibleHeight * 0.45;
  if (heightPercent > maxAllowedHeight && heightPercent > 0) {
    const scaleDown = maxAllowedHeight / heightPercent;
    widthPercent = clamp(widthPercent * scaleDown, minAllowedWidth, defaultWidthPercent);
    heightPercent = (widthPercent * pageAspect) / safeAspect;
  }

  widthPercent = round2(widthPercent);

  const centerX = (visibleLeft + visibleRight) / 2;
  const centerY = (visibleTop + visibleBottom) / 2;

  const baseX = centerX - widthPercent / 2;
  const baseY = centerY - heightPercent / 2;

  const { xPercent, yPercent } = resolveCascadeAndClamp({
    pageNumber,
    baseX,
    baseY,
    itemWidthPercent: widthPercent,
    itemHeightPercent: heightPercent,
    visibleLeftPercent: visibleLeft,
    visibleRightPercent: visibleRight,
    visibleTopPercent: visibleTop,
    visibleBottomPercent: visibleBottom,
    existingPlacements,
  });

  return {
    pageNumber,
    xPercent,
    yPercent,
    widthPercent,
  };
}

/**
 * Computes viewport-centered, zoom-adapted placement for a newly inserted text overlay.
 */
export function computeTextPlacement(params: {
  snapshot: ViewportPageSnapshot | null;
  fallbackPageNumber: number;
  text: string;
  fontSize: number;
  fontFamily?: 'standard' | 'script';
  defaultWidthPercent?: number;
  existingPlacements?: ExistingPlacement[];
  basePageWidthPt?: number;
  basePageHeightPt?: number;
}): PlacementResult {
  const {
    snapshot,
    fallbackPageNumber,
    text,
    fontSize,
    fontFamily = 'standard',
    defaultWidthPercent = 25,
    existingPlacements = [],
    basePageWidthPt = 595,
    basePageHeightPt = 842,
  } = params;

  const pageNumber = snapshot ? snapshot.pageNumber : fallbackPageNumber;
  const visibleLeft = snapshot ? snapshot.visibleLeftPercent : 0;
  const visibleRight = snapshot ? snapshot.visibleRightPercent : 100;
  const visibleTop = snapshot ? snapshot.visibleTopPercent : 0;
  const visibleBottom = snapshot ? snapshot.visibleBottomPercent : 100;

  const visibleWidth = Math.max(5, visibleRight - visibleLeft);
  const visibleHeight = Math.max(5, visibleBottom - visibleTop);

  const minAllowedWidth = Math.min(10, visibleWidth * 0.8);
  const widthPercent = round2(
    clamp(Math.min(defaultWidthPercent, visibleWidth * 0.45), minAllowedWidth, defaultWidthPercent)
  );

  // Estimate visual bounding box of the rendered text in page percentage coordinates
  const lines = (text || 'Text').split('\n');
  const maxLineChars = Math.max(1, ...lines.map((l) => l.length));
  const fontMultiplier = fontFamily === 'script' ? 1.25 : 1.0;
  const effectiveFontPt = Math.max(8, fontSize) * fontMultiplier;

  const safeBaseWidth = basePageWidthPt > 0 ? basePageWidthPt : 595;
  const safeBaseHeight = basePageHeightPt > 0 ? basePageHeightPt : 842;

  const estimatedTextWidthPt = maxLineChars * effectiveFontPt * 0.52;
  const estimatedTextHeightPt = lines.length * effectiveFontPt * 1.25;

  const estimatedWidthPercent = clamp(
    (estimatedTextWidthPt / safeBaseWidth) * 100,
    2,
    Math.min(85, visibleWidth * 0.85)
  );
  const estimatedHeightPercent = clamp(
    (estimatedTextHeightPt / safeBaseHeight) * 100,
    1.5,
    Math.min(60, visibleHeight * 0.8)
  );

  const centerX = (visibleLeft + visibleRight) / 2;
  const centerY = (visibleTop + visibleBottom) / 2;

  const baseX = centerX - estimatedWidthPercent / 2;
  const baseY = centerY - estimatedHeightPercent / 2;

  const { xPercent, yPercent } = resolveCascadeAndClamp({
    pageNumber,
    baseX,
    baseY,
    itemWidthPercent: estimatedWidthPercent,
    itemHeightPercent: estimatedHeightPercent,
    visibleLeftPercent: visibleLeft,
    visibleRightPercent: visibleRight,
    visibleTopPercent: visibleTop,
    visibleBottomPercent: visibleBottom,
    existingPlacements,
  });

  return {
    pageNumber,
    xPercent,
    yPercent,
    widthPercent,
  };
}
