# Architektur – PatricksPDF

**Gilt für:** `main` nach dem am 25.10.2026 gemergten [PR #4](https://github.com/KoelleHB/PatricksPDF/pull/4). Diese Beschreibung bildet den derzeitigen Code ab. Sie ist keine Zusage vollständiger PDF-Standardkompatibilität.

## 1. Gesamtübersicht

PatricksPDF besteht aus einer React-/TypeScript-Anwendung, einer PDF-Lese-/Render-Schicht (PDF.js), einer PDF-Bearbeitungs-/Export-Schicht (pdf-lib) und optional nativen Android-Funktionen.

```text
PDF aus Datei / PWA Share Target / Android-Intent
                  |
             src/App.tsx
     Dokumentzustand + Änderungsverlauf
             /           \
    PDF.js (lesen)       pdf-lib (Bearbeiten/Export)
       |   |   |                 |
    Canvas Text Links        neue PDF-Bytes
       |   |   |                 |
       PdfViewer / PdfPageView / SaveModal
                       |
             Web APIs oder Android
               NativePdfBridge
                       |
              Speichern / Teilen / Druck
```

**Grundsatz:** Die PDF-Binärdaten bleiben für die normalen Lese-/Editieroperationen auf dem Gerät. Explizite Export-, Druck-, Link- und Share-Aktionen übergeben Daten ggf. an gewählte Zielanwendungen oder Betriebssystemdienste. Die App speichert „Zuletzt geöffnet“-Dokumente dauerhaft im lokalen IndexedDB-Cache, siehe unten.

## 2. Komponenten und Verantwortlichkeiten

| Modul | Aufgabe |
| --- | --- |
| `src/App.tsx` | Dokument öffnen, Passwortdialog, Bearbeitungszustand, Unsaved-Changes-Warnung, Speichern-/Teilen-/Druck-UI und Modals orchestrieren |
| `src/components/PdfViewer.tsx` | Fortlaufendes Scrollen, Fokus-Seite, Fit Width/Zoom, Suche, Inhaltsverzeichnis, Reader-/Reflow-Modus und Touch-/Gestensteuerung |
| `src/components/PdfPageView.tsx` | Einzelne PDF-Seite: Canvas, echte Textschicht, Link-Annotationen, Formfelder, Signaturen/Textoverlays; bedarfsorientiertes Mounting |
| `src/utils/pdfDocumentLifecycle.ts` | Laden und Cache der `PDFDocumentProxy`-Instanzen, Worker-konforme ArrayBuffer-Kopien, Render-Cancellation, Ressourcenfreigabe |
| `src/utils/pdfEngine.ts` | Canvas-/Textlayer-Rendering, Link-/Formfeld-Extraktion, Seitendaten, Manipulation und Export |
| `src/utils/pdfRawLinks.ts` | `pdf-lib`-Fallback für auslesbare, **nicht verschlüsselte** Linkannotation-Strukturen |
| `src/utils/pdfViewportRect.ts` | Rechtecke per PDF.js-6-kompatibler Punkttransformation umrechnen |
| `src/utils/pdfSearch.ts` / `pdfSearchMatcher.ts` | Dokumentweite PDF.js-Textsuche und Trefferzuordnung |
| `src/utils/pdfInlineTextHighlighter.ts` / `pdfInlineSearch.ts` | Markierungen innerhalb der originalen PDF.js-Textspans |
| `src/utils/pdfTextMetrics.ts` / `pdfSelection.ts` | Android-Schriftmetriken und Schutz aktiver nativer Textauswahl |
| `src/hooks/useDocumentHistory.ts` | Undo/Redo für Dokument-/Overlay-/Formulardaten |
| `src/components/PageManagementModal.tsx` | Reihenfolge, Duplikate, Drehung, Import, leere und gelöschte Seiten |
| `src/components/SaveModal.tsx` | Ausgabe vorbereiten und Download/Share/Print veranlassen |
| `src/utils/nativeBridge.ts` / `androidPdfTransfer.ts` | Browser-/Android-Ausgabepfade, sicheres Öffnen externer Links, übertragungsarme native PDF-Aktionen |
| `android/app/src/main/java/com/patrickspdf/app/MainActivity.java` | Android-WebView-Bridge, System-Intents, MediaStore/PrintManager/FileProvider |
| `src/utils/recentDocuments.ts` | Lokale IndexedDB-Historie kürzlich geöffneter Dokumente |

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

In `App.tsx` liegen der aktuelle `PdfDocumentState` (PDF-Datei, `arrayBuffer`, Seitenzahl, aktuelle Seite und Basisabmessungen), Formularmetadaten und „gespeichert/ungespeichert“-Flags.

`useDocumentHistory.ts` hält **Dokument-Snapshots**. Ein Eintrag enthält:

- `pageDocument`: Bytes, Anzahl/aktuelle Seite, Seitengröße, Formfelder;
- Signaturen, Textoverlays und Formularwerte;
- aktuell gewählte Signatur/Textobjekt und Aktionsname/Seite.

Historie maximal **50 Einträge**. Schreibvorgänge in Formularfelder werden teilweise debounced und vor entsprechenden Undo-Operationen geflusht. **Undo und Redo müssen beide `pageDocumentRef` wiederherstellen** – reine Overlay-Rücknahme würde Seitenänderungen nicht korrekt zurücksetzen.

Der UI-Speicherzustand ist **nicht** identisch mit einem erfolgreichen Share-/Print-Aufruf. `isSaved` wird erst nach erfolgreicher Speicherausgabe gesetzt; beim Teilen oder Drucken darf es nicht stillschweigend passieren. Das aktive Bearbeitungs-`arrayBuffer` wird durch den Speichervorgang nicht automatisch ersetzt.

## 5. PDF-Anzeige und Zoom

- PDF.js rendert die Seite in ein Canvas; daneben erzeugt der **offizielle `TextLayerBuilder`** selektierbare Textspans.
- Sichtbarer Text im Canvas und unsichtbare Spans müssen exakt dieselbe Seitentransformation haben. `PdfPageView` trennt `pageWidth` / `pageHeight` je Seite.
- `PdfViewer` berücksichtigt beim **Fit-Width-Zoom** die fokussierte Seite und den sichtbaren Container, nicht nur das erste Dokumentseitenformat.
- Die Suche (`MAX_RESULTS = 1000`) liest vorhandene PDF-Textinhalte lokal. Das Inline-Highlight ist Teil des vorhandenen PDF.js-Textlayers und vermeidet getrennt positionierte HTML-Rechtecke.
- Acrobat-Annotationen: PDF.js liefert Anzeige-Koordinaten und Link-/Formfeld-Metadaten; `pdfRectToViewport` verwendet die PDF.js-6-API `convertToViewportPoint()`.

## 6. PDF-Änderung und Export

Zwei Fälle sind bewusst zu unterscheiden:

1. **Unveränderte Inhaltsbytes:** Bei noch vorhandenen Original-/aktuellen PDF-Bytes und ohne zusätzliche Overlay-/Formularänderungen verwendet `SaveModal` dieselben Bytes statt das gesamte Dokument erneut über `pdf-lib` zu serialisieren.
2. **Inhaltliche Änderungen:** `embedSignaturesIntoPdf` lädt eine defensive Bytekopie mit `pdf-lib`, trägt Signaturen, Schrift/Text und Formulardaten ein und serialisiert. Die Formular-„Flatten“-Option kann die interaktiven Formularfelder in Seiteninhalt überführen.

**Strukturelle Seitenoperationen** sind über `applyPageModifications` bereits in das aktive `pdfState.arrayBuffer` eingerechnet. Das ist ein anderer Ablauf als das Hinzufügen von UI-Overlays.

**Sicherheitsgrenze:** `pdf-lib` ist kein verlässlicher Entschlüsseler/Bearbeiter für verschlüsselte PDFs. `embedSignaturesIntoPdf` lehnt `EncryptedPDFError` ab, statt `ignoreEncryption` als vermeintliche Entschlüsselung zu verwenden. Anzeige und Links über PDF.js sind separat davon möglich.

## 7. Android und PWA: getrennte Integration

**Web/PWA**
- `vite.config.ts`: PWA-Manifest, Share Target, Service Worker, Offline-Assets und Dateihandler.
- `src/hooks/usePwaShareTarget.ts`: Annahme aus Web Share Target über browserseitige Zwischenspeicherung (IndexedDB / Cache Storage) mit Fehlerdiagnose, falls nur Metadaten statt PDF-Bytes eintreffen.
- Speichern/Teilen/Drucken über unterstützte Browser-APIs und Fallbacks.

**Native Android-App**
- `isNativeAndroid()` erkennt die von der App bereitgestellte `window.NativePdfBridge`.
- Android unterstützt Save/Share/Print via `MainActivity.java`. `androidPdfTransfer.ts` verwendet für PDF-Dateien bevorzugt einen binären Transfer und bei Bedarf begrenzte Chunks, **keinen einzigen riesigen Base64-String**.
- Speichern nutzt Android `MediaStore.Downloads`; Teilen `ACTION_SEND` + `FileProvider`; Drucken `PrintManager`; externe HTTP(S)-PDF-Links `ACTION_VIEW`. Diese Aktionen verlassen teilweise die App in eine bewusste System-UI.

Beide Varianten sind nicht gleichzusetzen: Ein Share-Intent aus Chrome kann funktionieren, während Drive/Filemanager lediglich einen Link oder Titel liefern. Das ist kein Beweis für verlorene Daten im PDF-Renderer.

## 8. Sicherheit und lokale Persistenz

- Dokumentverarbeitung ist grundsätzlich browser-/app-lokal, **nicht** automatisch ein serverseitiger PDF-Upload.
- Über IndexedDB können Originalkopien im Geräteprofil verbleiben: `PatricksPDFRecentDB`, Store `recent_docs`, bis 15 Dokumente bzw. 50 MiB. Zusätzlich existiert temporäre lokale PWA-Share-Target-Speicherung.
- PDF-Link-Ziele sind auf `http:` / `https:` beschränkt. Keine Ausführung von `javascript:`- oder `file:`-Links aus Annotationen.
- Keine geheimen PDF-Beispiele oder Keystores in Tests, öffentliche CI-Logs oder Repository aufnehmen.
- Keine pauschale Sicherheitszusage: native Android-JavaScript-Bridges, PDF-Parsing und externe URL-Öffnung müssen bei künftigen Änderungen weiter geprüft werden.

## 9. Build, Qualitätssicherung und Releases

```bash
npm ci
npm run lint
npm test
npm run build
npx cap sync android
```

Für lokalen Android-Debug-Build anschließend `cd android && ./gradlew assembleDebug` (JDK 21, Android SDK erforderlich).

[`.github/workflows/build-apk.yml`](../.github/workflows/build-apk.yml) prüft zusätzlich per Chrome eine künstlich erzeugte **AES-128-PDF** mit internen und externen Links. Danach folgt der APK-Build mit optionalem Release-Signing. Die Release-APK-Version wird aus der **Workflow-Run-Nummer** gebildet: `1.0.<run_number>`; `package.json` ist weiterhin `0.0.0`.

Die synthetische PDF liegt unter `test/fixtures/encrypted-pdf-links.pdf`. Ein öffentlicher FRITZ!Box-Handbuch-Integrationstest existiert unter `test/publicFritzLinks.test.ts`, ist im regulären CI **ohne explizite Testdatei übersprungen**. Für Gerätetests kann das öffentlich erhältliche Handbuch lokal geöffnet werden, ohne es in Git einzuchecken.

## 10. Änderungsregeln

Bei Eingriffen in PDF.js-Version, PDF-Worker, Annotation-Rendering, Textlayer-CSS, Schriftmetriken oder Seitenskalierung immer das Szenario aus [PDF-RENDERING.md](PDF-RENDERING.md) vollständig testen. Bei State-/Export-Änderungen zusätzlich: Undo/Redo über Seitenänderungen, verschlüsselte Anzeige vs. Editierfehler, Speichern/Teilen/Drucken und große PDFs. Tests müssen auch **reale Klickpfade bzw. Browser-Integration** abdecken; die reine Existenz von Linkannotationen im PDF ist nicht ausreichend.
