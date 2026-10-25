# PDF-Rendering, Android-Textauswahl und PDF-Links

**Ziel:** Die kritischen Implementierungsdetails und die im Oktober 2026 nachgewiesenen Regressionen dauerhaft festhalten. Bezug: [PR #4](https://github.com/KoelleHB/PatricksPDF/pull/4), `pdfjs-dist 6.4.299`, freigegebene Android-Test-APK `1.0.78`, Merge-Commit `8703279`. Siehe auch [Architektur](ARCHITECTURE.md).

## 1. Warum Renderer, Textlayer und Annotationen zusammengehören

Eine PDF-Seite wird auf unterschiedlichen Ebenen dargestellt:

1. **Canvas**: Sichtbares, mit PDF.js gerendertes Dokumentbild (`renderPdfPageToCanvas` in `src/utils/pdfEngine.ts`).
2. **PDF.js-Textlayer**: Unsichtbare, positionierte HTML-Textspans für Auswahl, Kopieren und Inline-Suchmarkierung. Quelle ist Mozillas `TextLayerBuilder` (`renderPdfTextLayer`).
3. **Klickbare PDF-Link-Annotationen**: Prozentual innerhalb der Seite positionierte `<a>`-Elemente (`PdfPageView.tsx`).
4. **AcroForm-/Eigene Overlays**: Eingaben, Signaturen, zusätzliche Texte.

Jede Ebene muss auf demselben **PDF-Viewport** einschließlich CropBox, Seitenrotation und Zoom basieren. „Links funktionieren im PDF, aber nicht im Viewer“ kann daher zwei Ursachen haben: *keine erzeugten Linkdaten* oder *falsche Trefferflächen/Event-Reihenfolge*. Diese Fälle zuerst unterscheiden.

**Maßgebliche Quelldateien:**
- `src/utils/pdfDocumentLifecycle.ts` – Worker-/Doc-Cache und ArrayBuffer-Isolation.
- `src/utils/pdfEngine.ts` – Canvas, Textlayer, Formfelder, Links und Export.
- `src/utils/pdfViewportRect.ts` – Annotationsrechtecke.
- `src/components/PdfPageView.tsx` – DOM-Ebenen und Lebenszyklus.
- `src/utils/pdfTextMetrics.ts` / `pdfSelection.ts` – Android-Spezifika.
- `src/utils/pdfInlineTextHighlighter.ts` / `pdfInlineSearch.ts` – Suchmarkierungen.

## 2. Bestätigte PDF.js-6-Regression: entfernte Viewport-API

Beim Upgrade von PDF.js `4.10.38` auf `6.4.299` wurde in der vorherigen PatricksPDF-Implementierung zweimal die Methode

```ts
viewport.convertToViewportRectangle(annotation.rect);
```

benutzt. **Diese Methode ist in PDF.js 6 entfernt.** Die Verarbeitung warf beim ersten Link eine Exception, die vorhandene Fehlerbehandlung gab daraufhin eine *leere Linkliste* zurück. Sichtbare Folge auf dem Android-Gerät: `PDF-Linkflächen: 0 (Erkennung: empty)`.

**Verbindliche Korrektur** (`src/utils/pdfViewportRect.ts`): Die gegenüberliegenden Rechteck-Ecken über die noch vorhandene Methode `convertToViewportPoint(x, y)` abbilden und danach Minimum/Maximum bilden.

```ts
const a = viewport.convertToViewportPoint(rect[0], rect[1]);
const b = viewport.convertToViewportPoint(rect[2], rect[3]);
const minX = Math.min(a[0], b[0]);
const minY = Math.min(a[1], b[1]);
const width = Math.abs(b[0] - a[0]);
const height = Math.abs(b[1] - a[1]);
```

Die tatsächliche Hilfsfunktion `pdfRectToViewport` wird **sowohl für Links (`extractPageLinks`) als auch Formularfelder (`extractPdfFormFields`)** verwendet. Bei Änderungen müssen beide gemeinsam geprüft werden.

**Lehre:** Nur die PDF.js-Annotationen mit `page.getAnnotations()` auszulesen, beweist keine erfolgreiche Anzeige. Erst wenn die **PatricksPDF-Funktion** verwendbare Linkobjekte produziert und Browser-Taps die Aktion auslösen, ist der Fehler ausgeschlossen.

## 3. Verschlüsselte PDF: Lesen ist nicht Bearbeiten

Das beim Debugging verwendete **öffentliche FRITZ!Box-5690-Handbuch** war **AES-128-verschlüsselt, ließ sich jedoch ohne Benutzereingabe öffnen**. PDF.js lieferte gültige `Link`-Annotationen mit `GoTo`- und `URI`-Aktionen.

Der nachträglich ergänzte `pdf-lib`-Fallback (`src/utils/pdfRawLinks.ts`) war dafür **kein Ersatz**: `PDFDocument.load()` schlägt bei verschlüsselten PDFs mit `EncryptedPDFError` fehl. Die Rückgabe `0` konnte somit die eigentliche PDF.js-Viewport-Ausnahme verdecken.

**Aktuelles Sollverhalten:**
- **Anzeigen, Text auslesen und Links folgen:** bevorzugt PDF.js, einschließlich unterstützter verschlüsselter PDFs.
- **Link-Fallback:** `pdf-lib` nur, wenn das Dokument entsprechend lesbar/entschlüsselbar ist; kein Versprechen, dass verschlüsselte PDFs dort funktionieren.
- **Eigene Bearbeitung / Neu-Export über pdf-lib:** Verschlüsselung/Bearbeitungsschutz ausdrücklich melden und nicht mit `ignoreEncryption: true` eine unzuverlässige Neu-Serialisierung versuchen.
- **Unveränderte Bytes ausgeben:** wenn keine neue Inhaltsserialisierung erforderlich ist, darf `SaveModal` den Original-/aktuellen Bytepuffer durchreichen; das ist ein anderer Fall als Editieren.

**Bestätigter Gerätetest (öffentliche Handbuchausgabe):** Seite **2: 56 interne** Linkflächen, Seite **14: 7 externe** Linkflächen; Nutzer bestätigte die Bedienung in APK v1.0.76. Andere Handbuchausgaben können andere Links/Seitenzahlen enthalten.

## 4. Links richtig positionieren und aktivieren

`extractPageLinks()`:
1. PDF.js-Dokument aus den Cache-Bytes öffnen, PDF-Seite und `getAnnotations({ intent: 'display' })` laden.
2. Annotationen mit `subtype === 'Link'` und gültigem `rect` filtern.
3. Per `pdfRectToViewport()` Pixelrechteck bestimmen; bezogen auf `viewport.width` / `viewport.height` in **Prozentwerte** umrechnen.
4. Interne Destinations `dest`/`GoTo` mit `resolveDestinationPage()` in **1-basierte Seitenzahlen** überführen; bekannte `Named`-Aktionen berücksichtigen.
5. Externe `url`/`unsafeUrl` **nur als `http:` oder `https:`** akzeptieren.
6. Als `PdfLinkAnnotation[]` an `PdfPageView` liefern.

`PdfPageView` erstellt dafür **echte klickbare HTML-Anker**, `pointer-events-auto` am Anchor (Layer selbst `pointer-events-none`), mit direktem `onClick`. Interne Links rufen `onNavigateToPage()` auf; externe `openPdfExternalLink()`. Android nutzt eine geprüfte `ACTION_VIEW`-Intent-Bridge; Desktop ein neues Browserfenster.

**Nicht wieder einführen:** „Reparatur“ durch deaktivierte Anker (`pointer-events: none`) plus spekulative Pointer-Capture-/Tap-Hit-Handler. Das war ein erfolgloser Zwischenstand und hat die eigentliche API-Ursache nicht behoben.

**Fehlerfall `0 Links`:**
- Sind die Annotationen in `getAnnotations` vorhanden?
- Gibt `extractPageLinks` wegen einer Exception `[]` zurück (API-Bruch oder Destinationsauflösung)?
- Funktioniert der gleiche Test mit einer unverschlüsselten **synthetischen** PDF?
- Bei verschlüsselten PDFs ist ein ebenfalls leerer `pdf-lib`-Fallback **kein** Beleg für linklose Seiten.

**Fehlerfall Links vorhanden, Taps funktionieren nicht:**
- Prozentrechteck vs. Viewport, Rotation und CropBox prüfen;
- DOM-/CSS-Ebenen und Pointer-Events prüfen;
- echten Browser- bzw. Android-Klick testen (nicht nur `getAnnotations`).

## 5. Android-Schriftgrößen und Positionsgenauigkeit

Android-WebViews können `font-size`/Text-Autosizing so behandeln, dass die vom Browser berechneten Spans größer sind als die geometrisch exakt passenden PDF-Zeichen. Auf dem betroffenen Samsung trat ein Faktor von rund **1,15** auf. Die gemessene Auswahl-/Suchmarkierung driftete entsprechend horizontal.

**Implementierung:**

- PDF.js-6-Textlayer-CSS in `src/index.css` enthält u. a. `--total-scale-factor`, `--min-font-size`, `--font-height` und `--scale-x`. Bei einem Upgrade auf neue PDF.js-Versionen diese Formeln **gemeinsam** mit dem Renderer prüfen.
- `renderPdfTextLayer` verwendet den offiziellen `TextLayerBuilder`, nicht isolierte absolute Rechteck-Overlays.
- `compensatePdfTextLayerFonts` in `pdfTextMetrics.ts` liest **den tatsächlich berechneten** `font-size` und vergleicht ihn mit PDF.js' rechnerischem Soll: `--font-height * viewport.scale * --min-font-size`.
- Auf Android wird bei relevanter Abweichung der inverse Faktor (`SOLL / IST`) als `--font-metric-correction` auf die Textspan-Transformation angewandt; Desktop ist davon ausgenommen.
- Ein begrenzter Wertebereich und Rundungstoleranz verhindern Korrekturen bei offensichtlich ungültigen Messwerten.

**Verifizierte Beispielwerte (nur technische Zahlen, keine private PDF):**
- 272 % Zoom, `viewport.scale ≈ 2,7197`, `minFont ≈ 9,2024`, `font-height ≈ 9,96px`.
- `IST ≈ 286,67px`, `SOLL ≈ 249,28px`.
- Korrektur `SOLL/IST ≈ 0,87`.
- Der Nutzer bestätigte danach deckungsgleiche Textauswahl und Suchtreffer-Markierung in APK und Desktop.

**Wichtig:** Diese Korrektur nicht „vereinfachen“ oder pauschal als Zoom-Bug entfernen. Änderungen an `TextLayerBuilder`, Fontmetriken oder CSS-Transforms können beide Funktionen erneut zerstören.

## 6. Suchtreffer-Markierung: in Textspans, nicht separat

Die erste Implementierung legte Markierungsrechtecke aus `Range.getClientRects()` oberhalb der PDF-Seite ab. Auf Android waren sie horizontal versetzt; die Anzeige wurde durch CSS- und Fontmetrik-Anomalien verstärkt.

**Aktueller Pfad:**
1. `searchPdfDocument` liest mit PDF.js die eingebettete Textebene aller Seiten (maximal 1.000 Treffer; Trefferabbruch/Progress).
2. `PdfInlineTextHighlighter` implementiert die Highlighter-Schnittstelle des `TextLayerBuilder` (`setTextMapping` / `enable` / `disable`).
3. `getPdfInlineMatchSegments` ordnet Zeichenbereiche den von PDF.js selbst erzeugten Textspans zu; auch Treffer über mehrere Spans werden behandelt.
4. Markierungen werden **als Unterelemente der PDF.js-Spans** eingefügt, nicht als neue absolut positionierte Layer. Der ausgewählte Treffer erhält eine eigene CSS-Klasse.
5. Bei Suche-/Seiten-/Zoomwechsel werden alte Markierungen entfernt und nicht nach einem neueren Renderdurchlauf wiederhergestellt.

**Grenzen:** Kein OCR für Bildscans. PDF-Textruns, Zeilenenden und komplexe Normalisierung können von der sichtbaren Zeichenfolge abweichen. Bei Fehlzuordnung Tests für mehrere Spans, Zeilenumbrüche, Rotation und Sonderzeichen ergänzen, nicht Geometrie per Pixelversatz „korrigieren“.

## 7. Native Android-Textauswahl stabil halten

Der Browser verwaltet Auswahlgriffe und die native Kopierleiste selbst. Auf Android darf die App **keine zweite React-Auswahlleiste** parallel anzeigen (`TextSelectionToolbar` bleibt Desktop vorbehalten).

`selectionTouchesPdfTextLayer()` erkennt eine aktive Auswahl anhand beider DOM-Endpunkte `anchorNode` und `focusNode`. Während einer Android-PDF-Auswahl gelten folgende Schutzmaßnahmen:

- Ein durch geringfügiges Scrollen ausgelöster `IntersectionObserver`-Fokuswechsel darf nicht unmittelbar Fit Width und die Textpositionen neu berechnen.
- Automatische Zoom-Anpassungen durch Resize oder Seitenfokus werden pausiert.
- Touches an Auswahlgriffen sollen **keinen Double-Tap-Zoom** auslösen.
- Der Textlayer einer selektierten Seite wird beim Auswandern aus dem Sichtbereich nicht unmittelbar unmounted.
- Eine kurze Nachlaufzeit (~600 ms) schützt vor vorübergehend kollabierenden Selektionszuständen.

Die finale Android-Abnahme laut Nutzer war „gut genug soweit“, **nicht** der Nachweis vollständig fehlerfreier nativer WebView-Auswahl auf allen Geräten. Bei weiteren Problemen nicht direkt Änderungen an PDF.js-Schriftmetriken vornehmen: zunächst Re-Render, Selection-Events, Scroll-/Zoom-Anker, Offscreen-Unmount und doppelte Toolbars beobachten.

## 8. Tests und Abnahmematrix

**Automatisch:**

```bash
npm ci
npm run lint
npm test
npm run build
```

Die CI führt darüber hinaus einen **Headless-Chrome-Browser-Smoke-Test** mit `test/fixtures/encrypted-pdf-links.pdf` aus (`test/browserLinkProbe.mjs` und `test/browserLinkProbe.html`).

| Zu prüfendes Verhalten | Tests/Code | Erwartung |
| --- | --- | --- |
| PDF.js-6-Rechteckumrechnung, Rotation, Offset | `test/pdfViewportRect.test.ts` | Geometrie in gleichen Viewportkoordinaten |
| `GoTo`-/HTTPS-Links in PDF-Annotationen | `test/pdfLinks.test.ts` | 1-basiertes Ziel bzw. sichere URL |
| verschlüsselte PDF mit GoTo/URI im echten Browser | `test/encryptedPdfLinks.test.ts`, `test/browserLinkProbe.mjs` | PDF.js/PatricksPDF liefern beide Linkobjekte |
| Link-Anker in der React-Seite | `test/pdfLinkInteraction.test.ts` | pointer-aktive HTML-Anker; keine eigene Tap-Umleitung |
| `pdf-lib`-Fallback ohne Verschlüsselung | `test/pdfRawLinks.test.ts` | gewöhnliche Link-Objekte, keine gefährlichen Protokolle |
| Android-Fontkompensation | `test/pdfTextMetrics.test.ts` | Soll-/Ist-Faktor bei übergroßer WebView-Schrift |
| Inline-Highlight und Textsuche | `test/pdfInlineSearch.test.ts`, `test/pdfSearch.test.ts` | Zeichenbereiche und Suchbegriffe |
| Selektions-Erkennung und Zoom | `test/pdfSelection.test.ts`, `test/pdfjsPublicFixture.test.ts` | erkannte Textschicht, synthetische PDF-Leseprüfung |

**Auf einem echten Android-Gerät mindestens:**

1. Öffentliches Handbuch: Seite 2 Inhaltsverzeichnis-Link klicken → korrekte Zielseite; Seite 14 externen HTTP(S)-Link klicken → Systembrowser; **auch nach einer Textauswahl** testen.
2. Dokument mit druckbaren Wörtern bei ca. 200–270 %: Einzelwort und mehrere Zeilen selektieren, Auswahlgriffe bewegen und **kopierten Inhalt** mit sichtbarer Markierung vergleichen.
3. Textsuche inklusive Treffer auf späteren Seiten, Trefferwechsel und Zoom: orange Markierung **direkt über gesuchtem Wort**.
4. Fit Width beim Wechsel zwischen Seiten verschiedener Größe/Ausrichtung: keine unerwarteten Sprünge.
5. Verschlüsselte und unverschlüsselte PDFs: Anzeige und Links; bei geschützter Datei Editier-/Exportgrenze korrekt erklären.
6. Große PDF: Seitenverwaltung, Thumbnail-Lazy-Load, Speichern, Teilen und Drucken; Fehler nicht verschlucken.

Ein grüner `npm test`-Lauf allein reicht **nicht** aus: Die frühere Regression passierte trotz erfolgreicher Parser-Unit-Tests und wurde erst durch die vollständige Browser-Auslesefunktion nachgewiesen.

## 9. Wartungs-Checkliste

Wenn `pdfjs-dist` aktualisiert wird, in dieser Reihenfolge prüfen:

1. PDF.js-/Worker-Version und PWA-Assets in `vite.config.ts` synchron halten (CMaps, Fonts, WASM, ICC).
2. `renderPdfTextLayer` und Version von `TextLayerBuilder`/CSS-Variablen vergleichen.
3. `pdfRectToViewport`, `extractPageLinks` und `extractPdfFormFields` mit verschlüsselter **synthetischer** PDF im Browser testen.
4. Auf Android Linkanzahl/Linknavigation, Textauswahl, Fontkompensation, Suchmarkierung prüfen.
5. Formulardaten, Seitendrehung/CropBox, große PDFs und Undo/Redo über Seitenänderungen prüfen.
6. Erst nach erfolgreichem CI **und** Gerätetest mergen; vertrauliche Test-PDFs nicht hochladen.

Die historische PR-Diskussion darf als Debug-Verlauf erhalten bleiben, aber für den aktuellen Stand gelten diese Dokumentation, das Changelog und die Tests.
