# Architektur – PatricksPDF (Version 2.3)

**Gilt für:** **Version 2.3 (`2.3.0`)** auf `main` (Stand: 26.10.2026). Diese Beschreibung bildet den aktuellen Code- und Sicherheitsstand ab. Sie ist keine Zusage vollständiger PDF-Standardkompatibilität.

## 1. Gesamtübersicht

PatricksPDF besteht aus einer React-/TypeScript-Anwendung, einer PDF-Lese-/Render-Schicht (PDF.js), einer strikt getrennten PDF-Bearbeitungs-/Export-Schicht (`pdfExportEngine.ts` auf Basis von `pdf-lib`) und optional nativen Android-Funktionen.

```text
PDF aus Datei / PWA Share Target / Android-Intent
                  |
             src/App.tsx
     Dokumentzustand + Änderungsverlauf
             /           \
    PDF.js (lesen)       pdfExportEngine.ts (pdf-lib)
       |   |   |                 |
    Canvas Text Links    physisch bereinigte PDF-Bytes
       |   |   |                 |
       PdfViewer / PdfPageView / SaveModal
       |   \
       |    MobileReaderTopBar / MobileFloatingPill / MobileBottomBar (Mobile / APK)
       |
    Web APIs oder Android
      NativePdfBridge
             |
     Speichern / Teilen / Druck
```

**Grundsatz:** Die PDF-Binärdaten bleiben für die normalen Lese-/Editieroperationen auf dem Gerät. Explizite Export-, Druck-, Link- und Share-Aktionen übergeben Daten ggf. an gewählte Zielanwendungen oder Betriebssystemdienste. Die App speichert „Zuletzt geöffnet“-Dokumente sowie gespeicherte Unterschriften-Vorlagen dauerhaft im lokalen IndexedDB-Cache, siehe unten.

## 2. Komponenten und Verantwortlichkeiten

