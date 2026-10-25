# Änderungsprotokoll – PatricksPDF

Dieses Protokoll beginnt **rückwirkend mit dem am 25.10.2026 freigegebenen Stand**. Frühere Entwicklungsschritte sind über Git/PRs nachvollziehbar, wurden aber nicht in einer lückenlosen Releasehistorie gepflegt. Hier werden **funktionale Ergebnisse** dokumentiert, nicht alle zwischenzeitlich fehlgeschlagenen Test-APKs.

> **Versionskonvention:** Die Android-CI-Artefakte heißen `1.0.<GitHub-Actions-Run-Nummer>`. Die Nummer ist keine SemVer-Version aus `package.json` (dort weiterhin `0.0.0`). `v1.0.78` bezeichnet den erfolgreich geprüften Teststand **vor** dem Squash-Merge; der Code wurde mit Merge-Commit [`8703279`](https://github.com/KoelleHB/PatricksPDF/commit/8703279eb89b47101c541272fb091b85a51b10ea) nach `main` übernommen.

## 25.10.2026 – Architektur-Härtung & Funktionsausbau (Post-PR #4)

- **Kompakte Delta-Historie & deterministischer Speicherstatus (`src/hooks/useDocumentHistory.ts`):** Binäre `PageDocumentSnapshot`-Instanzen werden über `docRevisionId` dedupliziert verwaltet und unreferenzierte Revisionen automatisch bereinigt. Der `isSaved`-Status leitet sich deterministisch aus der aktuellen Zustands-Signatur (`computeDocumentStateSignature`) ab, sodass ein Rückgängigmachen bis zum Ausgangs- oder letzten Speicherstand den Status wieder als gespeichert erkennt.
- **IndexedDB v2 Metadaten-/Blob-Trennung & SHA-256-Fingerprint (`src/utils/recentDocuments.ts`):** `PatricksPDFRecentDB` (Version 2) trennt leichte Listen-Metadaten (`recent_docs_meta`) von den PDF-Binärdaten (`recent_docs_blobs`, Abruf on-demand via `getRecentDocumentBlob`). Dokumente werden über einen kollisionssicheren SHA-256-Inhalts-Fingerprint (`computePdfFingerprint`) statt nur über Dateiname und Größe identifiziert.
- **Export- & Formular-Härtung (`src/utils/pdfEngine.ts`, `src/components/SaveModal.tsx`):** Einheitlicher, idempotenter Export-/Retry-Pfad im Speichern-Dialog sowie Optionsvalidierung und Appearance-Aktualisierung vor `form.flatten()` bei AcroForm-Feldern.
- **Teil-Export ausgewählter Seiten (`src/utils/pdfEngine.ts`, `src/components/SaveModal.tsx`, `src/components/PageManagementModal.tsx`):** Direkter Export einzelner Seiten oder Seitenbereiche (z. B. `1-3, 5`) sowohl aus dem Speichern-Dialog als auch direkt aus der Seitenverwaltung, ohne das geöffnete Dokument zu verändern.
- **Mehrfachauswahl in der Seitenverwaltung (`src/components/PageManagementModal.tsx`):** Checkbox-Auswahl, Shift+Klick-Bereichsauswahl, Alle/Keine/Umkehren sowie Sammelaktionen zum Drehen (±90°), Duplizieren, Löschen und Teil-Exportieren.
- **Freie Speicherort-Wahl unter Android (`MainActivity.java`, `src/utils/nativeBridge.ts`, `src/components/SaveModal.tsx`):** Neben dem 1-Klick-Speichern in `Downloads` bietet der Speichern-Dialog unter Android zusätzlich „Speicherort wählen…“ über das Storage Access Framework (`Intent.ACTION_CREATE_DOCUMENT`).
- **Wiederverwendbare Unterschriftenbibliothek (`src/utils/signatureLibrary.ts`, `src/components/SignatureModal.tsx`):** Mehrere freigestellte oder gezeichnete Unterschriften mit frei vergebbarer Bezeichnung dauerhaft in IndexedDB (`PatricksPDFSignaturesDB`) speichern, umbenennen, löschen und mit einem Klick einfügen.
- **Dauerhafte Exporteinstellungen (`src/utils/exportSettings.ts`, `src/components/SaveModal.tsx`):** Speichert bevorzugtes Dateinamensschema (`_unterschrieben`, `JJJJ-MM-TT_`, eigenes Suffix, Originalname) und die Standardvorgabe für Formular-Flattening in `localStorage`.
- **100 % lokale Schriftarten (`index.html`, `src/index.css`) & einheitliche Fehlerdiagnose (`src/utils/appError.ts`, `src/components/ErrorDiagnosticsModal.tsx`):** Externe Google-Fonts-Verbindungen aus `index.html` entfernt (Caveat wird ausschließlich lokal geladen); strukturiertes `AppError`-Modell mit Diagnose-Modal und Kopierfunktion eingeführt.

## 25.10.2026 – Konsolidierter Stand nach PR #4 (Test-APK v1.0.78)

**Status:** Android-Gerätetest vom Nutzer als „gut genug soweit“ freigegeben, [PR #4](https://github.com/KoelleHB/PatricksPDF/pull/4) per Squash-Merge nach `main` übernommen. Kein separater GitHub-Release-Tag behauptet.

### PDF-Anzeige, Suche und Auswahl

- PDF.js von **4.10.38** auf **6.4.299** aktualisiert, Worker und lokale PDF.js-Ressourcen (CMaps, Standardfonts, WASM, ICC) entsprechend angepasst.
- Offiziellen Mozilla-`TextLayerBuilder` für selektierbaren Text verwendet; Textlayer-Render-Sessions werden bei Zoom, Dokumentwechsel und Virtualisierung korrekt abgebrochen bzw. ersetzt.
- **Lokale Volltextsuche**: kontextbezogene Treffer, Navigation per Pfeile/Tastatur, Sprung zur Seite, Markierung direkt innerhalb der PDF.js-Textspans, Obergrenze 1.000 Treffer. Mobiles Suchfeld kompakt; Trefferliste mobil einblendbar.
- **Android-Schriftkorrektur**: zusätzliche Schriftvergrößerung der WebView je Textspan anhand von IST-/SOLL-Fontmetriken kompensiert; damit liegen Textauswahl und Suchmarkierung wieder passend über dem Canvas.
- **Android-Auswahl stabilisiert**: native Auswahloberfläche statt zusätzlicher App-Kopierleiste; bei aktiver Auswahl werden automatische Fokus-/Zoom-Wechsel begrenzt und die ausgewählte Textschicht vor vorzeitigem Unmount geschützt. Native Auswahlgriffe bleiben geräteabhängig, nicht als vollständig fehlerfrei garantiert.
- Fit Width berücksichtigt unterschiedliche Seitenbreiten und erhält beim Seitenwechsel möglichst die Leseposition.

### Interne und externe PDF-Links / Formulare

- **Bestätigte Root Cause:** PDF.js 6 bietet `PageViewport.convertToViewportRectangle()` nicht mehr. Beide bisherigen Verwendungen für Link- und Formular-Annotationen wurden auf die weiterhin unterstützte `convertToViewportPoint()`-Koordinatentransformation umgestellt.
- Interne `GoTo`-Ziele und externe HTTP(S)-`URI`-Links funktionieren nach Nutzerabnahme wieder. Android öffnet externe Links über `ACTION_VIEW`.
- Verschlüsselte, **ohne Passworteingabe lesbare** PDFs werden für Anzeige und Links unterstützt. Der zusätzliche `pdf-lib`-Fallback kann verschlüsselte Dateien **nicht** zuverlässig interpretieren; für diese Dateien ist der PDF.js-Hauptpfad entscheidend.
- Regressionstests mit einer **synthetischen AES-128-verschlüsselten PDF** sowie Headless-Chrome-Browsertest ergänzt. Im referenzierten FRITZ!Box-Handbuch wurden auf Seite 2 **56 interne** und auf Seite 14 **7 externe** Linkflächen auf dem Android-Gerät bestätigt.

### Bearbeitung, Stabilität und Performance

- Redo stellt nun auch den vollständigen Seiten-Dokumentzustand wieder her.
- Drucken und Teilen markieren die Bearbeitung nicht fälschlich als gespeichert; bei Exportfehlern erfolgt kein stiller Rückfall auf die unveränderte Original-PDF.
- Unveränderte Inhalte werden beim Ausgabevorgang nicht unnötig erneut via `pdf-lib` serialisiert.
- Canvas/Textlayer werden außerhalb des Sichtbereichs freigegeben; Seiten-Thumbnails werden bei Bedarf geladen.
- Seiteninformationen und Zoomberechnung berücksichtigen unterschiedliche Seitenformate.
- Lockfile korrigiert; CI umfasst TypeScript, Unit-Tests, echten Browser-Smoke-Test, Web-Build, Capacitor-Sync und signierten Android-Build.

### Rückblick auf die Fehlersuche

Zwischenstände v1.0.48 bis v1.0.65 waren für einzelne Android-Probleme **nicht** erfolgreich. Mehrere Versuche, die Link-Klickflächen oder Touch-Handler zu verändern, konnten die eigentliche Ursache nicht beheben. Erst die Reproduktion mit einem verschlüsselten öffentlichen Testdokument zeigte, dass **bereits die Link-Extraktion** wegen der entfernten PDF.js-API abbrach; `pdf-lib` verschleierte das Problem durch einen erfolglosen Fallback. Die funktionierende Klickbehandlung aus `main` wurde wiederhergestellt.

Die technischen Details und Abnahmeschritte sind in [docs/PDF-RENDERING.md](docs/PDF-RENDERING.md) festgehalten.

## Künftige Einträge

Bei einer neuen Änderung bitte Datum, Funktionsänderungen, betroffene Dateien, bekannte Einschränkungen, Testnachweis sowie – **falls vorhanden** – ein Release-/CI-Artefakt getrennt angeben. Test-Build-Nummern nicht als unveränderliche Produkt-Releases behandeln.
