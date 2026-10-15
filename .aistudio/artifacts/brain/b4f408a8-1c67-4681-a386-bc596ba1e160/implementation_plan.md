# High-Performance PDF Zoom Architecture (Up to 500%) & Interaction Overhaul

Comprehensive engineering plan to expand the maximum PDF zoom capability from 250% to 500%, implement high-DPI razor-sharp canvas rendering at deep magnification, add a quick-preset zoom menu with standard increments, refine gesture anchor math for smooth focal-point pinch-to-zoom, and integrate double-tap/double-click smart zoom.

## User Review & Critical Decisions

> [!IMPORTANT]
> All primary requirements and technical preferences have been confirmed via interactive clarification:

- **Confirmed Zoom Range**: Minimum 35% to maximum **500%** (previously hard-clamped at 250%).
- **Confirmed Toolbar Controls**: Quick preset dropdown menu (`50%`, `75%`, `100%`, `125%`, `150%`, `200%`, `300%`, `400%`, `500%`, `Fit Width`, `Fit Page`) alongside the existing `+` / `-` step buttons.
- **Confirmed Core Technical Enhancements**:
  1. **Crisp High-DPI Canvas Rendering**: Dynamically scaling canvas rendering resolution beyond the legacy 2.5x cap up to device-safe limits, eliminating blurriness when magnifying fine print or signatures.
  2. **True Focal-Point Pinch-to-Zoom**: Anchoring zoom transformations to the geometric midpoint between fingers or mouse cursor position, eliminating viewport jumpiness.
  3. **Smart Double-Tap / Double-Click Zoom**: Toggling between overview/fit-width and 200%/300% zoom centered on the exact clicked/tapped location, matching mobile OS standards.

---

## 1. Overview & Core Concept

Currently, `PdfViewer.tsx` has multiple hardcoded clamps limiting zoom to 250% (`Math.min(250, ...)` across wheel, pinch, and step-button handlers). Furthermore, `PdfPageView.tsx` clamps the off-screen canvas rendering multiplier to `Math.min(2.5, ...)`, meaning zooming in beyond 150–200% results in blurry, pixelated text and lines.

This overhaul upgrades the zoom engine into a professional-grade viewing system supporting up to 500% magnification, combining smooth CSS visual feedback during interactive gestures with debounced, memory-safe high-DPI canvas re-rendering.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Toolbar Zoom Preset Menu**:
   - Clicking the zoom percentage indicator (e.g. `100%`) in the viewer toolbar opens a clean, compact dropdown menu.
   - Presets include: `Fit Width`, `Fit Page`, divider, and percentage tiers: `50%`, `75%`, `100%`, `125%`, `150%`, `200%`, `300%`, `400%`, `500%`.
   - The active zoom level is marked with an indicator dot. Clicking a preset instantly sets that zoom level with focal centering on the current viewport center.

2. **Step Button Zooming (+ / -)**:
   - `+` increases zoom by +25% up to 500% (with smooth scroll anchor preservation).
   - `-` decreases zoom by -25% down to 35%.
   - Disabled visual state when reaching min (35%) or max (500%).

3. **Pinch-to-Zoom (Touch & Trackpad)**:
   - Two-finger pinch gestures scale the document smoothly in real time.
   - The point on the PDF page directly under the fingers remains pinned in place.
   - Floating zoom pill displays real-time percentage during pinch (e.g. `342%`).
   - Upon release, the canvas re-renders at high resolution for crisp text.

4. **Double-Tap / Double-Click Quick Zoom**:
   - Double-clicking or double-tapping on an empty area of the PDF page instantly zooms in to 250% centered on that exact tapped spot.
   - A subsequent double-click toggles back to `Fit Width` (or 100%).
   - Dragging signatures or text overlays does not trigger double-click zoom.

### Visual Styling & Accessibility
- **Dropdown Menu**: Clean Tailwind popover with subtle border (`border-slate-200`), backdrop blur, smooth fade/scale animation, and keyboard accessibility (`Escape` to close).
- **Floating Zoom Pill**: Smooth pulse badge showing active magnification without cluttering the screen.
- **Touch Targets**: All zoom buttons and menu items strictly maintain $\ge 40\text{px}$ touch targets.

---

## 3. Key Product Decisions & Trade-Offs