| Modul | Aufgabe |
| --- | --- |
| `src/App.tsx` | Dokument öffnen, Passwortdialog, Bearbeitungszustand, Debounce-Flush vor Ausgaben, Unsaved-Changes-Warnung, isolierter Teil-Export-Snapshot (`stagedExportOverride`), Speichern-/Teilen-/Druck-UI, Modals orchestrieren sowie asynchroner Thumbnail-Hintergrundpersist via `requestIdleCallback` |
| `src/components/PdfViewer.tsx` | Fortlaufendes Scrollen, zentrierte Initialanzeige („Ganze Seite“ ohne Versatz), Fokus-Seite, Trennung von `isFitPageMode`/`isFitWidthMode` und manuellem Zoom (inkl. Zoom- & Leseanker-Erhalt bei Vollbildwechsel), bestätigter Fullscreen-Modus, Suche, Inhaltsverzeichnis, Reader-/Reflow-Modus, Touch-/Gestensteuerung sowie Berechnung des aktuell sichtbaren Seiten-Ausschnitts (`getViewportPlacement`) |
| `src/components/mobile/MobileReaderTopBar.tsx` | Überdeckungsfreie, fixe Top-Bar (`sticky top-0 shrink-0`) für Smartphones: Zurück, Dokumenttitel, Live-Buffer-Dateigröße (`arrayBuffer.byteLength`), Undo & Redo direkt erreichbar, Suche und Drei-Punkte-Menü mit „Seitenübersicht“, „Datei öffnen“, „Verlauf zeigen“ und „Info & Diagnose“ |
| `src/components/mobile/MobileFloatingPill.tsx` | Leicht transparente, schwebende Kapsel (`bg-white/75 backdrop-blur-md`) über dem Dokumentenrand für schnelles Blättern (`< 1 / X >`), Anzeige der aktuellen Zoomstufe in %, 1-Tap-Reset auf „Ganze Seite“ und Vollbild-Umschalter |
| `src/components/mobile/MobileBottomBar.tsx` | Ruhig-helle, einheitliche Daumenleiste (`bg-slate-50`, `shrink-0`) für Smartphones: Seiten (mit dynamischem Badge), Textwerkzeug, Signieren und Speichern/Exportieren (`safe-area-inset-bottom`) |
| `src/components/mobile/MobilePageGridBottomSheet.tsx` | Einhand-bedienbare Seitenübersicht als Bottom-Sheet: automatischer Fokus/Scroll auf die aktuell betrachtete Seite, Schnellzugriff-Button „An den Anfang“, sichtbarer „Verwalten“-Button und `IntersectionObserver` Lazy Thumbnail Rendering |
| `src/components/PdfPageView.tsx` | Einzelne PDF-Seite: Canvas, echte Textschicht, Link-Annotationen, Formfelder, Signaturen/Textoverlays; bedarfsorientiertes Mounting |
| `src/utils/pdfDocumentLifecycle.ts` | Laden und Cache der `PDFDocumentProxy`-Instanzen, Worker-konforme ArrayBuffer-Kopien, Render-Cancellation, Ressourcenfreigabe und CVE-2026-16633-Härtung (`enableScripting: false`, `isEvalSupported: false`) |
| `src/utils/pdfEngine.ts` | Canvas-/Textlayer-Rendering, Link-/Formfeld-Extraktion, sichere Inhaltsverzeichnis-Extraktion (`extractDocumentOutline`), Seitenvorschau, WeakMap-PageInfo-Caching und parallele 10er-Batch-Auflösung |
| `src/utils/pdfExportEngine.ts` | PDF-Modifikation und Export: physische Seiten-/Objekt-Isolation bei Teil-Exporten (`isolateSelectedPagesInSourceDoc`), AcroForm-Validierung/-Flattening, Einbetten von Signaturen/Texten (`embedSignaturesIntoPdf`), Seitenoperationen (`applyPageModifications`) und isolierter Entwurfs-Export (`buildStagedPageExportSnapshot`) |
| `src/utils/pdfPlacement.ts` | Berechnung der viewport-zentrierten, zoom-angepassten und kaskadierten Platzierung neuer Unterschriften und Textfelder (`computeViewportElementPlacement`) |
| `src/utils/pdfRawLinks.ts` | `pdf-lib`-Fallback für auslesbare, **nicht verschlüsselte** Linkannotation-Strukturen |
| `src/utils/pdfViewportRect.ts` | Rechtecke per PDF.js-6-kompatibler Punkttransformation umrechnen |
| `src/utils/pdfSearch.ts` / `pdfSearchMatcher.ts` | Dokumentweite PDF.js-Textsuche und Trefferzuordnung |
| `src/utils/pdfInlineTextHighlighter.ts` / `pdfInlineSearch.ts` | Markierungen innerhalb der originalen PDF.js-Textspans |
| `src/utils/pdfTextMetrics.ts` / `pdfSelection.ts` | Android-Schriftmetriken und Schutz aktiver nativer Textauswahl |
| `src/hooks/useDocumentHistory.ts` | Kompaktes Delta-Undo/Redo für Dokument-/Overlay-/Formulardaten mit deduplizierten Binär-Revisionen und deterministischer Zustands-Signatur |
| `src/components/PageManagementModal.tsx` | Seitenverwaltung mit Mehrfachauswahl, Reihenfolge, Duplikaten, Drehung, Import, leeren/gelöschten Seiten, „An den Anfang“-Schnellnavigation, automatischer Fokusierung der aktuellen Seite und rückwirkungsfreiem Teil-Export |
| `src/components/SaveModal.tsx` | Ausgabe vorbereiten (Gesamtdokument oder Seitenbereich), Dateinamens-Vorlagen anwenden und Download/Save-As/Share/Print veranlassen |
| `src/utils/signatureLibrary.ts` / `SignatureModal.tsx` | Lokale IndexedDB-Unterschriftenbibliothek (`PatricksPDFSignaturesDB`) zum dauerhaften Speichern, Umbenennen und Wiederverwenden mehrerer Unterschriften |
| `src/utils/exportSettings.ts` | Persistente Exporteinstellungen (Dateinamens-Schema, Suffix, Flattening-Standard) in `localStorage` |
| `src/utils/appError.ts` / `ErrorDiagnosticsModal.tsx` | Strukturiertes `AppError`-Fehlermodell (`APP_VERSION = '2.3.0'`) sowie jederzeit aufrufbares Info- & Diagnose-Modal inklusive vollständiger APK-/Build-Version |
| `src/utils/nativeBridge.ts` / `androidPdfTransfer.ts` | Browser-/Android-Ausgabepfade, bestätigtes `setSystemFullscreen(enabled): Promise<boolean>`, `getRuntimeVersionInfo()`, korrelierter `save_as`-Dialog mit Request-ID & Timeout, sicheres Öffnen externer Links, binärer Loopback-Transfer |
| `android/app/src/main/java/com/patrickspdf/app/MainActivity.java` | Android-WebView-Bridge (`setImmersiveFullscreen`, `getAppBuildInfo`), System-Intents, MediaStore/SAF (`ACTION_CREATE_DOCUMENT` mit `onSaveInstanceState`-Sicherung)/PrintManager/FileProvider |
| `src/utils/recentDocuments.ts` | Lokale IndexedDB-v2-Historie kürzlich geöffneter Dokumente mit Metadaten-/Blob-Trennung und SHA-256-Fingerprint |

