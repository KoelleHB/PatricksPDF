import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractViewportPageSnapshot,
  computeSignaturePlacement,
  computeTextPlacement,
} from '../src/utils/pdfPlacement.ts';

test('extractViewportPageSnapshot detects active page at viewport center and computes visible bounds', () => {
  const containerRect = {
    left: 0,
    top: 100,
    right: 600,
    bottom: 700,
    width: 600,
    height: 600,
  };

  // Page 2 is zoomed in (1200x1600) and panned so its bottom-right quadrant is in the viewport
  const pageRects = [
    {
      pageNumber: 1,
      rect: { left: -400, top: -1800, right: 800, bottom: -200, width: 1200, height: 1600 },
    },
    {
      pageNumber: 2,
      rect: { left: -600, top: -700, right: 600, bottom: 900, width: 1200, height: 1600 },
    },
  ];

  const snapshot = extractViewportPageSnapshot(containerRect, pageRects, 1);
  assert.ok(snapshot);
  assert.equal(snapshot.pageNumber, 2);
  // Horizontal visible slice: [0..600] relative to page [-600..600] -> 50%..100%
  assert.equal(snapshot.visibleLeftPercent, 50);
  assert.equal(snapshot.visibleRightPercent, 100);
  // Vertical visible slice: [100..700] relative to page [-700..900] (offset 800..1400 of 1600) -> 50%..87.5%
  assert.equal(snapshot.visibleTopPercent, 50);
  assert.equal(snapshot.visibleBottomPercent, 87.5);
});

test('computeSignaturePlacement centers signature in zoomed viewport and adapts width to visible area', () => {
  // User zoomed into bottom-right area: X [60%..90%] (30% visible width), Y [65%..95%] (30% visible height)
  const snapshot = {
    pageNumber: 3,
    pageWidthPx: 1800,
    pageHeightPx: 2545,
    visibleLeftPercent: 60,
    visibleRightPercent: 90,
    visibleTopPercent: 65,
    visibleBottomPercent: 95,
  };

  const placement = computeSignaturePlacement({
    snapshot,
    fallbackPageNumber: 1,
    defaultWidthPercent: 28,
    aspectRatio: 2.5,
    existingPlacements: [],
  });

  assert.equal(placement.pageNumber, 3);
  // Since visible width is 30%, widthPercent should adapt down from 28% to ~12.6% (30 * 0.42)
  assert.ok(
    placement.widthPercent < 15 && placement.widthPercent >= 6,
    `Expected zoom-adapted widthPercent, got ${placement.widthPercent}`
  );

  // Visual center X of the signature should be at ~75% (midpoint of 60..90)
  const visualCenterX = placement.xPercent + placement.widthPercent / 2;
  assert.ok(
    Math.abs(visualCenterX - 75) < 0.5,
    `Expected visualCenterX near 75%, got ${visualCenterX}`
  );

  // Signature must lie strictly inside the visible [60..90] x [65..95] viewport
  assert.ok(placement.xPercent >= 60);
  assert.ok(placement.xPercent + placement.widthPercent <= 90);
  assert.ok(placement.yPercent >= 65);
  assert.ok(placement.yPercent <= 95);
});

test('computeSignaturePlacement applies cascading offset on consecutive insertions without scrolling', () => {
  const snapshot = {
    pageNumber: 1,
    pageWidthPx: 800,
    pageHeightPx: 1131,
    visibleLeftPercent: 20,
    visibleRightPercent: 80,
    visibleTopPercent: 30,
    visibleBottomPercent: 80,
  };

  const first = computeSignaturePlacement({
    snapshot,
    fallbackPageNumber: 1,
    defaultWidthPercent: 28,
    aspectRatio: 2.2,
    existingPlacements: [],
  });

  const second = computeSignaturePlacement({
    snapshot,
    fallbackPageNumber: 1,
    defaultWidthPercent: 28,
    aspectRatio: 2.2,
    existingPlacements: [first],
  });

  assert.ok(second.xPercent > first.xPercent, 'Second signature should be offset horizontally');
  assert.ok(second.yPercent > first.yPercent, 'Second signature should be offset vertically');
});

test('computeTextPlacement centers text in visible viewport and cascades on collision', () => {
  const snapshot = {
    pageNumber: 2,
    pageWidthPx: 1000,
    pageHeightPx: 1414,
    visibleLeftPercent: 40,
    visibleRightPercent: 80,
    visibleTopPercent: 20,
    visibleBottomPercent: 60,
  };

  const first = computeTextPlacement({
    snapshot,
    fallbackPageNumber: 1,
    text: 'Max Mustermann',
    fontSize: 16,
    fontFamily: 'standard',
    existingPlacements: [],
  });

  assert.equal(first.pageNumber, 2);
  assert.ok(first.xPercent >= 40 && first.xPercent <= 80);
  assert.ok(first.yPercent >= 20 && first.yPercent <= 60);

  const second = computeTextPlacement({
    snapshot,
    fallbackPageNumber: 1,
    text: 'Max Mustermann',
    fontSize: 16,
    fontFamily: 'standard',
    existingPlacements: [first],
  });

  assert.ok(second.xPercent > first.xPercent);
  assert.ok(second.yPercent > first.yPercent);
});
