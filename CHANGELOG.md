# Änderungsprotokoll – PatricksPDF

Dieses Protokoll dokumentiert die funktionalen und architektonischen Meilensteine von PatricksPDF.

> **Versionskonvention (ab Version 2.2):** `package.json`, `package-lock.json`, `src/utils/appError.ts` (`APP_VERSION`) sowie der Standard-Fallback in `android/app/build.gradle` tragen die Version **`2.2.0`**. Die Android-CI-Artefakte in `.github/workflows/build-apk.yml` verwenden das Schema **`2.2.<GitHub-Actions-Run-Nummer>`** (`PatricksPDF-release-v2.2.<run_number>`). Der Header zeigt den Badge **`v2.2`**.

## 26.10.2026 – Version 2.2 (`2.2.0`) – Intelligenter Seitenfokus, Ganze-Seite-Zentrierung & Mobile-TopBar-Bereinigung

### Intelligenter Seitenfokus & Direktsprung „An den Anfang“

- **Seitenübersicht (`src/components/mobile/MobilePageGridBottomSheet.tsx`):**
  - Öffnet nicht mehr stumpf auf Seite 1, sondern scrollt die Karte der **aktuell betrachteten Seite** automatisch mittig in den sichtbaren Bereich.
  - Im Header wurde ein Button **„An den Anfang“** (`ArrowUpToLine`) integriert, der die Rasterübersicht per 1-Klick sanft nach ganz oben zu Seite 1 scrollt.
- **Seitenverwaltung (`src/components/PageManagementModal.tsx`, `src/components/PageManagementHeader.tsx`):**
  - Scrollt beim Öffnen und nach dem Laden der Seitenübersichten automatisch zur aktuell im Reader aktiven Seite.
  - Neuer Button **„An den Anfang“** in der Kopfleiste für sofortigen Sprung zum Anfang des Dokuments.

### Mobile-TopBar-Bereinigung & 3-Punkte-Menü

- **Schlankere Top-Bar (`src/components/mobile/MobileReaderTopBar.tsx`):**
  - Das Raster-Icon wurde aus den direkten oberen Leisten-Icons entfernt, da die Seitenübersicht direkt und ergonomisch über die schwebende Seitenblätterpille erreichbar ist.
  - Das 3-Punkte-Menü (`⋮`) enthält nun den dedizierten Menüeintrag **„Seitenübersicht“** (`LayoutGrid`).

### Zoomstufe „Ganze Seite“ & %-Anzeige in der Floating-Pill

- **Zoom-Button in der Seitenblätterpille (`src/components/mobile/MobileFloatingPill.tsx`, `src/components/PdfViewer.tsx`):**
  - Zeigt kontinuierlich den aktuellen Seitenzoom in Prozent an (z. B. `100%`).
  - Ein Klick auf den Prozentwert schaltet direkt und sauber auf die Zoomstufe **„Ganze Seite“** (`fit-page`) zurück.

### Fixes Mobile-Layout, Fullscreen-Modus & beruhigte Button-Farbgebung

- **Überdeckungsfreies fixes Layout (`src/components/mobile/MobileReaderTopBar.tsx`, `src/components/mobile/MobileBottomBar.tsx`, `src/components/PdfViewer.tsx`):**
  - Die obere Titelleiste und die untere Werkzeugleiste sind nun fest im Flex-Layout verankert (`sticky top-0 shrink-0` bzw. `shrink-0` am Fuß), anstatt als schwebende Overlays über dem Dokumenten-Canvas zu liegen.
  - Das Dokumenten-Viewport füllt exakt den Raum dazwischen aus: Beim Öffnen ist der Kopf der ersten Seite zu 100 % sichtbar und wird nicht mehr durch die Titelleiste verdeckt.
  - Kein störendes Auto-Hide beim Scrollen mehr: Die Leisten bleiben standardmäßig fixiert und stabil stehen.