Siehe [PDF-Rendering](PDF-RENDERING.md) für die Koordinatensysteme, PDF.js-6-Fallen und Android-Auswahl.

## 3. Dokument-Lifecycle

1. `App.tsx` liest eine Datei in ein `ArrayBuffer`, ruft `loadPdfJsDoc()` auf und prüft die erste PDF-Seite. Passwortfehler öffnen das Passwort-Modal.
2. Die ursprünglichen Bytes werden für spätere Bearbeitung und Ausgabe gehalten. `pdfDocumentLifecycle.ts` gibt **eine Kopie** an den PDF.js-Worker: Ein per Worker übertragener `ArrayBuffer` darf die Originalbytes im Hauptthread nicht „detachen“.
3. `pdfDocCache` ist eine `WeakMap<ArrayBuffer, Promise<PDFDocumentProxy>>`, die denselben geladenen PDF.js-Dokumentproxy während des Dokuments wiederverwendet; aktive Dokumente und laufende Tasks werden beim Dokumentwechsel freigegeben.
4. `App.tsx` extrahiert AcroForm-Metadaten und initiale Formularwerte. `useDocumentHistory` erhält einen Anfangssnapshot.
5. `PdfViewer` legt einen fortlaufenden Seitenstack an. `PdfPageView` verwendet `IntersectionObserver` für Seitennähe, Canvas, Textlayer und Links. Offscreen-Canvas/-Textlayer werden zur Speicherentlastung verworfen.
6. Eine aktive **native Android-Textauswahl** darf nicht durch Virtualisierung bzw. automatische Fokus-/Zoom-Anpassungen zerstört werden. Weitere Details: [PDF-Rendering](PDF-RENDERING.md).
7. Die jüngsten Dokumente werden zusätzlich in IndexedDB gespeichert (max. 15 Stück bzw. 50 MiB für den Recent-Docs-Cache). Das ist eine **lokale Kopie**, kein Cloud-Backup.

Bei Änderungen an Cache/Unloading mit großen Dokumenten unbedingt prüfen, dass nicht ein alter async Render-Task nach einer neuen Seite oder Zoomstufe wieder Textspans veröffentlicht.

## 4. Bearbeitungszustand und Undo/Redo

In `App.tsx` liegen der aktuelle `PdfDocumentState` (PDF-Datei, `arrayBuffer`, Seitenzahl, aktuelle Seite und Basisabmessungen) und die Formularmetadaten.

`useDocumentHistory.ts` verwaltet eine kompakte Historie (maximal **50 Einträge**):

