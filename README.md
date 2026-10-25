# PatricksPDF

Privater PDF-Editor und -Reader (**Version 2.0 / `2.0.0`**) als **Web-App/PWA** sowie **Android-App (Capacitor)**. Die eigentliche PDF-Verarbeitung erfolgt vollständig im Client. PatricksPDF kann PDFs lesen, durchsuchen, markieren bzw. Text kopieren, im aktuell sichtbaren Zoom-Ausschnitt unterschreiben und mit Text ergänzen, Formularfelder ausfüllen, Seiten verwalten sowie Dateien und Seiten-Teilmengen datenschutzsicher speichern, teilen und drucken.

**Dokumentationsstand:** 25. Oktober 2026 – **Version 2.0 (`2.0.0`)**. Diese Dokumentation beschreibt den vollständigen Code- und Architekturzustand von Version 2.0.

## Funktionen

- **Lesen:** PDF.js-Canvas, fortlaufende Seitendarstellung, Zoom/Fit Width je Seite, Lesemodus/Reflow, Inhaltsverzeichnis (mit streng geprüften internen Zielen und externen HTTP(S)-Links), interne und externe PDF-Links.
- **Suchen und kopieren:** lokale Volltextsuche mit Fundstellenkontext, Vor/Zurück, Navigation und positionsgenauer Markierung; native Android-Textauswahl. Die Suche ist auf **1.000 Treffer** begrenzt.
- **Bearbeiten, Viewport-Platzierung & Unterschriftenbibliothek:**
  - Unterschriften (inklusive lokal in IndexedDB gespeicherter Vorlagen-Bibliothek mit frei vergebbarer Bezeichnung) und freie Textfelder (lokal eingebettete Schriften Helvetica und Caveat ohne externe Google-Fonts-Abhängigkeit) werden **automatisch in der Mitte des aktuell sichtbaren Seiten-Ausschnitts (Viewport)** platziert.
  - Beim starken Reinzoomen passt sich die Anfangsgröße einer neuen Unterschrift proportional an den sichtbaren Ausschnitt an; mehrere direkt nacheinander eingefügte Elemente werden leicht versetzt (Kaskadierung) platziert, damit sie sich nicht exakt überdecken.
  - Unterstützung vorhandener PDF-Formularfelder (AcroForms) mit strikter Options-/Darstellungsprüfung, automatischem Debounce-Flush vor Speichern/Drucken/Teilen und abgesichertem Flattening.
- **Seitenverwaltung & Mehrfachauswahl:** Seiten einzeln oder per Mehrfachauswahl (Checkbox / Shift+Klick / Alle / Umkehren) drehen, duplizieren, löschen, neu ordnen, leere Seiten hinzufügen, Seiten aus anderen unverschlüsselten PDFs importieren sowie markierte Seiten direkt als neues PDF exportieren – **ohne unübernommene Entwurfsänderungen ungewollt in das geöffnete Arbeitsdokument zu schreiben**.
- **Datenschutzsicherer Teil-Export (Physische Bereinigung):** Beim Export einzelner Seiten oder Seitenbereiche (`1-3, 5`) werden nicht ausgewählte Seiten vorab isoliert, seitenfremde Referenzen (`Widgets`, `Annots`, `StructParents`) bereinigt und ausschließlich die gewünschten Seiten in ein frisches `PDFDocument` kopiert. Vertrauliche Texte, Streams oder Formularwerte ausgeschlossener Seiten verbleiben **nicht** als verwaiste PDF-Objekte in der Exportdatei.
- **Speicherfreundliche Versionierung & Speicherstatus:** Undo/Redo arbeitet mit kompakten Änderungsoperationen und deduplizierten Dokument-Revisionen (max. 50 Einträge); der „Gespeichert“-Status wird deterministisch aus der Zustands-Signatur abgeleitet.
- **Ausgabe & Exporteinstellungen:** Vollständiges PDF oder ausgewählte Seiten/Seitenbereiche speichern, teilen und drucken – inklusive dauerhaft gespeicherter Dateinamens-Vorlagen (Suffix, Datum, Originalname) und Formular-Flattening-Vorgabe. Unter Android stehen sowohl das schnelle Speichern in `Downloads` als auch ein gegen Activity-Neustarts, Timeouts und Parallelaufrufe abgesicherter System-Ordnerdialog (`ACTION_CREATE_DOCUMENT`) zur Verfügung.
- **Zuletzt geöffnet:** lokale Historie über IndexedDB v2 mit getrennten Stores für leichte Metadaten (`recent_docs_meta`) und abrufbasierte PDF-Binärdaten (`recent_docs_blobs`) sowie kollisionssicherem SHA-256-Inhalts-Fingerprint (maximal 15 Dokumente bzw. 50 MiB).
- **Einheitliche Fehlerdiagnose:** Strukturiertes `AppError`-Fehlermodell (`v2.0.0`) mit technischer Diagnose-Ansicht und Kopierfunktion (`ErrorDiagnosticsModal`).

