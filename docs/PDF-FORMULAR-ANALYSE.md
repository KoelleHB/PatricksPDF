# Analyse der PDF-Formularunterstützung & PDF-Optimierung

Stand: Version 2.4.0 (Spezifikationsgerechte AcroForm-Zahlenformatierung, vollständige `formVisibility`-Zustandsintegration, hierarchische Aktionsauflösung und kollisionssichere PDF-Optimierung). Bezug: ISO 32000-1:2008, insbesondere Abschnitt 12.7 (interaktive Formulare), 12.5 (Annotationen), 12.6.4 (Aktionen) und Adobe Acrobat JavaScript Scripting Reference (`AFNumber_Format`, `AFSimple_Calculate`). Die Spezifikation ist über die [PDF Association](https://pdfa.org/resource/iso-32000-1/) zugänglich. Diese Analyse beschreibt den exakt im Code implementierten Stand und ist keine Zusage vollständiger Acrobat-Skriptkompatibilität.

## 1. Acrobat-Zahlenformatierung (`AFNumber_Format`) und Summenberechnung (`AFSimple_Calculate`)

Die App führt eingebettetes PDF-JavaScript aus Sicherheitsgründen **niemals** dynamisch aus (`enableScripting: false`, `isEvalSupported: false`, kein `eval()` / `Function()`). Für die eindeutig erkannten, deklarativen Muster `AFNumber_Format(nDec, sepStyle, ...)` und `AFSimple_Calculate("SUM", ...)` erfolgt eine kontrollierte, spezifikationsgerechte Auswertung in `src/utils/pdfFormFormatting.ts`:

| `sepStyle` | Tausendertrennzeichen | Dezimaltrennzeichen | Beispiel für `1234.56` (`nDec = 2`) |
| :---: | :---: | :---: | :---: |
| `0` | `,` (Komma) | `.` (Punkt) | `1,234.56` |
| `1` | keines | `.` (Punkt) | `1234.56` |
| `2` | `.` (Punkt) | `,` (Komma) | `1.234,56` |
| `3` | keines | `,` (Komma) | `1234,56` |

- **Eindeutiges Parsing (`parseNumber`)**: Ist `sepStyle` bekannt (`0..3`), werden Tausender-Gruppierungen (`^\d{1,3}(?:,\d{3})+$` bzw. `^\d{1,3}(?:\.\d{3})+$`) und Dezimaltrennzeichen strikt nach dem jeweiligen Stil validiert. Mehrdeutige Eingaben ohne bekannte `sepStyle`-Vorgabe (z. B. `"1.234"` oder `"1,234"` mit genau drei Nachkommastellen) oder widersprüchliche Trennzeichen (`"1.234.56"`, `"12,34.56"`) werden abgelehnt (`null`), statt stillschweigend fehlinterpretiert zu werden.
- **Präzise Summenberechnung (`calculateSupportedForms`)**: `AFSimple_Calculate("SUM", [...])` rechnet intern mit den ungerundeten Fließkommawerten verketteter Zwischensummen (`computedNumeric`) und formatiert erst das Endergebnis mit `formatSupportedNumber`, wodurch Kaskaden-Rundungsfehler vermieden werden. Zyklische Abhängigkeiten werden deterministisch über `visiting`/`done`-Sets abgefangen.

## 2. Status der AcroForm-Funktionen in Version 2.4.0

| Funktion | Aktueller Stand in v2.4.0 |
| --- | --- |
| Text, mehrzeilig, Comb, MaxLen | Vollständig interaktiv gerendert; `maxLen` und `comb` (Zeichenzellen) werden visuell und beim PDF-Export erzwungen. Mehrzeilige Textbereiche (`multiline`) unterstützt. |
| Checkbox und Radio | Unterstützt. Exportwerte von Optionsfeldern (`field.value`) und Checkboxen werden korrekt zugewiesen. |
| Auswahlfelder (Dropdowns / Listboxen) | Anzeige- und Exportwerte getrennt verarbeitet; `choiceExports` sichert die echten PDF-Exportwerte in `/V` und sortierte Indizes in `/I`. Einfache und Mehrfachauswahl (`multiSelect`) sowie editierbare Dropdowns mit Freitexteingaben via `<datalist>` werden unterstützt. |
| Schreibschutz | `readOnly`-Flags (inklusive Vererbung über `/Parent`-Dictionaries) werden aus den PDF-Annotationen ausgelesen und sperren Benutzerinteraktionen. |
| Hierarchische Feldnamen & Aktionen | Mehrstufige `/Parent`-Hierarchien werden mit Zyklenschutz und Tiefenbegrenzung (`MAX_HIERARCHY_DEPTH = 64`) zu vollqualifizierten Punkt-Namen (`parent.child.leaf`) aufgelöst. `/A`- und `/AA`-Einträge (`/U`, `/D`, `/F`, `/C`) werden sowohl direkt am Widget als auch an übergeordneten Feld-Dictionaries ausgewertet. Indirekte PDF-Referenzen (`PDFRef`) in `/Hide`- (`/T`) und `/ResetForm`-Zielen (`/Fields`) werden zu vollqualifizierten Feldnamen aufgelöst. |
| Schaltflächenaktionen | Navigationsschaltflächen (`/GoTo`, sichere `/URI`) werden nativ in der Link-Schicht aufgelöst. Deklarative `/Hide`- und `/ResetForm`-Aktionen werden über Objekt-Referenz und vollqualifizierten Feldnamen (`name:<fullName>`) zugeordnet. Gleichnamige Teilfelder in verschiedenen Teilbäumen (`billing.address.street` vs. `shipping.address.street`) kollidieren nicht; nur eindeutige Blattnamen erhalten zusätzlich einen `leaf:`-Fallback. Verkettete `/Next`-Aktionsbäume und nicht unterstützte Aktionen (z. B. `/SubmitForm`, freies `/JavaScript`) bleiben deaktiviert. |
| Reset (`/ResetForm`) | Unterstützt selektive Feldlisten (`/Fields`, als Strings oder indirekte Feld-Referenzen) und das Exclude-Flag (`Flags & 1`) sowie geerbte Default-Werte (`/DV`). Formularwerte werden bei Betätigung zurückgesetzt und in der Undo-Historie erfasst. |
| Ein-/Ausblenden (`/Hide`) & Zustandsintegration | `formVisibility` ist vollständig in `useDocumentHistory` (Undo/Redo, deterministischer `isSaved`-Status via `computeDocumentStateSignature`), IndexedDB-Entwürfe (`DocumentDraftRecord`), den `localStorage`-Notfall-Draft sowie alle Export-/Druck-/Teilen-Pfade integriert. Ursprünglich ausgeblendete Felder (`initiallyHidden` aus `/F` Bit 2 `Hidden` / Bit 6 `NoView`) bleiben beim Öffnen und Wiederherstellen verborgen und werden beim Flattening vor `form.flatten()` ebenso entfernt wie dynamisch ausgeblendete Felder. |
| XFA und digitale Signaturen | XFA-Formulare werden im AcroForm-Fallback als statische Dokumente behandelt. Freihand-Unterschriften sind visuelle Overlays, keine kryptografischen X.509-Digitalsignaturen. |

## 3. Technische Trennung: Verlustfreie vs. verlustbehaftete PDF-Optimierungen

Beim Speichern und Exportieren unterscheidet PatricksPDF strikt zwischen **100 % verlustfreien** Struktur-/Stream-Optimierungen und **kontrolliert verlustbehafteten** Bildoperationen:

| Verfahren | Klassifikation | Technische Umsetzung |
| --- | --- | --- |
| PDF 1.5 Object Streams (`useObjectStreams: true`) | **Verlustfrei** | Komprimiert indirekte PDF-Objekte und Cross-Reference-Tabellen per `FlateDecode`. |
| Kollisionssichere XObject-Deduplizierung (`getOrEmbedPdfImage`) | **Verlustfrei** | Identische Bild-Payloads werden per Fingerprint gruppiert und bei Hash-Treffern **Byte für Byte** (`areUint8ArraysEqual`) verglichen, bevor dasselbe PDF-`XObject` seitenübergreifend wiederverwendet wird. |
| Font-Subsetting (`{ subset: true }`) & Bedarfs-Einbettung | **Verlustfrei** | `Caveat-Regular.ttf` bettet exakt die verwendeten Glyphen (inkl. Umlaute `ÄÖÜäöüß€`) ein; `Helvetica` wird nur bei Bedarf geladen. |
| Zero-Alpha RGB Pre-Cleaning (`cleanZeroAlphaRgbPixels`) | **Verlustfrei** (für sichtbare Pixel) | Setzt RGB-Kanäle ausschließlich bei volltransparenten Hintergrundpixeln (`alpha === 0`) auf `0,0,0`, um die `FlateDecode`-Kompression von PNG-Signaturen zu verbessern. |
| 1:1 JPEG-Passthrough (`isJpegDataUrl` / `dataUrlToUint8Array`) | **Verlustfrei** (bezüglich Quelle) | Bereits als JPEG vorliegende Bilder (`<= 1600px`, ohne Auto-Crop) werden ohne erneutes Decoding/Re-Encoding 1:1 als `DCTDecode`-Stream übernommen. |
| Grafik-/Foto-Trennung & JPEG-Encoding (`isContinuousTonePhoto`) | **Verlustbehaftet** (nur bei Fotos) | Scharfkantige opake Grafiken, Stempel und Logos bleiben verlustfreie PNGs; nur echte Halbton-Fotos werden mit `quality: 0.92` als JPEG kodiert. |
| Auflösungsbegrenzung (`maxDim = 1600`) | **Verlustbehaftet** (Dimensionsreduktion) | Begrenzt hochauflösende Kameraaufnahmen auf maximal 1600 px Kantenlänge (~300 DPI für Stempel-/Unterschriftenflächen). |