- Binäre Dokumentrevisionen (`PageDocumentSnapshot`) werden dedupliziert in einer Revisions-Map (`docRevisionId`) abgelegt, sodass `ArrayBuffer`-Instanzen bei reinen Overlay- oder Formularänderungen nicht kopiert werden; nicht mehr referenzierte Revisionen werden automatisch bereinigt.
- Jeder Historieneintrag speichert den `docRevisionId`-Verweis, die Änderungsart (`HistoryDeltaOperation`), Overlay-/Formularzustände sowie eine deterministische Zustands-Signatur (`stateSignature`).
- Schreibvorgänge in Formularfelder werden debounced und vor Undo-, Speicher-, Schnell-Druck- und Schnell-Teilen-Operationen explizit per `flushPendingFormCommit()` geflusht. **Undo und Redo stellen jeweils die referenzierte `PageDocumentSnapshot`-Revision wieder her.**

Der `isSaved`-Status wird deterministisch aus dem Vergleich der aktuellen Zustands-Signatur (`computeDocumentStateSignature`) mit der zuletzt gespeicherten bzw. initialen Signatur abgeleitet. Macht der Nutzer alle Änderungen seit dem Öffnen oder letzten Speichern per Undo rückgängig, wird das Dokument automatisch wieder als gespeichert erkannt. Teilen, Drucken und reine Teil-Exporte verändern die gespeicherte Signatur des Gesamtdokuments nicht.

## 5. PDF-Anzeige, Zoom und Viewport-Platzierung

- PDF.js rendert die Seite in ein Canvas; daneben erzeugt der **offizielle `TextLayerBuilder`** selektierbare Textspans.
- Sichtbarer Text im Canvas und unsichtbare Spans müssen exakt dieselbe Seitentransformation haben. `PdfPageView` trennt `pageWidth` / `pageHeight` je Seite.
- `PdfViewer` berücksichtigt beim **Fit-Width-Zoom** die fokussierte Seite und den sichtbaren Container, nicht nur das erste Dokumentseitenformat.
- **Viewport-zentrierte Platzierung (`src/utils/pdfPlacement.ts`):** Wenn der Nutzer eine Unterschrift oder einen Text einfügt, ermittelt `PdfViewer.getViewportPlacement()` über die Bounding-Rects des Scroll-Containers und des aktiven Seiten-Containers den tatsächlich sichtbaren Ausschnitt der Seite in Prozentkoordinaten (`0..100`). `computeViewportElementPlacement()` platziert das neue Element im Zentrum dieses sichtbaren Bereichs, skaliert bei starkem Zoom die Anfangsgröße einer Unterschrift proportional herunter und versetzt mehrere ohne Zwischenscrollen eingefügte Elemente leicht stufenförmig (Kaskadierung).
- Die Suche (`MAX_RESULTS = 1000`) liest vorhandene PDF-Textinhalte lokal. Das Inline-Highlight ist Teil des vorhandenen PDF.js-Textlayers und vermeidet getrennt positionierte HTML-Rechtecke.
- Acrobat-Annotationen: PDF.js liefert Anzeige-Koordinaten und Link-/Formfeld-Metadaten; `pdfRectToViewport` verwendet die PDF.js-6-API `convertToViewportPoint()`.

## 6. PDF-Änderung, physisch isolierter Teil-Export und Exporteinstellungen

Zwei Fälle sind bewusst zu unterscheiden:

