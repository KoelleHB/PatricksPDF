# PatricksPDF – Meilensteine & Architektur-Historie

Dieses Dokument dient als dauerhafte Referenz für wesentliche Projekt-Meilensteine, deren Kernfeatures und Wiederherstellungspunkte.

---

## 🏆 Meilenstein 1: Vollständige Offline-Engine, Loopback-Binärtransfer & High-Precision Zoom

- **Datum**: 18. Oktober 2026
- **Branch**: `feature/native-binary-resource-refactor` (Basis für `main`)
- **Empfohlener Git-Tag**: `v1.0.0-gold-offline-binary-refactor` (oder `v1.0.0-milestone`)

### Warum dieser Stand so wichtig ist:
Dieser Meilenstein vereint alle Kernoptimierungen, die PatricksPDF von einem Prototyp zu einer robusten, autarken Produktiv-Anwendung (PWA & native Android APK) gemacht haben.

### Zusammenfassung der Kernarchitektur:

1. **Vollständige Offline-Autarkie (Zero-CDN)**:
   - PDF.js Web-Worker, Standard-14-Fonts und CMap-Dateien werden bei jedem Build lokal aus `node_modules` nach `/public/pdfjs/` kopiert.
   - PWA-Caching speichert alle Binär-Assets (`bcmap`, `pfb`, `ttf`). Die App funktioniert ohne Internetverbindung im Flugmodus uneingeschränkt.

2. **Loopback-Binärtransfer für Android (`MainActivity.java` & `androidPdfTransfer.ts`)**:
   - PDF-Dateien bis zu 512 MB werden beim Speichern, Teilen und Drucken direkt als Binär-Blob über einen lokalen `127.0.0.1`-Loopback-Server gestreamt.
   - Beseitigt Base64-String-Kopien im Heap und verhindert `OutOfMemoryError`-Abstürze bei großen PDFs. Robuster Fallback auf Chunked-Transfer.

3. **High-Performance Zoom-Engine (35 % bis 500 %)**:
   - Dynamisches High-DPI Canvas Rendering (skaliert bis Faktor 4.0 für gestochen scharfe Vektorschriften bei extremer Vergrößerung).
   - Schnellwahl-Menü für Zoomstufen (`50%`, `75%`, `100%`, `150%`, `200%`, `300%`, `400%`, `500%`, `Fit Width`, `Fit Page`).
   - Mathematisch zentriertes Pinch-to-Zoom am Finger-Mittelpunkt und Smart Double-Tap / Double-Click zum Umschalten zwischen 250 % und Seitenbreite.

4. **Präzise Textmarkierung & Android-Auswahlgriffe**:
   - Korrektur der PDF.js `--scale-factor`-Berechnung für Subpixel-Genauigkeit zwischen Cursor und Vektorglyphen auf dem Desktop.
   - Entfernung von übergeordnetem `select-none` in Android WebViews: Langes Drücken auf Text blendet nativ die Android-Auswahlgriffe und das Lupen-Kontextmenü ein.
   - Schwebende Kopierleiste mit Zeichen- und Wortzählung sowie Bestätigung.

5. **Strukturierte Undo/Redo-Seitenverwaltung**:
   - `PageDocumentSnapshot` sichert den gesamten PDF-ArrayBuffer, sodass Seitendrehungen, Löschungen und Umsortierungen voll rückgängig gemacht werden können.
   - Beim Duplizieren von Seiten werden Signaturen und Text-Overlays geklont und erhalten neue, eindeutige IDs.
   - Progressives Rendering der Seiten-Vorschau (LRU-Cache bis max. 64 Thumbnails).

6. **Speicher-Lebenszyklus (`pdfDocumentLifecycle.ts`)**:
   - Saubere Freigabe von PDF.js-Dokumentinstanzen und Worker-Tasks (`disposePdfJsResources()`) beim Schließen oder Wechseln von Dokumenten.

7. **Sichere CI/CD-Pipeline (`.github/workflows/build-apk.yml`)**:
   - Deterministisches `npm ci`, Typprüfung (`npm run lint`), monomolekulare Versionsnummerierung über `github.run_number`.
   - Signierte Release-APKs über GitHub Secrets mit Keystore-Löschung nach dem Build und Signatur-Verifikation via `apksigner`.

---