- **Echter systemweiter Fullscreen-Modus & iFrame-Schutz (`src/components/mobile/MobileFloatingPill.tsx`, `src/utils/nativeBridge.ts`, `android/app/src/main/java/com/patrickspdf/app/MainActivity.java`):**
  - Neuer Vollbild-Umschaltbutton (`Maximize2` / `Minimize2`) direkt in der schwebenden Seitenblätterpille, die nun mit erhöhter Transparenz (`bg-white/75 backdrop-blur-md`) dezent über dem Dokument schwebt.
  - **Android-APK System-Fullscreen:** Über `NativePdfBridge.setImmersiveFullscreen(enabled)` schaltet `MainActivity.java` mittels `WindowCompat.setDecorFitsSystemWindows` und `WindowInsetsControllerCompat` (`hide(WindowInsetsCompat.Type.systemBars())` mit `BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE`) die Android-Statusleiste und -Navigationsleiste systemweit aus bzw. beim Verlassen wieder ein.
  - **iFrame-Preview-Schutz:** `isRunningInIframe()` erkennt eingebettete Vorschau-Umgebungen (wie AI Studio Preview) und schaltet dort rein das App-Layout auf Vollbild, ohne `requestFullscreen()` im Cross-Origin-iFrame auszulösen. Zudem wurden Parent-State-Updates (`onControlsVisibilityChange`) sauber in einen `useEffect` entkoppelt.
- **Beruhigte, einheitlich helle Bottom-Bar-Buttons (`src/components/mobile/MobileBottomBar.tsx`):**
  - Alle vier Buttons (Seiten, Text, Signieren, Speichern) nutzen ein einheitlich ruhiges, helles Farbschema (`bg-slate-50`, feiner Rahmen `border-slate-200/80`, dunkle Schrift `text-slate-700`).
  - Grelle Farben (knallblaues Signieren, pechschwarzes Speichern) wurden durch dezente, harmonische Icon-Farbakzente ersetzt.

### Dokument-Öffnen: Saubere Zentrierung & Ganze Seite

- **Initialer Anzeigemodus (`src/components/PdfViewer.tsx`):**
  - Beim Öffnen eines Dokuments (sowohl mobil als auch auf dem Desktop) wird die erste Seite zentriert und exakt auf **„Ganze Seite“** eingepasst, ohne visuellen Versatz oder unvollständige Ränder.
  - Horizontale und vertikale Scrollpositionen werden deterministisch auf `0` gesetzt.
- **Ressourcenbereinigung beim Dokumentwechsel (`src/utils/pdfDocumentLifecycle.ts`, `src/App.tsx`):**
  - Behebt `TypeError: destroy is not a function`, wenn ein Dokument geöffnet wird während bereits ein anderes Dokument geladen ist: `PDFDocumentProxy` besitzt in PDF.js kein `.destroy()`, sondern `.cleanup()` und `.loadingTask.destroy()`. Die Ressourcenfreigabe prüft Typen nun defensiv ab und fängt Fehler isoliert ab, sodass ein Dokumentwechsel immer zuverlässig gelingt.

## 26.10.2026 – Version 2.1 (`2.1.0`) – Immersives Mobile-UI, Thumb-Zone & Performance-Optimierungen

### Sicherheit & Scripting-Härtung (CVE-2026-16633 Mitigation)

- **Explizite Deaktivierung eingebetteter PDF-Skripte (`src/utils/pdfDocumentLifecycle.ts`):**
  - In `loadPdfJsDoc()` wird sowohl im primären Ladepfad als auch im linearen XRef-Recovery-Pfad `enableScripting: false` explizit gesetzt (der PDF.js-Default war `true`).
  - Schließt die Schwachstelle CVE-2026-16633 (CVSS 8.6, willkürliche JS-Ausführung über manipulierte PDFs) zusammen mit `isEvalSupported: false` und der restriktiven Content Security Policy in `index.html` deterministisch ab.

### Immersives Mobile-UI & Ergonomie (Android APK & Viewports < 768px)

- **Immersiver Lesemodus mit Auto-Hide-Navigation (`src/hooks/useImmersiveNavigation.ts`, `src/components/PdfViewer.tsx`):**
  - Beim Scrollen faden die obere App-Bar und die untere Werkzeugleiste sanft aus (`transform: translateY`, `opacity: 0`).
  - Ein Einzeltap auf den Dokumenten-Canvas blendet alle Steuerelemente weich wieder ein.
  - Wenn ein Bearbeitungswerkzeug aktiv ist (Signatur- oder Textoverlay-Modus), bleiben alle Bedienelemente dauerhaft fixiert sichtbar.
- **Kompakte Top-Bar (`src/components/mobile/MobileReaderTopBar.tsx`):**
  - Frosted-Glass-Optik (`backdrop-blur-md bg-white/80`).
  - Zurück-Button, Dokumenttitel und dezenter Metadaten-Badge (`PDF • Größe • Gespeichert`).
  - Direkte Undo- und Redo-Aktionen (`Undo2`, `Redo2`) in der App-Bar neben dem Suche-Icon.
  - Drei-Punkte-Menü (`⋮`) mit schnellem Direktzugriff auf „Datei öffnen“ und „Verlauf zeigen“.