### Decision 1: High-DPI Canvas Rendering at 500% vs GPU Memory Safety
- **The Challenge**: An A4 PDF page (595x842 pt) at 500% with a 2x retina display multiplier would require a 5950x8420 px canvas (approx. 200 MB uncompressed texture memory per page), which can crash mobile browsers.
- **Chosen Approach**: Dynamic capped scale multiplier:
  $$\text{scaleMultiplier} = \min\left(4.0, \max\left(1.5, \frac{\text{zoomLevel}}{100} \times \min(\text{window.devicePixelRatio}, 2)\right)\right)$$
  Combined with max canvas pixel area limits ($\le 16{,}000{,}000\text{ px}^2$).
- **Why**: Delivers razor-sharp text and lines up to 500% zoom while remaining well within safe iOS Safari and Android Chrome canvas memory budgets.

### Decision 2: Real-Time Smooth Gesture CSS Transform vs High-Resolution Canvas Redraw
- **Chosen Approach**: Two-phase rendering:
  - *Phase A (During gesture)*: Instant CSS hardware-accelerated transform (`transform: scale(...)`) on the page wrapper for 60fps buttery feedback.
  - *Phase B (Gesture end)*: Debounced PDF.js canvas re-render at the target scale once the user releases their fingers.

---

## 4. Technical Architecture & Component Structure

```
┌─────────────────────────────────────────────────────────────┐
│                      PdfViewer                              │
│  - zoomLevel State (35% - 500%)                             │
│  - isFitWidthMode State                                     │
│  - ZoomAnchor Capture & Scroll Restoration Engine           │
│  - Pinch & Touch Gesture Coordinator                        │
│  - Double-Tap Detection Engine                              │
└──────────────┬───────────────────────────────┬──────────────┘
               │                               │
               ▼                               ▼
┌─────────────────────────────┐  ┌─────────────────────────────┐
│   Top Toolbar & Presets     │  │   PdfPageView (Per Page)    │
│  - ZoomOut (-)              │  │  - Scaled Dimensions (px)   │
│  - ZoomLevel Dropdown Menu  │  │  - Dynamic scaleMultiplier  │
│  - ZoomIn (+)               │  │  - Off-screen High-DPI      │
│  - Fit Width / Fit Page     │  │    Canvas Render Task       │
│  - Real-time Zoom Pill      │  │  - Text & Signature Overlays │
└─────────────────────────────┘  └─────────────────────────────┘
```

### Component & File Modifications

1. `src/components/PdfViewer.tsx`:
   - Raise zoom clamp bounds from `[35, 250]` to `[35, 500]`.
   - Update `calculateFitWidthZoom`, `handleWheel`, `handlePinchMove`, `handlePinchEnd`, `handleGestureChange`, `handleZoomIn`, `handleZoomOut`.
   - Implement `isZoomMenuOpen` state and `ZoomPresetDropdown` component.
   - Implement double-tap / double-click event listener on page container that computes tapped page coordinates and animates zoom to 250% (or toggles to fit-width).

2. `src/components/PdfPageView.tsx`:
   - Update `scaleMultiplier` formula to allow higher resolution rendering up to scale 4.0 (with memory guarding).
   - Ensure textLayer container and interactive form fields accurately adapt to the 500% scale without visual clipping.

3. `src/utils/pdfEngine.ts`:
   - Safeguard `renderPdfPageToCanvas` offscreen canvas dimensions against maximum browser texture limits (`Math.min(maxWidth, 4096)`).

---

## Verification & Testing Plan

1. **Magnification Range Verification**:
   - Test stepping up via `+` button from 100% to 500% in 25% increments.
   - Test stepping down via `-` button to 35%.
2. **Preset Menu Verification**:
   - Open preset dropdown, select each preset (`50%`, `100%`, `200%`, `300%`, `500%`, `Fit Width`, `Fit Page`), confirm instant, accurate application.
3. **Canvas Sharpness Verification**:
   - Zoom into 500% on high-detail vector text and transparent signatures; confirm crisp rendering without blur or pixelation.
4. **Pinch & Double-Tap Gesture Verification**:
   - Pinch-to-zoom on touch devices; confirm the touch midpoint remains stable.
   - Double-tap on a specific paragraph; confirm viewport centers and zooms in on that exact location.