## 📌 Wie finde ich diesen Stand in Git / GitHub wieder?

### Option A: Einen Git-Tag setzen (Empfohlen)
Im lokalen Terminal des GitHub-Klons:

```bash
# 1. Tag auf den aktuellen Commit setzen
git tag -a v1.0.0-gold-offline-binary-refactor -m "Meilenstein: Offline-Engine, Binärtransfer, 500% Zoom, High-Precision Text"

# 2. Tag zu GitHub hochladen
git push origin v1.0.0-gold-offline-binary-refactor
```

### Option B: Über GitHub Releases anlegen
1. Auf GitHub das Repository öffnen.
2. Rechts auf **Releases** → **Draft a new release** klicken.
3. Als Tag z. B. `v1.0.0-gold` eingeben und den aktuellen Branch/Commit auswählen.
4. Titel: `Meilenstein v1.0: Offline-Engine, Binärtransfer & High-Precision Zoom`.
5. Die obige Zusammenfassung hineinkopieren und auf **Publish release** klicken.
6. Der Release-Stand bleibt auf GitHub dauerhaft mit Download-Archiv (`.zip` / `.tar.gz`) und zugehörigem Commit archiviert.

```bash
git checkout v1.0.0-gold-offline-binary-refactor
```

---

## 🏆 Meilenstein 2: Konsolidierter Stand nach PR #4 (PDF.js 6, Volltextsuche, Link-Fix & Android-Metriken)

