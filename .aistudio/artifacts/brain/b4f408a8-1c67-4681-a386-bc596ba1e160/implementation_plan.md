# Isolate Text Overlay Double-Tap & Toolbar Event Handling

Prevent rapid clicks or double-taps on the floating text action bar (such as `A+` / `A-` font size buttons, font/color toggles, or precision nudge controls) from bubbling up and accidentally opening the inline text editor.

## User Review & Critical Decisions

> [!IMPORTANT]
> No open questions require clarification—the root cause is event bubbling from the floating toolbar into the parent text container's double-click handler.

- **Confirmed Scope**: Double-clicking or double-tapping **only** on the placed text box itself will open the inline text editor. Rapidly tapping `A+`, `A-`, or any other area of the dark floating toolbar or nudge popover will strictly execute the button action without triggering edit mode.

---

## 1. Overview & Core Concept

- **What It Does**: Decouples the floating action toolbar and precision nudge popover from the text box's double-click / double-tap edit trigger.
- **Target Audience / Persona**: Mobile (PWA / Android APK) and desktop users who rapidly tap `A+` or `A-` to adjust text size from `14pt` up to `60pt` or quickly cycle through colors and fonts.
- **Key Value**: Eliminates accidental transitions into the multiline text input modal when adjusting styling or position via the floating toolbar.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Rapid Font Size / Style Adjustments**: Selecting a text box and rapidly clicking or tapping `A+`, `A-`, `Script`, `Black`, or `Nudge` smoothly updates the text overlay in place without ever switching to the text input editor.
  2. **Intentional Double-Tap / Double-Click to Edit**: Double-clicking (desktop) or double-tapping (touch devices) directly on the rendered text box content opens the inline text editor as expected, alongside the explicit `Edit` button in the toolbar.
- **Visual Identity & Theme**:
  - Preserves the existing high-contrast dark floating toolbar (`bg-slate-900/95`) and blue selection ring (`ring-blue-500`) without visual layout changes.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Scope Double-Click / Double-Tap Strictly to the Text Content Box + Stop Toolbar Bubbling**
  - *Chosen Approach*:
    1. Guard the double-click handler so any event originating inside `[data-text-tools]`, `button`, `input`, or `textarea` is immediately ignored.
    2. Attach explicit `onDoubleClick` and `onClick` propagation stops on both floating toolbars (the dark Selection Action Toolbar and the Precision Nudge Panel).
    3. Bind the double-click and touch double-tap detector directly to the rendered text preview element rather than the outer wrapper that encloses the floating toolbars.
  - *Why*: In React's synthetic event tree, child toolbars rendered inside the positioned overlay wrapper bubble `dblclick` events up to the parent container whenever a button like `A+` is pressed twice within ~300 ms. Stopping propagation at the toolbar boundary and scoping the edit trigger to the text surface eliminates the bug completely across mouse, stylus, and touch inputs.
  - *Alternatives Considered*: Adding a debounce to `A+`/`A-` was rejected because users intentionally tap `A+`/`A-` rapidly to change font sizes in 2pt steps.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Event Isolation Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│ Outer Positioned Text Overlay Wrapper                                │
│  • Handles drag start (ignores [data-text-tools] & buttons)          │
├──────────────────────────────────────────────────────────────────────┤
│  ├─► Dark Selection Action Toolbar ([data-text-tools="true"])        │
│  │    • Stops propagation: onPointerDown, onClick, onDoubleClick     │
│  │    • Controls: [Edit] [Script] [Color] [A- / A+] [Nudge] [Copy]   │
│  │                                                                   │
│  ├─► Extended Precision Nudge Panel ([data-text-tools="true"])       │
│  │    • Stops propagation: onPointerDown, onClick, onDoubleClick     │
│  │    • Controls: Directional arrows & horizontal center             │
│  │                                                                   │
│  └─► Rendered Text Surface                                           │
│       • Triggers setIsEditing(true) on double-click / double-tap     │
└──────────────────────────────────────────────────────────────────────┘
```

### Interactive Component & State Mapping

- **Floating Toolbar & Precision Panel (`[data-text-tools="true"]`)**:
  - Intercepts and halts `onPointerDown`, `onClick`, and `onDoubleClick` bubbling so rapid button taps only invoke their respective handler (`changeFontSize`, `toggleFont`, `toggleColor`, `nudge`).
- **Rendered Text Surface**:
  - Handles `onDoubleClick` (desktop/mouse) and a lightweight touch double-tap check (for mobile touch screens where `touch-action: none` is active) to transition `isEditing` to `true` only when the user double-taps the actual text box.
- **Automated Verification**:
  - Add a dedicated unit test verifying that rapid double-clicks on `A+`, `A-`, and the floating toolbar adjust font size without entering edit mode, while double-clicking the text surface opens edit mode.