- **Schwebende Floating Controls (`src/components/mobile/MobileFloatingPill.tsx`):**
  - Ergonomische, schwebende Kapsel („Pill“) unten zentriert über dem Dokument.
  - Kompakte Einhand-Seitennavigation (`<` `Seite X / Y` `>`) und Schnellauswahl für den Lesemodus („Breite anpassen“ / „Original“), ohne Pinch-to-Zoom zu behindern.
- **Ergonomische Bottom Action Bar (`src/components/mobile/MobileBottomBar.tsx`):**
  - Vollständige Daumenbedienung (Thumb-Zone) für die Kernwerkzeuge: **Seiten** (mit dynamischem Seitenanzahl-Badge), **Text** (Stift-Icon), **Signieren** (hervorgehobener primärer Aktions-Button `#2563EB`) sowie **Speichern / Exportieren** (Teilen/Download-Icon).
  - Respektiert strikt die Safe-Area des Smartphones (`padding-bottom: env(safe-area-inset-bottom)`).
- **Einhand-Seitenübersicht als Bottom-Sheet (`src/components/mobile/MobilePageGridBottomSheet.tsx`):**
  - Schneller Wechsel zwischen Dokumentseiten über ein kompaktes Bottom-Sheet.
  - Keine redundante Desktop-Menüüberladung auf mobilen Endgeräten.

### Performance & Skalierung bei großen Dokumenten

- **Lazy Rendering von Seiten-Thumbnails (`MobilePageGridBottomSheet.tsx`):**
  - Thumbnails im Bottom-Sheet werden per `IntersectionObserver` nur dann gerendert, wenn die entsprechende Karte im sichtbaren Bereich des Sheets scrollt. Verhindert UI-Einfrieren bei PDFs mit 20+ Seiten.
- **Paralleles Batching & WeakMap-Caching für Seiteninformationen (`src/utils/pdfEngine.ts`):**
  - `getPageInfoList()` puffert Seiten-Metadaten pro PDF-Dokumentinstanz in einer WeakMap.
  - Ungecachte Seiten werden in parallelen 10er-Batches aufgelöst, was die Ladezeit der Seitenübersicht bei großen Dokumenten drastisch verkürzt.
- **Nicht-blockierender Thumbnail-Hintergrund-Persist (`src/App.tsx`):**
  - Die Erzeugung des Titel-Thumbnails für die IndexedDB-Historie erfolgt entkoppelt über `requestIdleCallback` / verzögerten Timeout, sodass das Öffnen großer Dokumente im Viewer unmittelbar reagiert.

### Stabilität & Regressionstests

- Desktop PWA (>= 768px) bleibt in Layout, Toolbars und Workflows vollkommen unberührt.
- 100 % Testabdeckung für Versionskonsistenz, CSP, PDF.js-Scripting-Härtung und Mobile-UI-Architektur (`test/architectureAndFeatures.test.ts`).

## 25.10.2026 – Version 2.0 (`2.0.0`) – Datenschutz-Härtung, Viewport-Platzierung & Senior-Engineer-Audit

### Datenschutz & Datenintegrität (P0/P1-Härtungen)

- **Physische Objekt- und Stream-Bereinigung beim Teil-Export (`src/utils/pdfExportEngine.ts`):**
  - Behebt das Risiko, dass `pdfDoc.removePage()` in `pdf-lib` lediglich den Seitenbaum-Eintrag entfernt, während Content-Streams, Bilder oder Formularwerte ausgeschlossener Seiten als indirekte Objekte im serialisierten PDF verbleiben.
  - `isolateSelectedPagesInSourceDoc()` entfernt nicht ausgewählte Seiten vorab, löscht seitenfremde `Widgets` und verwaiste Formularfelder und leert `Annots` sowie `StructParents`, bevor ausschließlich die Zielseiten via `copyPages` in ein frisches `PDFDocument.create()` übertragen und deren Formularfelder in `rebuildAcroFormForCopiedPages()` sauber neu verknüpft werden.
  - Gleiches Prinzip in `applyPageModifications()`: Werden Seiten in der Seitenverwaltung gelöscht, wird das Dokument vor dem Speichern in ein frisches `PDFDocument` umkopiert, sodass gelöschte Seiteninhalte physisch aus dem Puffer verschwinden.
  - Durch Binär- und FlateDecode-Dekompressionstests (`test/architectureAndFeatures.test.ts`) abgesichert.