1. **Unveränderte Inhaltsbytes (Gesamtdokument):** Bei noch vorhandenen aktuellen PDF-Bytes ohne zusätzliche Overlay-/Formularänderungen, ohne Flattening und ohne Seitenbereichs-Filter verwendet `SaveModal` dieselben Bytes statt das Dokument erneut über `pdf-lib` zu serialisieren.
2. **Inhaltliche Änderungen oder Teil-Export (`selectedPages`):** `embedSignaturesIntoPdf` in `src/utils/pdfExportEngine.ts` lädt eine defensive Bytekopie mit `pdf-lib` (`ignoreEncryption: false`), validiert und aktualisiert AcroForm-Felder strikt (Fehler beim Setzen von Werten, beim Appearance-Update oder beim `form.flatten()` brechen den Export mit einer klaren Fehlermeldung ab, statt ein unvollständiges PDF zu erzeugen) und bettet Signaturen und Textoverlays (lokale Schrift `Caveat-Regular.ttf` bzw. Helvetica) ein.
   - **Physische Bereinigung beim Teil-Export:** Ein bloßes `pdfDoc.removePage()` in `pdf-lib` würde zwar den Seitenbaum kürzen, aber indirekte Objekte, Content-Streams und Formularwerte entfernter Seiten im PDF-Kontext belassen. Deshalb isoliert `isolateSelectedPagesInSourceDoc()` zunächst das Quelldokument (entfernt ausgeschlossene Seiten, bereinigt seitenfremde `Widgets`, löscht `Annots`/`StructParents`), kopiert anschließend ausschließlich die ausgewählten Seiten über `exportDoc.copyPages()` in ein **frisches `PDFDocument.create()`** und baut bei nicht-abgeflachten Formularen das `AcroForm`-Dictionary über `rebuildAcroFormForCopiedPages()` nur für die auf den Zielseiten vorhandenen `Widget`-Annotationen neu auf.

**Rückwirkungsfreier Teil-Export aus der Seitenverwaltung (`buildStagedPageExportSnapshot`):**
Wenn in `PageManagementModal` Seiten gedreht, umsortiert oder gelöscht und anschließend markierte Seiten per „Auswahl exportieren“ exportiert werden, wird das aktive Arbeitsdokument in `App.tsx` **nicht** verändert. Stattdessen erzeugt `buildStagedPageExportSnapshot()` einen isolierten Export-Snapshot (`stagedExportOverride`), der nur für diesen Speichervorgang an `SaveModal` übergeben wird.

**Strukturelle Seitenoperationen (`applyPageModifications`):**
Werden Änderungen in der Seitenverwaltung regulär übernommen und wurden dabei Seiten gelöscht, kopiert `applyPageModifications()` die verbleibenden Seiten ebenfalls in ein frisches `PDFDocument`, damit gelöschte Seiteninhalte physisch aus dem Puffer entfernt werden.

**Sicherheitsgrenze Verschlüsselung:** `pdf-lib` ist kein verlässlicher Entschlüsseler/Bearbeiter für verschlüsselte PDFs. `loadUnencryptedPdfForModification()` erzwingt `ignoreEncryption: false` sowohl in `embedSignaturesIntoPdf` als auch in `applyPageModifications` (inkl. Seitenimport) und lehnt `EncryptedPDFError` mit einer verständlichen deutschen Meldung ab. Anzeige und Links über PDF.js sind separat davon möglich.

## 7. Android und PWA: getrennte Integration

**Web/PWA**
- `vite.config.ts`: PWA-Manifest, Share Target, Service Worker, Offline-Assets und Dateihandler. Keine externen Google-Fonts-Aufrufe in `index.html`.
- `src/hooks/usePwaShareTarget.ts`: Annahme aus Web Share Target über browserseitige Zwischenspeicherung (IndexedDB / Cache Storage) mit einheitlicher Diagnose (`ErrorDiagnosticsModal`).
- Speichern/Teilen/Drucken über unterstützte Browser-APIs und Fallbacks.

**Native Android-App**
- `isNativeAndroid()` erkennt die von der App bereitgestellte `window.NativePdfBridge`.
- Android unterstützt Save (`save` in `MediaStore.Downloads`), Save As (`save_as` über `Intent.ACTION_CREATE_DOCUMENT` zur freien Ordner-/Speicherortwahl), Share (`ACTION_SEND` + `FileProvider`) und Print (`PrintManager`) via `MainActivity.java`.
- **Härtung des `save_as`-Lebenszyklus:** `savePdfDocumentAs()` in `src/utils/nativeBridge.ts` korreliert jeden Aufruf über eine eindeutige `requestId`, verhindert parallele Dialoge, begrenzt die Wartezeit auf 120 Sekunden und räumt globale Listener im `finally`-Block auf. `MainActivity.java` persistiert `pendingSaveAsPdfFile` und `pendingSaveAsRequestId` in `onSaveInstanceState`, sodass der Rückkanal auch nach einer Activity-Neuerstellung durch das Android-System zuverlässig funktioniert.
- `androidPdfTransfer.ts` verwendet für PDF-Dateien bevorzugt einen binären Loopback-Transfer und bei Bedarf begrenzte Chunks, **keinen einzigen riesigen Base64-String**.

