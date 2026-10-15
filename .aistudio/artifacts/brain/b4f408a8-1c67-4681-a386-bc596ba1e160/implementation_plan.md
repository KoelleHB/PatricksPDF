# High-Precision PDF Text Selection & Mobile APK Copying Architecture

Comprehensive engineering plan to fix PDF text selection alignment on desktop and enable natural long-press text marking, native Android selection handles, and quick copying in the mobile APK.

## User Review & Critical Decisions

> [!IMPORTANT]
> The requirements and preferred user experience have been confirmed:

- **Confirmed Mobile APK Selection**: Natural long-press text selection with native Android selection handles and magnifier (`Natürliches langes Drücken mit Textauswahl-Griffen`).
- **Confirmed Copy Options**: Dual support for both the native system context menu (`Copy`, `Share`) and a modern floating copy toolbar (`Schwebende Kopier-Leiste und natives System-Kontextmenü`).
- **Desktop Accuracy Fix**: Perfect 1:1 sub-pixel glyph alignment between invisible text spans and rendered canvas pixels across all zoom levels (from 35% up to 500%).

---

## 1. Overview & Root Cause Analysis

### Why selections are inaccurate on Desktop
1. **Missing `--scale-factor` CSS variable**: Modern PDF.js (v4) calculates textLayer span widths, heights, and font sizes using `calc(var(--scale-factor) * ...)`. Because `--scale-factor` was never set on the container or element, CSS evaluated at scale 1.0 while the page was visually scaled (e.g. 150%, 250%, 500%), causing huge positional drift between cursor drags and actual text.
2. **Incomplete TextLayer CSS rules**: Handwritten textLayer CSS lacked `transform-origin`, proper ascent/descent metrics, and white-space collapsing rules present in official PDF.js viewer stylesheets.

### Why text selection does not work in the mobile APK
1. **`select-none` on parent containers**: In `PdfViewer.tsx`, the workspace scroll container (`containerRef`) had Tailwind's `select-none` (`user-select: none; -webkit-user-select: none;`). In Android WebView (Capacitor), ancestor `user-select: none` causes the WebView engine to completely suppress native touch text selection and long-press handles on all child elements.
2. **Touch listener conflicts**: Custom touch event handlers on the scroll container intercepted single-finger touches and prevented default gesture propagation to the textLayer.
3. **Missing touch-action and selection rules**: Mobile WebViews require explicit `touch-action: pan-x pan-y`, `-webkit-user-select: text !important`, and `pointer-events: auto` on textLayer child spans to trigger native selection handles.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Desktop Selection (Mouse Dragging)**:
   - User clicks and drags cursor across words, sentences, or paragraphs on any page.
   - Highlighting rectangle matches the visible canvas font glyphs with sub-pixel precision.
   - Standard browser copy (`Ctrl+C` / `Cmd+C`) works instantly.
   - Floating quick-action pill offers an instant single-click "Copy" button with a checkmark feedback animation.

2. **Mobile APK Selection (Touch Long-Press)**:
   - User presses and holds a finger on any word in the PDF.
   - Native Android selection handles (teardrop pins) appear, along with the system menu (`Kopieren`, `Teilen`, `Alles auswählen`).
   - User can drag pins to extend the selection across paragraphs.
   - A quiet, floating copy bar appears above the mobile navigation bar with a "Copy Text" button for quick thumb access.

### Visual Styling & Accessibility
- **Selection Highlight Tint**: Soft semi-transparent blue (`rgba(37, 99, 235, 0.28)`) that preserves underlying document legibility.
- **Copy Pill Bar**: Floating bottom-centered card with subtle border (`border-slate-200`), backdrop blur, copy icon, word count indicator, and 2-second confirmation toast.

---

## 3. Key Product Decisions & Trade-Offs

### Decision 1: Scoped Selection Permissiveness
- **Chosen Approach**: Remove `select-none` from the document viewing viewport and page container. Apply `select-none` only to interactive toolbars, signature overlays, stamp badges, and UI buttons.
- **Why**: Allows Android WebView to trigger native selection handles on text while preventing accidental blue selection rectangles on UI chrome or signature drag handles.

### Decision 2: Injection of `--scale-factor` and Official PDF.js Text Layer CSS
- **Chosen Approach**:
  1. Pass the exact calculated `viewport.scale` into `container.style.setProperty('--scale-factor', `${viewport.scale}`);` inside `renderPdfTextLayer`.
  2. Embed the complete, production-grade PDF.js v4 text layer styling in `index.css`.
- **Why**: Guarantees zero pixel offset between text divs and the underlying canvas across all zoom levels (35% to 500%).

---

## 4. Technical Architecture & Modifications

```
┌──────────────────────────────────────────────────────────────┐
│                    PdfViewer Component                       │
│  - Remove `select-none` from containerRef & contentWrapper   │
│  - Single-finger touch passthrough for native text selection │
│  - TextSelectionToolbar integration with mobile viewport     │
└──────────────┬───────────────────────────────┬───────────────┘
               │                               │
               ▼                               ▼
┌─────────────────────────────┐  ┌─────────────────────────────┐
│    PdfPageView Component    │  │    pdfEngine / TextLayer    │
│  - textLayerRef with        │  │  - setProperty(             │
│    `--scale-factor`         │  │      '--scale-factor',      │
│  - `pointer-events: auto`   │  │      viewport.scale         │
│  - `user-select: text`      │  │    )                        │
└─────────────────────────────┘  └─────────────────────────────┘
```

### Component & File Modifications

1. `src/utils/pdfEngine.ts`:
   - In `renderPdfTextLayer`, set `--scale-factor` property:
     ```ts
     container.style.setProperty('--scale-factor', `${viewport.scale}`);
     ```
   - Set container width, height, and CSS variables properly.
   - Ensure clean cancelation and memory release on page unload.

2. `src/index.css`:
   - Replace minimal `.textLayer` rules with complete PDF.js v4 textLayer definitions.
   - Ensure `-webkit-user-select: text !important`, `user-select: text !important`, and proper touch-action.
   - Set selection highlight color to a clean, modern accent.

3. `src/components/PdfPageView.tsx`:
   - Add explicit inline CSS variable `--scale-factor` to `textLayerRef.current`.
   - Ensure container has `select-text`, `pointer-events-auto`, and `z-10` above the canvas (`z-0`).

4. `src/components/PdfViewer.tsx`:
   - Remove `select-none` from `containerRef` and `contentWrapperRef`.
   - Update `handleTouchStart` so single-finger touches over text don't conflict with native long-press text selection.
   - Add `select-none` specifically to buttons, headers, and signature drag overlays.

5. `src/components/TextSelectionToolbar.tsx`:
   - Enhance mobile layout so the floating copy button is comfortably positioned above mobile navigation bars.
   - Add copy confirmation feedback and clear selection button.

---

## Verification & Testing Plan

1. **Desktop Selection Accuracy**:
   - Open a multi-column or small-font PDF.
   - Highlight text at 100%, 200%, and 400% zoom.
   - Confirm selection boxes match the visible letters exactly without offset or drifting.
2. **Mobile APK Long-Press Test**:
   - Long-press a word on a touch screen / mobile WebView.
   - Confirm native selection handles appear and text can be highlighted.
   - Verify floating copy button and native copy menu both copy the exact selected string to the clipboard.
3. **No Gesture Regression**:
   - Test two-finger pinch-to-zoom and double-tap zoom to ensure they continue working seamlessly.
