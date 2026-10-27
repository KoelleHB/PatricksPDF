# Implementation Plan: Background Auto-Save & Working Draft Persistence

## 1. Architecture & Storage Strategy (`PatricksPDFRecentDB` v3 + Emergency Lifecycle Flush)

To ensure edits survive a force-close of the PWA or Android APK while keeping all placed elements (signatures, text annotations, form fields) fully editable upon reopening, we separate the **Original PDF Blob** from the **Working Draft Snapshot**:

1. **IndexedDB Schema Upgrade (`DB_VERSION = 3` in `src/utils/recentDocuments.ts`)**:
   - `recent_docs_meta`: Stores lightweight `RecentDocumentRecord` metadata, extended with draft status fields:
     - `hasDraft?: boolean` (true when unsaved working edits exist)
     - `hasWorkingCopy?: boolean` (true when editable overlays/page edits exist, even after export)
     - `draftUpdatedAt?: number` (timestamp of last background save)
     - `formEditCount?: number` (number of modified form fields)
     - `hasPageModifications?: boolean` (whether pages were rotated, deleted, or reordered)
   - `recent_docs_blobs`: Continues to store the **unmodified original `pdfBuffer`** (`{ id, pdfBuffer }`) keyed by the original document's deterministic fingerprint (`docId`), guaranteeing we can always reset back to the pristine original PDF.
   - `recent_docs_drafts` (New Object Store, `keyPath: 'id'`): Stores the structured `DocumentDraftRecord` for `docId`:
     - `id: string` (matches original `docId`)
     - `updatedAt: number`
     - `isUnsavedDraft: boolean` (true if modified since last explicit Save/Export; cleared to `false` on Save/Export while keeping the editable elements intact)
     - `currentPage: number`
     - `hasPageModifications: boolean`
     - `modifiedPdfBuffer?: ArrayBuffer` (only stored when structural page changes like rotation/reordering/deletion were applied; omitted otherwise to save space and write speed)
     - `signatures: SignatureItem[]` (serialized with `Uint8Array` & `transparentDataUrl`)
     - `textOverlays: TextOverlayItem[]`
     - `formValues: FormValuesState`

2. **Two-Tier Background Persistence & Emergency Lifecycle Flush**:
   - **Debounced Background Save (~450 ms):** Whenever `signatures`, `textOverlays`, `formValues`, `hasPageModifications`, or `currentPage` change on an active document, a debounced writer persists the `DocumentDraftRecord` to IndexedDB and updates `recent_docs_meta`.
   - **Immediate Lifecycle Flush (`visibilitychange`, `pagehide`, `beforeunload`):** Before a user can swipe away the Android APK or close a browser tab, the document transitions to `document.visibilityState === 'hidden'`. We flush any pending form-field debounce immediately, trigger an immediate IndexedDB write, and synchronously write a compact JSON backup of the overlay state (`signatures` metadata/dataURLs, `textOverlays`, `formValues`, `docId`, `currentPage`) to `localStorage` (`patricks_pdf_emergency_draft_v1`).
   - **Startup Recovery Reconciliation:** On app launch, if `localStorage` contains an emergency draft snapshot newer than the IndexedDB draft record (e.g., if the OS killed the process mid-transaction), it is automatically reconciled into IndexedDB before loading `recentDocs`.

---

## 2. User Experience & Workflow Details (All UI in English)

### A. Start Screen (`EmptyState.tsx`) — Resume Draft Banner
- When the app starts on the home screen (`!pdfState`) and a recent document has an active unsaved draft (`hasDraft === true`), a prominent **"Unfinished Draft Available"** banner is displayed at the top of `EmptyState`:
  - Shows document name, relative timestamp (`Edited 2 min ago`), and a summary of edits (e.g., `2 signatures · 1 text · Page 3`).
  - Primary button: **Resume Editing** (loads the document with its full working state and jumps straight to the last active page).
  - Secondary action: **Reset to Original** (discards the draft and restores the original unmodified PDF).

### B. Recent Documents History (`RecentDocumentsModal.tsx` & `EmptyState.tsx`)
- Entries in `RecentDocumentsModal` and the "Recently Opened" list on `EmptyState` clearly display their state:
  - **Unsaved Drafts (`hasDraft === true`):** Highlighted with an amber `Draft • Unsaved edits` indicator, edit counts (`Signatures`, `Text`, `Form fields`, `Page edits`), and a **Discard Draft / Reset** action button next to Open/Print/Share so the user can revert to the original PDF at any time.
  - **Saved Working Copies (`hasWorkingCopy === true && !hasDraft`):** Shows a subtle `Editable items` indicator so the user knows their placed signatures/texts remain movable when reopened.
