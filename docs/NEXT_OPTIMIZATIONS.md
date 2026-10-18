# Nächste Optimierungsphase — PWA und APK

Branch: `feature/native-binary-resource-refactor`. Basis: PR #2 / `main`.

## A. Binäre Android-Dateiübertragung

Aktuell wird das Dokument in Android-Tempdateien geschrieben, aber die JS-Java-Schnittstelle übergibt pro Chunk Base64. Ziel: vollständig binäre Dateiübertragung über eine geeignete Capacitor-native Schnittstelle / Content-URI und Dateihandles; keine Voll-Datei-Base64-Konvertierung. Eingehende Shares, Export in Downloads, Teilen und Drucken berücksichtigen. Abbruch, Größenprüfung, konsistente Fehler und Cleanup erhalten. PWA bleibt unabhängig und verwendet Web-APIs.

## B. Speicher / Lebenszyklus

PDF.js-Dokumentinstanzen beim Austausch und bei endgültiger Freigabe sauber zerstören, aber Undo/Redo nicht beschädigen. Blob-Object-URLs zum passenden Zeitpunkt widerrufen. Limits und Invalidation von Thumbnail- sowie Worker-Caches prüfen. Besonders Test mit 400 Seiten.

## C. Modularisierung

`App.tsx`: Dokument-Import/Share-Empfang, Editor-History und UI getrennt. `pdfEngine.ts`: Viewer-Rendering, Metadaten/Formulare und PDF-Export in dedizierte Module aufteilen. `PageManagementModal.tsx`: Thumbnail-Loader und Seitenaktionen auslagern. Keine Migration bestehender Nutzerdaten, keine Änderung am PDF-Datenformat.

## Qualitätssicherung / Definition of Done

- CI: `npm ci`, `npm run lint`, `npm run build`, Capacitor-Sync und signierte Android-APK.
- Installierte PWA: Online und Flugmodus, PDF-Import, Export, Share/Print soweit Browser unterstützt.
- APK: Dateiempfang aus Drive und Android-Dateimanager, Downloads, Share-Sheet, Druckdialog.
- Große unverschlüsselte PDF (ca. 400 Seiten) und geschützte PDFs, Undo/Redo, Dokumentwechsel.
- Kein Merge vor erfolgreichem Plattformtest.

## Implementation status on this branch

- Native PDF exports: `src/utils/androidPdfTransfer.ts` uses a loopback-only binary Blob POST to a short-lived Android HTTP listener, then falls back to the bounded Base64 chunk bridge on WebView incompatibility. The listener requires an unguessable per-transfer UUID, limits request size to 512 MiB and times out after 30 s; the JS call aborts after 20 s. This path must be verified on a physical Android device before merge.
- PDF.js document loading, render cancellation and explicit disposal are in `src/utils/pdfDocumentLifecycle.ts`. Closing/replacing a document triggers disposal; Undo/Redo continues using the retained document.
- Thumbnail cache/rendering moved to `src/utils/pdfThumbnails.ts` with existing identity isolation and per-document cache bound.
- PWA exports remain in `src/utils/nativeBridge.ts`; native transfer is invoked only in the Android bridge branch.
- Full separation of the remaining UI handlers in `App.tsx` and `PageManagementModal.tsx` has **not** yet been completed.

### Essential verification
1. GitHub Actions: select `feature/native-binary-resource-refactor`, execute Build Android APK; fix all TypeScript/Java errors before user testing.
2. Install the resulting APK; save, share and print both 2 MB and 35+ MB PDFs, including offline tests.
3. Inspect WebView console/Chrome remote debugging for `Android PDF transfer: binary loopback`. Saving successfully alone does **not** prove binary transfer; the compatibility fallback can do the same.
4. PWA: install/reload offline, import, edit, export, and confirm page previews.
5. Open/close/switch a 400-page PDF repeatedly, test undo/redo and document re-open.