## Wichtige Grenzen

- Volltextsuche benötigt eine **eingebettete Textebene**. Reine Bildscans werden **nicht** per OCR erkannt.
- **Verschlüsselte oder bearbeitungsgeschützte PDFs:** PDF.js kann viele dieser Dateien lesen und deren Links auswerten. Die Bearbeitung, der Seitenimport und die Neuspeicherung mittels `pdf-lib` sind bei verschlüsselten Dateien nicht zuverlässig möglich und werden in `pdfExportEngine.ts` sowohl beim Speichern als auch in der Seitenverwaltung ausdrücklich abgelehnt (`ignoreEncryption: false`), statt stillschweigend eine defekte PDF zu erzeugen. Nutze zum Bearbeiten eine berechtigt entschlüsselte, ungeschützte Ausgangsdatei.
- PDF-Links und Inhaltsverzeichnis-Einträge unterstützen Seitenziele innerhalb der Datei sowie freigegebene externe **HTTP(S)-Adressen**; riskante URL-Schemata (`javascript:`, `data:`, `file:`, `content:`) werden abgewiesen.
- Ein erfolgreicher Build ersetzt keinen Gerätetest für Android-Auswahlgriffe, Share-Intents, große PDFs und systemabhängiges Drucken.

## Technischer Aufbau

| Teil | Technik | Relevante Dateien |
| --- | --- | --- |
| UI, State & Fehlerdiagnose | React 19, TypeScript, Vite 6, Tailwind CSS 4 | `src/App.tsx`, `src/components/`, `src/hooks/useDocumentHistory.ts`, `src/utils/appError.ts` |
| Anzeige, Text und Links | `pdfjs-dist` **6.4.299**, eigener Worker, Mozilla `TextLayerBuilder` | `src/utils/pdfWorker.ts`, `src/utils/pdfEngine.ts`, `src/utils/pdfDocumentLifecycle.ts` |
| PDF-Export, Teil-Export & Seitenoperationen | `pdf-lib` **1.17.1**, `@pdf-lib/fontkit`, physische Objekt-Isolation | `src/utils/pdfExportEngine.ts`, `src/components/SaveModal.tsx`, `src/components/PageManagementModal.tsx`, `src/utils/exportSettings.ts` |
| Viewport-Platzierung | Zoom- und ausschnittabhängige Koordinatenberechnung + Kaskadierung | `src/utils/pdfPlacement.ts`, `src/components/PdfViewer.tsx` |
| Unterschriftenbibliothek | IndexedDB (`PatricksPDFSignaturesDB`) | `src/utils/signatureLibrary.ts`, `src/components/SignatureModal.tsx` |
| PWA / Share Target | `vite-plugin-pwa`, Service Worker | `vite.config.ts`, `src/hooks/usePwaShareTarget.ts` |
| Native Android-App | Capacitor 8, Java/Gradle, `NativePdfBridge` (`save`, `save_as`, `share`, `print`) | `android/`, `src/utils/nativeBridge.ts`, `src/utils/androidPdfTransfer.ts` |
| Lokaler Verlauf | IndexedDB v2 (`recent_docs_meta` & `recent_docs_blobs`), SHA-256-Fingerprint | `src/utils/recentDocuments.ts` |

Technische Zusammenhänge: [Architektur](docs/ARCHITECTURE.md). Rendering und Fehlerhistorie: [PDF-Rendering](docs/PDF-RENDERING.md). Meilensteine: [MILESTONES.md](MILESTONES.md).

## Lokal entwickeln

**Voraussetzungen:** Git-Zugriff auf das Repository und **Node.js 22** (wie im CI). Für native Builds zusätzlich **JDK 21**, Android SDK und die lokal eingerichtete Android-/Gradle-Toolchain.

```bash
git clone https://github.com/KoelleHB/PatricksPDF.git
cd PatricksPDF
npm ci
npm run dev
```

Der Entwicklungsserver läuft gemäß `vite.config.ts` normalerweise auf `http://localhost:3000`. Ein expliziter Host/Port ist über die üblichen Vite-Parameter möglich.

**Qualitätsprüfungen und Web-Build:**

```bash
npm run lint      # tsc --noEmit
npm test          # Node/tsx-Regressionstests (13 Test-Suiten)
npm run build     # Vite-PWA-Build nach dist/
```

**Android-Debug-Build:**

```bash
npm run build
npx cap sync android
cd android
./gradlew assembleDebug
```

