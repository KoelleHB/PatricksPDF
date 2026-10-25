# PatricksPDF

Privater PDF-Editor und -Reader als **Web-App/PWA** sowie **Android-App (Capacitor)**. Die eigentliche PDF-Verarbeitung erfolgt im Client. PatricksPDF kann PDFs lesen, durchsuchen, markieren bzw. Text kopieren, unterschreiben, mit Text ergänzen, Formularfelder ausfüllen, Seiten verwalten sowie Dateien speichern, teilen und drucken.

**Dokumentationsstand:** 25. Oktober 2026, `main` nach [PR #4](https://github.com/KoelleHB/PatricksPDF/pull/4) (Merge `8703279`). Diese Dokumentation beschreibt den Codezustand, nicht eine separate veröffentlichte Store-Version.

## Funktionen

- **Lesen:** PDF.js-Canvas, fortlaufende Seitendarstellung, Zoom/Fit Width je Seite, Lesemodus/Reflow, Inhaltsverzeichnis, interne und externe PDF-Links.
- **Suchen und kopieren:** lokale Volltextsuche mit Fundstellenkontext, Vor/Zurück, Navigation und positionsgenauer Markierung; native Android-Textauswahl. Die Suche ist auf **1.000 Treffer** begrenzt.
- **Bearbeiten & Unterschriftenbibliothek:** Unterschriften (inklusive lokal in IndexedDB gespeicherter Vorlagen-Bibliothek mit frei vergebbarer Bezeichnung), freie Textfelder (lokal eingebettete Schriften Helvetica und Caveat ohne externe Google-Fonts-Abhängigkeit) sowie vorhandene PDF-Formularfelder (AcroForms) mit abgesichertem Flattening.
- **Seitenverwaltung & Mehrfachauswahl:** Seiten einzeln oder per Mehrfachauswahl (Checkbox / Shift+Klick / Alle / Umkehren) drehen, duplizieren, löschen, neu ordnen, leere Seiten hinzufügen, Seiten aus anderen PDFs importieren sowie markierte Seiten direkt als neues PDF exportieren.
- **Speichererfreundliche Versionierung & Speicherstatus:** Undo/Redo arbeitet mit kompakten Änderungsoperationen und deduplizierten Dokument-Revisionen (max. 50 Einträge); der „Gespeichert“-Status wird deterministisch aus der Zustands-Signatur abgeleitet.
- **Ausgabe & Exporteinstellungen:** Vollständiges PDF oder ausgewählte Seiten/Seitenbereiche speichern, teilen und drucken – inklusive dauerhaft gespeicherter Dateinamens-Vorlagen (Suffix, Datum, Originalname) und Formular-Flattening-Vorgabe. Unter Android stehen sowohl das schnelle Speichern in `Downloads` als auch ein System-Ordnerdialog (`ACTION_CREATE_DOCUMENT`) zur Verfügung.
- **Zuletzt geöffnet:** lokale Historie über IndexedDB v2 mit getrennten Stores für leichte Metadaten (`recent_docs_meta`) und abrufbasierte PDF-Binärdaten (`recent_docs_blobs`) sowie kollisionssicherem SHA-256-Inhalts-Fingerprint (maximal 15 Dokumente bzw. 50 MiB).
- **Einheitliche Fehlerdiagnose:** Strukturiertes `AppError`-Fehlermodell mit technischer Diagnose-Ansicht und Kopierfunktion (`ErrorDiagnosticsModal`).

## Wichtige Grenzen

- Volltextsuche benötigt eine **eingebettete Textebene**. Reine Bildscans werden **nicht** per OCR erkannt.
- **Verschlüsselte oder bearbeitungsgeschützte PDFs:** PDF.js kann viele dieser Dateien lesen und deren Links auswerten. Die Bearbeitung und Neuspeicherung mittels `pdf-lib` ist bei verschlüsselten Dateien nicht zuverlässig möglich und wird im Exportpfad ausdrücklich abgelehnt, statt stillschweigend eine defekte PDF zu erzeugen. Nutze zum Bearbeiten eine berechtigt entschlüsselte, ungeschützte Ausgangsdatei.
- PDF-Links unterstützen Seitenziele innerhalb der Datei sowie freigegebene externe **HTTP(S)-Adressen**; riskante URL-Schemata werden nicht geöffnet.
- Ein erfolgreicher Build ersetzt keinen Gerätetest für Android-Auswahlgriffe, Share-Intents, große PDFs und systemabhängiges Drucken.

## Technischer Aufbau

| Teil | Technik | Relevante Dateien |
| --- | --- | --- |
| UI, State & Fehlerdiagnose | React 19, TypeScript, Vite 6, Tailwind CSS 4 | `src/App.tsx`, `src/components/`, `src/hooks/useDocumentHistory.ts`, `src/utils/appError.ts` |
| Anzeige, Text und Links | `pdfjs-dist` **6.4.299**, eigener Worker, Mozilla `TextLayerBuilder` | `src/utils/pdfWorker.ts`, `src/utils/pdfEngine.ts`, `src/utils/pdfDocumentLifecycle.ts` |
| Modifikationen, Teil-Export & Vorlagen | `pdf-lib` **1.17.1**, `@pdf-lib/fontkit`, `localStorage` | `src/utils/pdfEngine.ts`, `src/components/SaveModal.tsx`, `src/utils/exportSettings.ts` |
| Unterschriftenbibliothek | IndexedDB (`PatricksPDFSignaturesDB`) | `src/utils/signatureLibrary.ts`, `src/components/SignatureModal.tsx` |
| PWA / Share Target | `vite-plugin-pwa`, Service Worker | `vite.config.ts`, `src/hooks/usePwaShareTarget.ts` |
| Native Android-App | Capacitor 8, Java/Gradle, `NativePdfBridge` (`save`, `save_as`, `share`, `print`) | `android/`, `src/utils/nativeBridge.ts`, `src/utils/androidPdfTransfer.ts` |
| Lokaler Verlauf | IndexedDB v2 (`recent_docs_meta` & `recent_docs_blobs`), SHA-256-Fingerprint | `src/utils/recentDocuments.ts` |

Technische Zusammenhänge: [Architektur](docs/ARCHITECTURE.md). Rendering und Fehlerhistorie: [PDF-Rendering](docs/PDF-RENDERING.md).

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
npm test          # Node/tsx-Regressionstests
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

## CI, Builds und Versionsnummern

Die Workflow-Datei [`build-apk.yml`](.github/workflows/build-apk.yml) führt auf den unterstützten Events `npm ci`, TypeScript-Prüfung, Unit-Tests, Browser-Smoke-Test mit einer **synthetischen verschlüsselten PDF**, Web-Build, Capacitor-Synchronisierung und Android-Build aus.

- Die APK-Version im Workflow folgt dem Schema **`1.0.<github.run_number>`**. Der freigegebene letzte Testbranch-Build vor PR #4 war **`1.0.78`**; der nachfolgende Merge nach `main` ist ein *separater Commit* und löst einen eigenen CI-Lauf aus.
- Das Feld `version` in `package.json` steht derzeit auf **`0.0.0`** und ist **nicht** die Android-APK-Versionsnummer. Eine vereinheitlichte Release-Versionierung wäre eine eigene Änderung.
- Ein signiertes APK-Artefakt wird erzeugt, wenn die vier erforderlichen GitHub-Actions-Secrets eingerichtet sind; sonst baut die Action ein Debug-APK.
- Signing-Secrets: `ANDROID_RELEASE_KEYSTORE_BASE64`, `ANDROID_RELEASE_STORE_PASSWORD`, `ANDROID_RELEASE_KEY_ALIAS`, `ANDROID_RELEASE_KEY_PASSWORD`.
- CI-Artefakte sind zeitlich begrenzt (Release-APK derzeit **30 Tage**). Sie sind nicht mit permanenten GitHub Releases gleichzusetzen.

Die PWA konfiguriert Manifest, PDF-Share-Target und Offline-Caching in `vite.config.ts`. Ein Hosting-/Deploymentziel ist **nicht** in dieser README verbindlich festgelegt.

## Daten und Datenschutz

PDF-Seiten, Suchbegriffe und Exportbearbeitung werden im normalen Viewer-/Editorpfad lokal verarbeitet. **„Zuletzt geöffnet“ speichert Dokumentkopien in IndexedDB auf dem verwendeten Gerät/Browser-Profil**; diese Dateien können nach Schließen des Dokuments weiterhin lokal verfügbar sein. Man kann sie in der App entfernen, den Verlauf leeren oder – mit Vorsicht – die Site-Daten des Browsers löschen.

Beim **expliziten** Teilen, Drucken, Öffnen externer Links oder Speichern über Systemdialoge werden Daten an den gewählten Systemdienst bzw. Empfänger übergeben. PWA- und Android-Freigabe sind unterschiedliche Integrationspfade; nicht jede Quell-App liefert beim Teilen aus Cloudspeichern tatsächlich PDF-Bytes.

Vertrauliche PDFs, Keystores, Anmeldedaten und reproduzierbare Fehlerbeispiele mit personenbezogenem Inhalt **nicht** in das Repository oder CI-Artefakte aufnehmen.

## Dokumentation und Tests

- [CHANGELOG.md](CHANGELOG.md) – fachliche Änderungen und dokumentierter Stand.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) – Datenfluss, State, Plattformgrenzen, Builds und Persistenz.
- [docs/PDF-RENDERING.md](docs/PDF-RENDERING.md) – Rendering, Link-Regression nach PDF.js 6, Android-Schriftmetriken, Tests und Troubleshooting.
- [PR #4](https://github.com/KoelleHB/PatricksPDF/pull/4) – Merge- und Implementierungshistorie mit Abnahme auf Android.

**Hinweis für spätere Änderungen:** Nach einem Update von PDF.js immer *Textlayer, Link-Annotationen, verschlüsselte PDFs, Formfelder und Android-Auswahl* gemeinsam testen. Die konkrete Regression samt Prüfpfad ist in [docs/PDF-RENDERING.md](docs/PDF-RENDERING.md) festgehalten.