- **Print & Share from Recent Documents:** If a document in history has a working draft or saved overlays, clicking **Print** or **Share** directly in `RecentDocumentsModal` or `EmptyState` compiles the composite PDF (including the draft's signatures, texts, and form values) rather than printing/sharing the blank original.

### C. Editor Header, Reset-to-Original & Save Behavior (`App.tsx`, `Header.tsx`, `PdfViewer.tsx`)
- **Seamless Reopening:** Opening a document (either via Recent Documents, the Resume Banner, or selecting the same PDF file from disk) checks for an existing `DocumentDraftRecord` by `docId`. If found, it restores `signatures`, `textOverlays`, `formValues`, `modifiedPdfBuffer` (if pages were modified), and `currentPage`.
  - If `isUnsavedDraft` is `true`, the document opens in the **Unsaved (`Draft saved locally`)** state so the user can see it hasn't been exported yet, while `resetHistory` is initialized so the restored working state can be edited or reset.
- **Reset to Original Option:** When a document has active edits or a restored draft, the user can trigger **Reset to Original** (available in `RecentDocumentsModal`, the start screen Resume Banner, and the editor menu) to wipe the draft and reload the pristine `originalPdfBuffer`.
- **Save / Export Behavior (`SaveModal`):** When the user exports/saves the full document via `SaveModal`:
  - `markCurrentStateSaved()` is called.
  - The draft record in IndexedDB is updated with `isUnsavedDraft: false` (clearing the "Unsaved Draft" warning badge while keeping all signatures, texts, and form fields editable for future sessions).
- **Closing or Switching Documents:** Because all changes are now automatically persisted as a local draft in IndexedDB, `UnsavedChangesModal` is updated to inform the user that their draft is safely stored in Recent Documents, offering:
  - **Save / Export PDF** (to export a final PDF file to device storage)
  - **Close & Keep Draft** (closes the editor while preserving the draft in history & start screen)
  - **Discard Draft & Revert** (deletes the draft and reverts to the original PDF)

---

## 3. Planned File Changes

1. **`src/types.ts`**:
   - Extend `RecentDocumentRecord` with `hasDraft?: boolean`, `hasWorkingCopy?: boolean`, `draftUpdatedAt?: number`, `formEditCount?: number`, `hasPageModifications?: boolean`, `lastPage?: number`.
   - Add `DocumentDraftRecord` interface.
2. **`src/utils/recentDocuments.ts`**:
   - Upgrade IndexedDB to `DB_VERSION = 3`, adding `recent_docs_drafts` object store.
   - Add `saveDocumentDraft()`, `getDocumentDraft()`, `discardDocumentDraft()`, `markDocumentDraftSaved()`, and `reconcileEmergencyDraftFromLocalStorage()` + `writeEmergencyDraftToLocalStorage()`.
   - Add helper `compileRecentDocumentPdfBytes()` so Print/Share from Recent Documents includes draft overlays when present.
3. **`src/App.tsx`**:
   - Track `currentDocId` (computed via `computePdfFingerprint` on the original PDF buffer).
   - Wire debounced background draft persistence + immediate flush on `visibilitychange` (`hidden`) / `pagehide` / `beforeunload`.
   - Restore draft state automatically when opening a document with an existing draft, and wire `handleDiscardDraft` / `handleResetToOriginal`.
   - Update `SaveModal` `onSaveSuccess` and `UnsavedChangesModal` actions to integrate with draft persistence.
4. **`src/components/EmptyState.tsx` & `src/components/RecentDocumentsModal.tsx` & `src/components/UnsavedChangesModal.tsx`**:
   - Add the **Resume Unfinished Draft** banner to `EmptyState.tsx`.
   - Add Draft status indicators, edit summaries, and **Reset to Original** button to `RecentDocumentsModal.tsx` and `EmptyState.tsx`.
   - Update `UnsavedChangesModal.tsx` to support keeping the local draft vs. discarding it.
5. **Unit Tests (`src/utils/__tests__/recentDocumentsDrafts.test.ts`)**:
   - Add tests verifying draft creation, restoration of `Uint8Array` signature bytes/text overlays/form values, emergency `localStorage` reconciliation, marking drafts as saved while keeping overlays editable, and resetting back to the original PDF buffer.