- **Unabhängiger Teil-Export ohne Veränderung des Arbeitsdokuments (`src/utils/pdfExportEngine.ts`, `src/components/PageManagementModal.tsx`, `src/App.tsx`):**
  - `handleBatchExportSelected()` in `PageManagementModal.tsx` wendet ungespeicherte Entwurfsänderungen (Drehungen, Umsortierungen, Löschungen) **nicht** mehr vorab auf das geöffnete Arbeitsdokument an.
  - Stattdessen erzeugt `buildStagedPageExportSnapshot()` einen isolierten temporären Export-Snapshot (`stagedExportOverride`), der an `SaveModal` übergeben wird. Bricht der Nutzer den Export ab oder schließt das Modal, bleibt das geöffnete Arbeitsdokument unverändert.
- **Strikte Fehlerbehandlung bei Formularänderungen & Flattening (`src/utils/pdfExportEngine.ts`):**
  - Fehler beim Setzen von AcroForm-Feldwerten, bei der Aktualisierung der Felddarstellung (`defaultUpdateAppearances`) oder beim `form.flatten()` werden nicht mehr stillschweigend per `console.warn` übergangen, sondern brechen den Export mit einer klaren deutschen Fehlermeldung ab.
- **Strikte Verschlüsselungsgrenze auch in der Seitenverwaltung (`src/utils/pdfExportEngine.ts`):**
  - Sowohl `embedSignaturesIntoPdf()` als auch `applyPageModifications()` (inklusive Seitenimport aus externen PDFs) nutzen `loadUnencryptedPdfForModification()` mit `ignoreEncryption: false` und lehnen verschlüsselte PDFs deterministisch ab.
- **Deterministischer Formular-Debounce-Flush vor Ausgaben (`src/App.tsx`):**
  - Vor Schnell-Drucken (`handleQuickPrint`), Schnell-Teilen (`handleQuickShare`), Speichern (`onOpenSave`, `onSave`, `onSaveFirst`) und Seiten-Export wird `flushPendingFormCommit()` aufgerufen, damit laufende Texteingaben in Formularfeldern garantiert im Export enthalten sind.

### Android-Stabilität & Sicherheit

- **Abgesicherter Android-Speicherortdialog (`src/utils/nativeBridge.ts`, `MainActivity.java`):**
  - `savePdfDocumentAs()` verwendet eine eindeutige `requestId`, eine Parallelitätssperre (`activeNativeSaveAsRequest`), ein 120-Sekunden-Timeout sowie ein deterministisches `finally`-Cleanup.
  - `MainActivity.java` sichert `pendingSaveAsPdfFile` und `pendingSaveAsRequestId` über `onSaveInstanceState`, sodass der Speichervorgang auch dann sauber abgeschlossen wird, wenn Android die Activity während des System-Dateidialogs (`Intent.ACTION_CREATE_DOCUMENT`) neu erstellt.
- **Sichere externe Links im Inhaltsverzeichnis (`src/utils/pdfEngine.ts`, `src/components/TableOfContentsDrawer.tsx`):**
  - Externe URLs in PDF-Gliederungseinträgen (Outlines) werden wie Seiten-Annotationen streng auf gültige `http:`/`https:`-Ziele mit Hostnamen geprüft (`javascript:`, `data:`, `file:`, `content:` werden verworfen) und über `openPdfExternalLink()` geöffnet.

### UX-Verbesserungen & Architektur

- **Viewport-zentrierte & zoom-angepasste Platzierung (`src/utils/pdfPlacement.ts`, `src/components/PdfViewer.tsx`, `src/App.tsx`):**
  - Neue Unterschriften und Textfelder werden exakt in der Mitte des aktuell sichtbaren Seiten-Ausschnitts (Viewport) platziert statt pauschal in der Seitenmitte (`x: 50, y: 50`).
  - Beim starken Reinzoomen skaliert die Anfangsgröße einer neuen Unterschrift automatisch passend zum sichtbaren Ausschnitt.
  - Werden mehrere Elemente ohne Zwischenscrollen nacheinander eingefügt, sorgt ein Kaskadierungs-Versatz (`placementIndex`) dafür, dass sie sich nicht verdecken.
- **Behebung von React Error #310 in `SaveModal.tsx`:**
  - Ein `useMemo`-Aufruf befand sich hinter einem bedingten `if (!isOpen) return null;`. Alle Hooks in `src/components/SaveModal.tsx` werden nun strikt vor dem frühen Return ausgeführt.
