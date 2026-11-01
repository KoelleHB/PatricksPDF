# PDF Form Handling Hardening, Export Persistence & v2.4 Release (Completed)

Status: **COMPLETED & VERIFIED** (All 51 unit tests passing, clean TypeScript lint, Vite build green).

> [!IMPORTANT]
> **Confirmed Scope & Architecture**:
> - **Action & Format Resolution**: Support dual-key matching (`annot.id` reference string as primary, fully qualified field name as fallback) so actions and formatting are never missed if PDF.js generates synthetic annotation IDs.
> - **Visibility Persistence in Export**: When fields are hidden via `/Hide` actions, persist the hidden status into the exported PDF by toggling the widget's `/F` annotation flag (`AnnotationFlags.Hidden` = bit 2), so that other PDF viewers (such as Adobe Acrobat) respect the hidden state.
> - **International Number Formats**: Extend `parseSupportedFormFormatting` and `formatSupportedNumber` to support European formats (`sepStyle = 1` or `2`: dot as thousand separator, comma as decimal).
> - **Release v2.4.0**: Bump version across `package.json`, `Header.tsx`, and `appError.ts`.
> - **Documentation**: Synchronize `docs/PDF-FORMULAR-ANALYSE.md` to reflect implemented capabilities, test results, and residual constraints.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        PatricksPDF v2.4 Workflow                       │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────┐   ┌──────────────────────────┐   ┌──────────────────────────┐
│  pdfFormActions.ts      │   │  pdfFormFormatting.ts    │   │  pdfEngine.ts            │
│  - Object ref ID        │   │  - US & EU number regex  │   │  - Annot ID lookup       │
│  - Field name fallback  │   │  - Currency & dec styles │   │  - Field name fallback   │
│  - /Hide & /ResetForm   │   │  - Cycle-safe SUM calc   │   │  - Dynamic visibility    │
└────────────┬────────────┘   └────────────┬─────────────┘   └────────────┬─────────────┘
             │                             │                              │
             └──────────────────────┬──────┴──────────────────────────────┘
                                    ▼
┌───────────────────────────────────────────────────────────────────────────────────────┐
│ Interactive Form Layer & State (InteractiveFormField.tsx, PdfViewer.tsx, App.tsx)     │
│ - Live calculation & blur formatting (US/EU)                                         │
│ - Dynamic /Hide & /ResetForm event handling with Undo/Redo integration                │
└───────────────────────────────────┬───────────────────────────────────────────────────┘
                                    │
                                    ▼
┌───────────────────────────────────────────────────────────────────────────────────────┐
│ pdfExportEngine.ts (Save / Export / Print / Share)                                    │
│ - Preserves choice export values (/V) while updating appearances                      │
│ - Persists widget visibility flags (/F & AnnotationFlags.Hidden)                      │
│ - Respects maxLen, comb, and multiselect /I indices                                   │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Overview & Core Concept

* **What It Does**: Hardens interactive AcroForm form support by ensuring form actions (such as Reset and Hide) and calculations/formatting work across all PDF structures, even when PDF.js does not expose direct indirect object numbers. It ensures that changes made by `/Hide` buttons are persisted into the exported PDF binary, and enables European number inputs (`1.234,50`) alongside US standard formats.
* **Target Audience**: Users filling out, signing, and exporting government, financial, and business PDF forms on desktop and mobile/Android devices.
* **Key Value**: Guarantees zero data loss, exact PDF spec compliance for export values, persistent form visibility across third-party PDF viewers, and robust handling of international number formats.

---

## 2. Detailed Technical Plan

### A. Fallback Matching for Form Actions & Formatting
* In `src/utils/pdfFormActions.ts` and `src/utils/pdfFormFormatting.ts`:
  * When reading page annotation dictionaries, retrieve both the object reference identifier (`${ref.objectNumber}R${ref.generationNumber || ''}`) and the widget's field name (resolving `/T` directly or via parent dictionary).
  * Store entries in both maps under both the object ID key and the field name key (prefixed, e.g., `name:${fieldName}`).
  * In `src/utils/pdfEngine.ts`, resolve actions and formatting with:
    `actions.get(annot.id) ?? (annot.fieldName ? actions.get(`name:${annot.fieldName}`) : undefined)`

### B. Hidden Field Persistence during PDF Export
* Pass current `formVisibility` or set of hidden field names to `embedSignaturesIntoPdf` in `src/utils/pdfExportEngine.ts`.
* For any field marked hidden in the active session:
  * Iterate through its widget dictionaries.
  * Update the `/F` (Flags) entry to set the `Hidden` bit (`1 << 1` = 2) or `Invisible` bit (`1 << 0` = 1).
  * Clear the bit if explicitly unhidden.
* This ensures that opening the exported document in Adobe Acrobat, PDF-XChange, or browser viewers maintains identical visibility to PatricksPDF.

### C. European Number Formatting Support
* In `src/utils/pdfFormFormatting.ts`:
  * Extend regex to match both `sepStyle = 0` (US: `1,234.50`) and `sepStyle = 1` or `2` (EU: `1.234,50`).
  * Extend `parseNumber` to handle comma-as-decimal when appropriate (e.g. `1.234,50` or `1234,50`), converting cleanly to JavaScript `number`.
  * Adapt `formatSupportedNumber` to format using either en-US or de-DE conventions depending on the detected separator style.

### D. Version Bump to v2.4.0 & Code Cleanup
* Update `package.json` version to `2.4.0`.
* Update `APP_VERSION` in `src/utils/appError.ts` to `2.4.0`.
* Update version badge in `src/components/Header.tsx` to `v2.4`.
* Clean up any dead or unused imports across the modified form modules.

### E. Documentation Update
* Update `docs/PDF-FORMULAR-ANALYSE.md`:
  * Mark `/Hide` persistence in exported PDF as resolved.
  * Document European number format support.
  * Document dual-key lookup (ID + field name fallback).
  * Record current test coverage and status for v2.4.

---

## 3. Verification & Test Plan

1. **Unit Tests**:
   * Add test cases in `test/pdfFormActions.test.ts` for field-name fallback lookup and `/Hide` export persistence.
   * Add test cases in `test/pdfFormFormatting.test.ts` for European number formats (`1.234,50`), thousand-separator parsing, and cyclic calculation safety.
   * Run full test suite via `npm test` (all 50+ unit tests passing).
2. **Type & Lint Check**:
   * Run `npm run lint` (`tsc --noEmit`) to ensure 0 TypeScript diagnostic errors.
3. **Application Build**:
   * Run `compile_applet` (`npm run build`) to ensure clean production bundling.
