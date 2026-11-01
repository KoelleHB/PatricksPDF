# Analyse der PDF-Formularunterstützung

Stand: Untersuchung von `formtest.pdf` und der Web-Implementierung. Bezug: ISO 32000-1:2008, insbesondere Abschnitt 12.7 (interaktive Formulare), 12.5 (Annotationen), 12.6.4 (Aktionen) und 7.7.4 (Namensbäume). Die Spezifikation ist über die [PDF Association](https://pdfa.org/resource/iso-32000-1/) zugänglich. Acrobat-JavaScript und Funktionen wie `AFSimple_Calculate` sind eine zusätzliche Adobe-Skriptumgebung und nicht gleichbedeutend mit den deklarativen PDF-Aktionen. Diese Analyse ist keine vollständige Konformitätsprüfung.

## Beispiel

Die Datei hat drei Seiten und ein AcroForm. Auf Seite 1 stehen Textfelder, Optionsfelder, Checkboxen, Auswahllisten und Schaltflächen. Die Schaltflächen führen `/Hide` (ein- und ausblenden), `/ResetForm` (zwei verschiedene Feldmengen) und `/SubmitForm` (externe HTTPS-Adresse) aus. Seiten 2 und 3 nutzen `/GoTo` und `/URI`, die seit dem vorigen Testbranch als Formular-Schaltflächen erkannt werden.

Die Zahlenfelder verwenden die JavaScript-Ereignisse `/F` und `/K` mit `AFNumber_Format` und `AFNumber_Keystroke`. Das schreibgeschützte Summenfeld nutzt `/C` mit `AFSimple_Calculate("SUM", ...)`. Die App führt eingebettetes JavaScript nicht aus; Zahlformatierung und Berechnung funktionieren daher nicht. Ein Formular-Skripting-System müsste Ereignisse, Berechnungsreihenfolge, API-Verfügbarkeit, Laufzeitisolation und Fehlerfälle abdecken; einfaches `eval` ist keine geeignete Lösung.

## Status

| Funktion | Aktueller Stand und Risiko |
| --- | --- |
| Text, mehrzeilig, Comb, MaxLen | Eingaben grundsätzlich vorhanden; `MaxLen` wird berücksichtigt. PDF-Textformatierung, Validierung, Passwort- und weitere Feldflags sind nicht vollständig umgesetzt. |
| Checkbox und Radio | Einfache Fälle vorhanden. Exportwerte und Erscheinungszustände, insbesondere gemeinsame Namen und andere On-Werte als `Yes`, benötigen zusätzliche Tests. |
| Auswahlfelder | Anzeige einfacher Listen und Dropdowns vorhanden. Unterschiedliche Anzeige- und Exportwerte werden nicht getrennt modelliert; Mehrfachauswahl und editierbare Comboboxen fehlen. Initiale PDF.js-Werte können Arrays sein. |
| Schreibschutz | PDF.js-Flag wird extrahiert; Eingaben werden mit der vorliegenden Änderung gesperrt. Schreibschutz im Fallback und über alle Zustandsänderungen hinweg benötigt weitere Tests. |
| Pflichtfelder | Ein Pflichtfeld wird nicht vollständig vor dem Absenden validiert. |
| Schaltflächenaktionen | Navigation `/GoTo` und sichere HTTP(S)-`/URI` funktionieren grundsätzlich. `/Hide`, `/ResetForm` und `/SubmitForm` werden nicht ausgeführt; Schaltflächen sind mit der vorliegenden Änderung sichtbar, aber deaktiviert. Vorher wurden sie wegen eines falsch geschriebenen PDF.js-Feldnamens übersehen. |
| Reset | PDF-Rücksetzen muss `/DV`, Feldhierarchie, `/Fields` und das Exclude-Flag berücksichtigen; der bisherige App-Reset auf beim Öffnen gelesene Werte ist dafür nicht gleichwertig. |
| Submit | Benötigt Interpretation von Ziel, Feldmenge, Flags, Datenformat und explizite Nutzerentscheidung vor Übertragung. Eine reguläre externe URL zu öffnen ersetzt das Absenden nicht. |
| Ein-/Ausblenden | `/Hide` kann mehrere Ziele und Widgets betreffen; Anzeigezustand darf Feldwerte nicht löschen und muss mit Drucken und Speichern abgestimmt werden. |
| Berechnung/Formatierung/Validierung | Eingebettete PDF-Skripte werden nicht ausgeführt. Ohne geeignete isolierte Laufzeit oder eine explizit begrenzte, verifizierte Teilimplementierung funktionieren diese Formulare nicht vollständig. |
| Speichern und Flatten | Export nutzt pdf-lib, setzt Werte und unterstützt optionales Flatten. Fehler bei Feldänderungen werden gemeldet. Dynamische Aktionen, Erscheinungsbilder, Schriftarten und alle Kombinationen von Feldflags sind damit nicht automatisch korrekt. |
| XFA und digitale Signaturen | XFA wird beim PDF.js-Laden angefordert, aber die AcroForm-Oberfläche implementiert keine vollständige XFA-Laufzeit. Eine gezeichnete Unterschrift ist keine kryptografische PDF-Digitalsignatur. |
| Geometrie | PDF.js-Koordinaten mit CropBox und Drehung; der pdf-lib-Fallback berücksichtigt Drehung nicht vollständig und begrenzt Koordinaten. Unterschiedliche Widgets und Seitenoperationen brauchen gezielte Regressionstests. |

## Empfohlene Reihenfolge

1. Ein gemeinsames Feldmodell mit vollständigen Namen, Widget-Identitäten, `/V`, `/DV`, Flags, Anzeige-/Exportwerten und Mehrfachauswahl schaffen; Rundlauf beim Speichern testen.
2. Deklarative Aktionen `/ResetForm` und `/Hide` anhand ihrer tatsächlichen Dictionaries implementieren; selektive und ausschließende Feldmengen sowie Sichtbarkeit und Undo prüfen. Unbekannte Aktionen klar kennzeichnen.
3. Submit mit expliziter Bestätigung, Zielprüfung und korrektem Format implementieren und vor einem Netzaufruf Pflichtfelder prüfen.
4. Skriptgestützte Formulare gesondert entwerfen: zunächst Bedarf und Kompatibilität klären, dann eine isolierte, eingeschränkte Laufzeit oder bewusst begrenzte Unterstützung implementieren. Keine willkürlichen Dokumentenskripte im App-Kontext ausführen.
5. Automatisierte Browser- und Exporttests mit synthetischen, nicht vertraulichen PDFs für Aktionen, Zoom, Rotation, Flags, Standardwerte, Mehrfachauswahl und Wiederöffnen ergänzen; zusätzlich Android und andere Viewer testen.
