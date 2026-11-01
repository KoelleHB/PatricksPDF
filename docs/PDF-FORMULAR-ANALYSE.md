# Analyse der PDF-Formularunterstützung

Stand: Version 2.4.0 (AcroForms-Härtung, Export-Persistenz und europäische Zahlenformate). Bezug: ISO 32000-1:2008, insbesondere Abschnitt 12.7 (interaktive Formulare), 12.5 (Annotationen), 12.6.4 (Aktionen) und 7.7.4 (Namensbäume). Die Spezifikation ist über die [PDF Association](https://pdfa.org/resource/iso-32000-1/) zugänglich. Acrobat-JavaScript und Funktionen wie `AFSimple_Calculate` sind eine zusätzliche Adobe-Skriptumgebung und nicht gleichbedeutend mit den deklarativen PDF-Aktionen. Diese Analyse ist keine vollständige Konformitätsprüfung.

## Beispiel und Testbasis

Die Testdatei hat drei Seiten und ein AcroForm. Auf Seite 1 stehen Textfelder, Optionsfelder, Checkboxen, Auswahllisten und Schaltflächen. Die Schaltflächen führen `/Hide` (ein- und ausblenden), `/ResetForm` (selektive Feldmengen) und `/SubmitForm` (externe HTTPS-Adresse) aus. Seiten 2 und 3 nutzen `/GoTo` und `/URI`, die als Formular-Schaltflächen bzw. Widget-Links erkannt und bedient werden.

Die Zahlenfelder verwenden die JavaScript-Ereignisse `/F` und `/K` mit `AFNumber_Format` und `AFNumber_Keystroke`. Das schreibgeschützte Summenfeld nutzt `/C` mit `AFSimple_Calculate("SUM", ...)`. Die App führt eingebettetes JavaScript aus Sicherheitsgründen nicht aus. Für die exakt erkannten Formen von `AFNumber_Format` (US- und europäische Separator-Stile `sepStyle = 0, 1, 2, 3`) und `AFSimple_Calculate("SUM", ...)` gibt es eine isolierte deklarative Auswertung; andere Skripte bleiben unberührt.

## Status in Version 2.4.0

| Funktion | Aktueller Stand in v2.4.0 |
| --- | --- |
| Text, mehrzeilig, Comb, MaxLen | Vollständig interaktiv gerendert; `maxLen` und `comb` (Zeichenzellen) werden visuell und beim PDF-Export erzwungen. Mehrzeilige Textbereiche (`multiline`) unterstützt. |
| Checkbox und Radio | Unterstützt. Exportwerte von Optionsfeldern (`field.value`) und Checkboxen werden korrekt zugewiesen. |
| Auswahlfelder (Dropdowns / Listboxen) | Anzeige- und Exportwerte getrennt verarbeitet; `choiceExports` sichert die echten PDF-Exportwerte in `/V` und sortierte Indizes in `/I`. Einfache und Mehrfachauswahl (`multiSelect`) sowie editierbare Dropdowns mit Freitexteingaben via `<datalist>` werden unterstützt. |
| Schreibschutz | `readOnly`-Flags werden aus den PDF-Annotationen ausgelesen und sperren Benutzerinteraktionen. |
| Schaltflächenaktionen | Navigationsschaltflächen (`/GoTo`, sichere `/URI`) werden nativ in der Link-Schicht aufgelöst. Deklarative `/Hide`- und `/ResetForm`-Aktionen werden über duale Schlüssel (Objekt-Ref und vollqualifizierter Feldname `/T`) zuverlässig erkannt. Nicht unterstützte Schaltflächen (z. B. ungeschütztes Submit) sind deaktiviert. |
| Reset (`/ResetForm`) | Unterstützt selektive Feldlisten (`/Fields`) und das Exclude-Flag (`Flags & 1`) sowie Default-Werte (`/DV`). Formularwerte werden bei Betätigung zurückgesetzt und in der Undo-Historie erfasst. |
| Ein-/Ausblenden (`/Hide`) | Unterstützt Ein- und Ausblenden über Ziellisten und Feldhierarchien in der Ansicht. **In v2.4 persistiert**: Beim Exportieren werden ausgeblendete Widgets über die Annotation-Flags `/F` (`Hidden` Bit 2, `NoView` Bit 6) im PDF-Binärdokument gesichert bzw. vor dem Flattening entfernt. |
| Berechnung & Formatierung | Unterstützt US-Formate (`1,234.50`) und europäische Zahlenformate (`1.234,50` bzw. `sepStyle = 1, 3`). Summenfelder berechnen zyklusfrei (`visiting`/`done`-Prüfung) abhängige Werte ohne Script-Ausführung. |
| Speichern und Flatten | Export nutzt `pdf-lib`, setzt Werte, erhält Exportwerte von Auswahllisten, unterstützt optionales Flattening und berücksichtigt konfigurierbare Seitenteilmengen (Subset-Export). |
| XFA und digitale Signaturen | XFA-Formulare werden im AcroForm-Fallback als statische Dokumente behandelt. Freihand-Unterschriften sind visuelle Overlays, keine kryptografischen X.509-Digitalsignaturen. |

## Umgesetzte Härtungsmaßnahmen (v2.4)

1. **Dual-Key Lookup**: `readFormActions` und `readFormFormatting` mappen Aktionen sowohl auf `${ref.objectNumber}R${ref.generationNumber}` als auch auf `name:${fieldName}`. Damit greifen Aktionen auch dann, wenn PDF.js synthetische IDs vergibt.
2. **Export-Persistenz für Sichtbarkeit**: Dynamisch ausgeblendete Felder behalten ihren Zustand im gespeicherten PDF und öffnen sich in Drittviewer-Programmen (Acrobat, Browser) im ausgeblendeten Zustand.
3. **Internationale Trennzeichen**: Unterstützung für europäische Formatierungsregeln mit Punkt als Tausender- und Komma als Dezimaltrenner bei Eingabe, Berechnung und Formatierung.
4. **Vollständige Testabdeckung**: 51 automatisierte Unit-Tests inklusive Export-Flags, zyklischer Summen und Versionskonsistenz.
