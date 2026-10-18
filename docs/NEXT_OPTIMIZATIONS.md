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