- **Modularisierung & Bereinigung:**
  - Trennung von PDF-Lese-/Render-Funktionen (`src/utils/pdfEngine.ts`) und PDF-Modifikations-/Export-Logik (`src/utils/pdfExportEngine.ts`).
  - Entfernen veralteter Artefakte aus dem Repository: doppelte Legacy-CMaps unter `/public/cmaps` (41 `.bcmap`-Dateien), fremdes Lockfile `bun.lock` sowie veraltete Arbeitsnotiz `docs/NEXT_OPTIMIZATIONS.md`.

## 25.10.2026 – Architektur-Härtung & Funktionsausbau (Post-PR #4)

- **Kompakte Delta-Historie & deterministischer Speicherstatus (`src/hooks/useDocumentHistory.ts`):** Binäre `PageDocumentSnapshot`-Instanzen werden über `docRevisionId` dedupliziert verwaltet und unreferenzierte Revisionen automatisch bereinigt. Der `isSaved`-Status leitet sich deterministisch aus der aktuellen Zustands-Signatur (`computeDocumentStateSignature`) ab, sodass ein Rückgängigmachen bis zum Ausgangs- oder letzten Speicherstand den Status wieder als gespeichert erkennt.
- **IndexedDB v2 Metadaten-/Blob-Trennung & SHA-256-Fingerprint (`src/utils/recentDocuments.ts`):** `PatricksPDFRecentDB` (Version 2) trennt leichte Listen-Metadaten (`recent_docs_meta`) von den PDF-Binärdaten (`recent_docs_blobs`, Abruf on-demand via `getRecentDocumentBlob`). Dokumente werden über einen kollisionssicheren SHA-256-Inhalts-Fingerprint (`computePdfFingerprint`) statt nur über Dateiname und Größe identifiziert.
- **Export- & Formular-Härtung (`src/utils/pdfExportEngine.ts`, `src/components/SaveModal.tsx`):** Einheitlicher, idempotenter Export-/Retry-Pfad im Speichern-Dialog sowie Optionsvalidierung und Appearance-Aktualisierung vor `form.flatten()` bei AcroForm-Feldern.
- **Teil-Export ausgewählter Seiten (`src/utils/pdfExportEngine.ts`, `src/components/SaveModal.tsx`, `src/components/PageManagementModal.tsx`):** Direkter Export einzelner Seiten oder Seitenbereiche (z. B. `1-3, 5`) sowohl aus dem Speichern-Dialog als auch direkt aus der Seitenverwaltung, ohne das geöffnete Dokument zu verändern.
- **Mehrfachauswahl in der Seitenverwaltung (`src/components/PageManagementModal.tsx`):** Checkbox-Auswahl, Shift+Klick-Bereichsauswahl, Alle/Keine/Umkehren sowie Sammelaktionen zum Drehen (±90°), Duplizieren, Löschen und Teil-Exportieren.
- **Freie Speicherort-Wahl unter Android (`MainActivity.java`, `src/utils/nativeBridge.ts`, `src/components/SaveModal.tsx`):** Neben dem 1-Klick-Speichern in `Downloads` bietet der Speichern-Dialog unter Android zusätzlich „Speicherort wählen…“ über das Storage Access Framework (`Intent.ACTION_CREATE_DOCUMENT`).
- **Wiederverwendbare Unterschriftenbibliothek (`src/utils/signatureLibrary.ts`, `src/components/SignatureModal.tsx`):** Mehrere freigestellte oder gezeichnete Unterschriften mit frei vergebbarer Bezeichnung dauerhaft in IndexedDB (`PatricksPDFSignaturesDB`) speichern, umbenennen, löschen und mit einem Klick einfügen.
- **Dauerhafte Exporteinstellungen (`src/utils/exportSettings.ts`, `src/components/SaveModal.tsx`):** Speichert bevorzugtes Dateinamensschema (`_unterschrieben`, `JJJJ-MM-TT_`, eigenes Suffix, Originalname) und die Standardvorgabe für Formular-Flattening in `localStorage`.
- **100 % lokale Schriftarten (`index.html`, `src/index.css`) & einheitliche Fehlerdiagnose (`src/utils/appError.ts`, `src/components/ErrorDiagnosticsModal.tsx`):** Externe Google-Fonts-Verbindungen aus `index.html` entfernt (Caveat wird ausschließlich lokal geladen); strukturiertes `AppError`-Modell mit Diagnose-Modal und Kopierfunktion eingeführt.

## 25.10.2026 – Konsolidierter Stand nach PR #4 (Test-APK v1.0.78)

**Status:** Android-Gerätetest vom Nutzer als „gut genug soweit“ freigegeben, [PR #4](https://github.com/KoelleHB/PatricksPDF/pull/4) per Squash-Merge nach `main` übernommen.

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