## 8. Sicherheit und lokale Persistenz

- Dokumentverarbeitung ist grundsätzlich browser-/app-lokal, **nicht** automatisch ein serverseitiger PDF-Upload.
- **CVE-2026-16633-Härtung (`src/utils/pdfDocumentLifecycle.ts`):** `enableScripting: false` und `isEvalSupported: false` werden sowohl beim regulären Laden als auch im linearen XRef-Recovery-Modus erzwungen; zusammen mit der restriktiven Content Security Policy in `index.html` wird die Ausführung von JavaScript in manipulierten PDFs vollständig blockiert.
- Über IndexedDB (`PatricksPDFRecentDB`, Version 2) werden im Geräteprofil Metadaten (`recent_docs_meta`) und PDF-Binärdaten (`recent_docs_blobs`) getrennt gespeichert (bis 15 Dokumente bzw. 50 MiB, identifiziert per SHA-256-Fingerprint `computePdfFingerprint`). Die Binärdaten werden erst beim Öffnen, Teilen oder Drucken bedarfsgesteuert geladen.
- Wiederverwendbare Unterschriften-Vorlagen werden lokal in IndexedDB (`PatricksPDFSignaturesDB`, Store `signatures`) mit Bezeichnung gespeichert.
- PDF-Link-Ziele (sowohl in Seiten-Annotationen als auch in Gliederungs-/Inhaltsverzeichnis-Einträgen) sind streng auf `http:` / `https:` mit gültigem Hostnamen beschränkt. Keine Ausführung von `javascript:`-, `data:`-, `content:`- oder `file:`-Links.
- Keine geheimen PDF-Beispiele oder Keystores in Tests, öffentliche CI-Logs oder Repository aufnehmen.

## 9. Build, Qualitätssicherung und Releases (Version 2.3)

```bash
npm ci
npm run lint
npm test
npm run build
npx cap sync android
```

Für lokalen Android-Debug-Build anschließend `cd android && ./gradlew assembleDebug` (JDK 21, Android SDK erforderlich).

[`.github/workflows/build-apk.yml`](../.github/workflows/build-apk.yml) prüft zusätzlich per Chrome eine künstlich erzeugte **AES-128-PDF** mit internen und externen Links. Danach folgt der APK-Build mit optionalem Release-Signing.
- `package.json`, `src/utils/appError.ts` und der Default in `android/app/build.gradle` stehen auf **`2.3.0`**.
- Die CI-APK-Version wird aus der **Workflow-Run-Nummer** gebildet: **`2.3.<run_number>`** (`PatricksPDF-release-v2.3.<run_number>`).

Die synthetische PDF liegt unter `test/fixtures/encrypted-pdf-links.pdf`. Ein öffentlicher FRITZ!Box-Handbuch-Integrationstest existiert unter `test/publicFritzLinks.test.ts`, ist im regulären CI **ohne explizite Testdatei übersprungen**.

## 10. Änderungsregeln

Bei Eingriffen in PDF.js-Version, PDF-Worker, Annotation-Rendering, Textlayer-CSS, Schriftmetriken oder Seitenskalierung immer das Szenario aus [PDF-RENDERING.md](PDF-RENDERING.md) vollständig testen. Bei State-/Export-Änderungen zusätzlich: physische Objektfreiheit bei Teil-Exporten (`test/architectureAndFeatures.test.ts`), Viewport-Platzierung (`test/pdfPlacement.test.ts`), Undo/Redo über Seitenänderungen, verschlüsselte Anzeige vs. Editierfehler, Speichern/Teilen/Drucken und große PDFs.