Die erzeugte Debug-APK liegt regulär unter `android/app/build/outputs/apk/debug/`. Für Windows ist die Gradle-Wrapper-Datei `gradlew.bat` vorgesehen. Für ein *signiertes Release* die GitHub-Action verwenden; keine privaten Keystore-Daten einchecken.

## CI, Builds und Versionsnummern (Version 2.0)

Die Workflow-Datei [`build-apk.yml`](.github/workflows/build-apk.yml) führt auf den unterstützten Events `npm ci`, TypeScript-Prüfung, sämtliche Unit- und Architektur-Regressionstests (`npm test`), einen Browser-Smoke-Test mit einer **synthetischen verschlüsselten PDF**, den Web-Build, die Capacitor-Synchronisierung und den Android-Build aus.

- **Version 2.0 (`2.0.0`):** Sowohl `package.json` als auch der lokale Android-Fallback in `android/app/build.gradle` und die Fehlerdiagnose (`APP_VERSION`) sind einheitlich auf **`2.0.0`** gesetzt.
- Die APK-Version im CI-Workflow folgt dem Schema **`2.0.<github.run_number>`** (Artefaktname `PatricksPDF-release-v2.0.<run_number>` bzw. `PatricksPDF-debug-v2.0.<run_number>`).
- Ein signiertes APK-Artefakt wird erzeugt, wenn die vier erforderlichen GitHub-Actions-Secrets eingerichtet sind; sonst baut die Action ein Debug-APK.
- Signing-Secrets: `ANDROID_RELEASE_KEYSTORE_BASE64`, `ANDROID_RELEASE_STORE_PASSWORD`, `ANDROID_RELEASE_KEY_ALIAS`, `ANDROID_RELEASE_KEY_PASSWORD`.
- CI-Artefakte sind zeitlich begrenzt (Release-APK derzeit **30 Tage**). Sie sind nicht mit permanenten GitHub Releases gleichzusetzen.

Die PWA konfiguriert Manifest, PDF-Share-Target und Offline-Caching in `vite.config.ts`. Ein Hosting-/Deploymentziel ist **nicht** in dieser README verbindlich festgelegt.

## Daten und Datenschutz

PDF-Seiten, Suchbegriffe und Exportbearbeitung werden im normalen Viewer-/Editorpfad lokal verarbeitet. Beim Teil-Export einzelner Seiten sorgt `pdfExportEngine.ts` dafür, dass Inhalte und Formularwerte ausgeschlossener Seiten physisch aus dem exportierten PDF entfernt werden.

**„Zuletzt geöffnet“ speichert Dokumentkopien in IndexedDB auf dem verwendeten Gerät/Browser-Profil**; diese Dateien können nach Schließen des Dokuments weiterhin lokal verfügbar sein. Man kann sie in der App entfernen, den Verlauf leeren oder – mit Vorsicht – die Site-Daten des Browsers löschen. Gespeicherte Unterschriften-Vorlagen liegen lokal in `PatricksPDFSignaturesDB` und können jederzeit in der Unterschriftenbibliothek gelöscht werden.

Beim **expliziten** Teilen, Drucken, Öffnen externer Links oder Speichern über Systemdialoge werden Daten an den gewählten Systemdienst bzw. Empfänger übergeben. PWA- und Android-Freigabe sind unterschiedliche Integrationspfade; nicht jede Quell-App liefert beim Teilen aus Cloudspeichern tatsächlich PDF-Bytes.

Vertrauliche PDFs, Keystores, Anmeldedaten und reproduzierbare Fehlerbeispiele mit personenbezogenem Inhalt **nicht** in das Repository oder CI-Artefakte aufnehmen.

## Dokumentation und Tests

- [CHANGELOG.md](CHANGELOG.md) – fachliche Änderungen und dokumentierter Stand bis Version 2.0.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) – Datenfluss, State, Teil-Export-Isolation, Plattformgrenzen, Builds und Persistenz.
- [docs/PDF-RENDERING.md](docs/PDF-RENDERING.md) – Rendering, Link-Regression nach PDF.js 6, Android-Schriftmetriken, Tests und Troubleshooting.
- [MILESTONES.md](MILESTONES.md) – Projekt-Meilensteine von v1.0 bis v2.0.
- [ANDROID_RELEASE_SIGNING.md](ANDROID_RELEASE_SIGNING.md) – Anleitung für signierte Android-Releases.
- [CI_MAINTENANCE.md](CI_MAINTENANCE.md) – CI- und Gradle-Wartungshinweise.

**Hinweis für spätere Änderungen:** Nach einem Update von PDF.js immer *Textlayer, Link-Annotationen, verschlüsselte PDFs, Formfelder und Android-Auswahl* gemeinsam testen. Die konkrete Regression samt Prüfpfad ist in [docs/PDF-RENDERING.md](docs/PDF-RENDERING.md) festgehalten.