- **Datum**: 25. Oktober 2026
- **Zugehöriger Commit**: [`8703279`](https://github.com/KoelleHB/PatricksPDF/commit/8703279eb89b47101c541272fb091b85a51b10ea) auf `main` (nach Squash-Merge von [PR #4](https://github.com/KoelleHB/PatricksPDF/pull/4))
- **Verifizierte Test-APK**: `v1.0.78` (Nutzerabnahme auf Android erfolgreich abgeschlossen)

### Kernarchitektur & Neuerungen dieses Meilensteins:

1. **PDF.js Upgrade auf 6.4.299 & Beseitigung der Link-API-Regression**:
   - PDF.js 6 hat `convertToViewportRectangle()` ersatzlos gestrichen. Die Koordinaten-Transformation für klickbare PDF-Links und Formularfelder wurde in `pdfViewportRect.ts` auf `convertToViewportPoint()` umgestellt.
   - Interne `GoTo`-Sprungziele und externe Web-Links (`ACTION_VIEW`) funktionieren auf Desktop und Android wieder subpixelgenau.

2. **Passwortlose, AES-128-verschlüsselte PDFs**:
   - Robuste Unterstützung für geschützte Handbücher und Dokumente, die ohne Passworteingabe lesbar sind.
   - Klare Trennung: Anzeige, Suche und Links laufen über PDF.js; `pdf-lib` wird nur bei explizitem Bearbeiten unverschlüsselter PDFs genutzt, und unveränderte Dateien werden beim Speichern ohne Neuserialisierung 1:1 durchgereicht.

3. **Vollintegrierte lokale PDF-Volltextsuche**:
   - `pdfSearch.ts`, `pdfInlineSearch.ts`, `pdfInlineTextHighlighter.ts` und `PdfSearchPanel.tsx`.
   - Direkte Inline-Markierung innerhalb der PDF.js-Textspans, Vor-/Zurück-Navigation, Begrenzung auf max. 1.000 Treffer zum Schutz des Speichers.

4. **Android WebView Font-Autosizing-Kompensation**:
   - `pdfTextMetrics.ts` gleicht WebView-eigene Schriftvergrößerungen (z. B. auf Samsung OneUI) über den dynamischen Korrekturfaktor `--font-metric-correction` (`SOLL / IST`) ab, sodass Textauswahl und Suchmarkierungen exakt über dem Canvas liegen.

5. **Stabilisierte native Textauswahl**:
   - Native Android-Ziehgriffe und Android-Systemmenü; Schutz der aktiven Textauswahl vor vorzeitigem Unmounten oder Zoom-Sprüngen.

6. **Speicher-Virtualisierung & Test-Suite**:
   - Freigabe von Canvas/TextLayer außerhalb des Sichtbereichs für flüssige Bedienung bei 300–400+ Seiten.
   - 11 automatisierte Testdateien in `test/` inklusive Node/tsx-Tests und Headless-Chrome-Smoke-Tests für verschlüsselte PDFs und Link-Geometrie.

---

## 🏆 Meilenstein 3: Version 2.0 (`2.0.0`) – Privacy-First Teil-Export, Viewport-Platzierung, Unterschriftenbibliothek & Senior-Engineer-Härtung

- **Datum**: 25. Oktober 2026
- **Version**: `2.0.0` (CI-Schema: `2.0.<github.run_number>`)
- **Empfohlener Git-Tag**: `v2.0.0`

### Kernarchitektur & Neuerungen von Version 2.0:

1. **Datenschutzsicherer Teil-Export ohne verwaiste PDF-Objekte (`src/utils/pdfExportEngine.ts`)**:
   - Beim Export ausgewählter Seiten (`1-3, 5`) oder beim Löschen von Seiten in der Seitenverwaltung werden ausgeschlossene Seiten vorab isoliert, seitenfremde Referenzen (`Widgets`, `Annots`, `StructParents`) bereinigt und ausschließlich die gewünschten Seiten in ein frisches `PDFDocument.create()` kopiert.
   - Vertrauliche Texte, FlateDecode-Streams oder Formularwerte entfernter Seiten sind physisch nicht mehr in der exportierten PDF-Datei enthalten (abgesichert durch Binär- und Stream-Dekompressionstests).

2. **Rückwirkungsfreier Teil-Export aus der Seitenverwaltung (`buildStagedPageExportSnapshot`)**:
   - Werden in der Seitenverwaltung Seiten gedreht oder umsortiert und direkt als Auswahl exportiert, bleibt das geöffnete Arbeitsdokument über einen isolierten Export-Snapshot (`stagedExportOverride`) unangetastet, falls der Nutzer die Änderungen nicht explizit übernimmt.

3. **Viewport-zentrierte & zoom-angepasste Element-Platzierung (`src/utils/pdfPlacement.ts`)**:
   - Neue Unterschriften und Textfelder erscheinen exakt in der Mitte des aktuell sichtbaren Seiten-Ausschnitts statt starr in der Seitenmitte.
   - Beim starken Reinzoomen skaliert die Anfangsgröße einer Unterschrift proportional mit dem sichtbaren Ausschnitt; mehrere direkt nacheinander eingefügte Elemente werden leicht versetzt (Kaskadierung) platziert.

4. **Wiederverwendbare Unterschriftenbibliothek & persistente Exporteinstellungen**:
   - Lokale IndexedDB-Bibliothek (`PatricksPDFSignaturesDB`) zum Speichern, Benennen und 1-Klick-Einfügen mehrerer Unterschriften.
   - Dauerhafte Exporteinstellungen (`localStorage`) für Dateinamens-Schemata (`_unterschrieben`, Datum, eigenes Suffix) und Formular-Flattening.

5. **Kompakte Delta-Historie & IndexedDB v2**:
   - Deduplizierte Binär-Revisionen (`docRevisionId`) und deterministische Zustands-Signatur (`computeDocumentStateSignature`) in `useDocumentHistory.ts`.
   - Trennung von leichten Listen-Metadaten (`recent_docs_meta`) und abrufbasierten PDF-Binärdaten (`recent_docs_blobs`) mit SHA-256-Inhalts-Fingerprint in `recentDocuments.ts`.

6. **Strikte Fehler-, Sicherheits- und Android-Lifecycle-Härtung**:
   - Strikte AcroForm-Validierung und Fehlerweitergabe beim Feld-Setzen, Appearance-Update und Flattening sowie deterministischer Debounce-Flush vor Speichern/Drucken/Teilen.
   - Strikte Ablehnung verschlüsselter PDFs (`ignoreEncryption: false`) bei jeglicher `pdf-lib`-Bearbeitung inklusive externem Seitenimport.
   - Gehärteter Android-`save_as`-Dialog (`ACTION_CREATE_DOCUMENT`) mit `requestId`-Korrelation, 120s-Timeout, Parallelitätssperre und `onSaveInstanceState`-Wiederherstellung bei Activity-Neustarts.
   - 13 automatisierte Test-Suiten in `test/`.

---

## 🏆 Meilenstein 4: Version 2.1 (`2.1.0`) – Immersives Mobile-UI, Thumb-Zone, CVE-Härtung & Performance-Optimierungen

- **Datum**: 26. Oktober 2026
- **Version**: `2.1.0` (CI-Schema: `2.1.<github.run_number>`)
- **Empfohlener Git-Tag**: `v2.1.0`

### Warum dieser Stand so wichtig ist:
Dieser Meilenstein transformiert PatricksPDF auf Smartphones und in der Android-APK von einem desktop-zentrierten Tool zu einem modernen, immersiven Mobile-Reader mit maximaler nutzbarer Bildschirmfläche und ergonomischer Daumenbedienung (Thumb-Zone), während die Desktop-PWA-Erfahrung vollkommen stabil und unverändert bleibt.

### Kernarchitektur & Neuerungen von Version 2.1:

1. **Sicherheits-Härtung (CVE-2026-16633 Mitigation)**:
   - Explizite Deaktivierung von PDF-Skripting (`enableScripting: false`) in allen PDF.js-Initialisierungspfaden (`src/utils/pdfDocumentLifecycle.ts`), kombiniert mit `isEvalSupported: false` und restriktiver CSP in `index.html`.
   - Schützt deterministisch vor willkürlicher Script-Ausführung bei manipulierten Fremd-PDFs.

2. **Immersiver Lesemodus & Auto-Hide-Navigation (`src/hooks/useImmersiveNavigation.ts`, `src/components/PdfViewer.tsx`)**:
   - Automatisches sanftes Ausblenden von Top-Bar und Bottom-Bar beim Scrollen (`transform: translateY`, `opacity: 0`).
   - Einzeltap auf das Dokument blendet die Steuerelemente sanft wieder ein.
   - Wenn ein Werkzeug aktiv ist (z. B. Signatur platzieren oder Textoverlay bearbeiten), bleiben alle Bedienelemente fixiert eingeblendet.

3. **Moderne mobile Komponenten-Architektur (`src/components/mobile/`)**:
   - `MobileReaderTopBar`: Frosted Glass (`backdrop-blur-md bg-white/80`), Zurück-Button, Dokumenttitel, kompakter Metadaten-Badge, Undo & Redo direkt erreichbar, Suche, Schnellzugriff auf Seitenraster und Drei-Punkte-Menü mit „Datei öffnen“ und „Verlauf zeigen“.
   - `MobileFloatingPill`: Schwebende, zentrierte Kapsel über dem Dokumentenrand für schnelles Blättern (`< 1 / X >`) und 1-Tap-Zoom-Modi („Breite anpassen“ / „Original“).
   - `MobileBottomBar`: Ergonomische Thumb-Zone für **Seiten** (mit dynamischem Seitenanzahl-Badge), **Text**, **Signieren** (hervorgehobener primärer Aktions-Button `#2563EB`) und **Speichern/Exportieren**, mit nativer `safe-area-inset-bottom`-Unterstützung.
   - `MobilePageGridBottomSheet`: Kompaktes Bottom-Sheet für schnelle Einhand-Seitenwechsel.

4. **Performance-Optimierungen bei großen Dokumenten & schnellem Öffnen**:
   - `IntersectionObserver` Lazy Thumbnail Rendering in `MobilePageGridBottomSheet.tsx`: Verhindert blockierendes Vorab-Rendern aller Seitenvorschauen und spart Arbeitsspeicher.
   - WeakMap-Caching und parallele 10er-Batch-Auflösung in `getPageInfoList()` (`src/utils/pdfEngine.ts`).
   - Nicht-blockierende Hintergrund-Generierung von Dokument-Thumbnails via `requestIdleCallback` (`src/App.tsx`).

5. **Desktop-Schutz & Testabdeckung**:
   - Desktop-PWA-Oberfläche (>= 768px) bleibt 100 % unberührt.
   - Vollständige automatisierte Testabdeckung inklusive Versionskonsistenz, CSP-Prüfung, Scripting-Härtung und Mobile-Komponenten-Integrität.

---

## 🏆 Meilenstein 5: Version 2.2 (`2.2.0`) – Intelligenter Seitenfokus, Ganze Seite & Mobile Ergonomie

- **Datum**: 26. Oktober 2026
- **Version**: `2.2.0` (CI-Schema: `2.2.<github.run_number>`)
- **Empfohlener Git-Tag**: `v2.2.0`

### Zusammenfassung der Kernarchitektur:

1. **Intelligenter Seitenfokus in Seitenübersicht und Seitenverwaltung**:
   - `MobilePageGridBottomSheet` und `PageManagementModal` öffnen nicht mehr stumpf auf Seite 1, sondern scrollen die Karte der aktuell gelesenen Seite automatisch ins Blickfeld.
   - Ein dedizierter Button **„An den Anfang“** (`ArrowUpToLine`) in beiden Übersichten ermöglicht jederzeit den sofortigen, flüssigen Sprung nach ganz oben zu Seite 1.

2. **Mobile-TopBar-Bereinigung & 3-Punkte-Menü**:
   - Das Raster-Icon wurde aus der oberen App-Bar entfernt, wodurch die Kopfleiste auf mobilen Geräten noch ruhiger und aufgeräumter wirkt.
   - Die Seitenübersicht ist nun zusätzlich im 3-Punkte-Menü erreichbar (sowie primär über die schwebende Seitenkapsel).

3. **Floating-Pill mit Live-Zoom-Prozentanzeige & 1-Tap-Fit-Page**:
   - Zeigt den aktuellen Zoomwert in Prozent (z. B. `100%`) an.
   - Bei Klick wird das Dokument direkt auf die Stufe **„Ganze Seite“** zurückgesetzt.

4. **Perfekt zentriertes Dokument-Öffnen in Zoomstufe „Ganze Seite“**:
   - Beim Öffnen eines Dokuments (sowohl mobil als auch auf dem Desktop) wird die erste Seite zentriert und ohne vertikalen/horizontalen Versatz in der Zoomstufe „Ganze Seite“ eingepasst.

---

## 🏆 Meilenstein 6: Version 2.3 (`2.3.0`) – Zoom- & Leseanker-Erhalt im Vollbildmodus, bestätigter Fullscreen-Status & APK-Build-Diagnose

- **Datum**: 26. Oktober 2026
- **Version**: `2.3.0` (CI-Schema: `2.3.<github.run_number>`)
- **Empfohlener Git-Tag**: `v2.3.0`

### Zusammenfassung der Kernarchitektur:

1. **Erhalt von manuellem Zoom & Leseanker beim Vollbildwechsel (`src/components/PdfViewer.tsx`)**:
   - Strikte Trennung zwischen automatischen Fit-Modi (`isFitPageMode`, `isFitWidthMode`) und manuell gewähltem Zoom (`250%`, Pinch-to-Zoom, Presets).
   - Beim Wechsel in oder aus dem Vollbildmodus sowie bei Fenstergrößenänderungen bleiben manuelle Zoomstufen und die exakte Leseposition (`captureZoomAnchor`) vollständig erhalten.

2. **Bestätigter Erfolgsstatus für Vollbildmodus (`src/utils/nativeBridge.ts`, `MainActivity.java`)**:
   - `setSystemFullscreen(enabled)` gibt einen verifizierten `Promise<boolean>`-Status zurück (`document.fullscreenElement` im Web/PWA bzw. native Bestätigung in der Android-APK).
   - App-Leisten werden nur dann ausgeblendet, wenn der Vollbildmodus vom System/Browser tatsächlich aktiviert wurde.

3. **Code-Hygiene & Entfernung toter Hooks**:
   - Der durch dauerhaft sichtbare Leisten abgelöste Hook `useImmersiveNavigation.ts` sowie das ungenutzte `isToolActive`-Prop wurden entfernt.

4. **Live-Buffer-Dateigröße & vollständige APK-Build-Diagnose**:
   - `MobileReaderTopBar` zeigt vorrangig die aktuelle Puffergröße (`pdfState.arrayBuffer.byteLength`), sodass Seitenänderungen sofort sichtbar sind.
   - `MainActivity.java` liefert über `getAppBuildInfo()` die exakte APK-Version (`versionName (Code versionCode)`), die jederzeit über „Info & Diagnose“ im 3-Punkte-Menü oder über den `v2.3`-Badge im Header abrufbar ist.

5. **Tailwind-`xs:`-Breakpoint & Barrierefreiheit**:
   - Definition von `--breakpoint-xs: 22.5rem;` in `src/index.css` sowie durchgängige `aria-label`-Attribute und sichtbare „Verwalten“-Beschriftung in der mobilen Seitenübersicht.
