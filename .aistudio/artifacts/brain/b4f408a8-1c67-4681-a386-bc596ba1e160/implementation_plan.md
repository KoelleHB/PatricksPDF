# Architektur- & Funktions-Upgrade (12-Punkte-Paket)

## 1. Übersicht & Zielsetzung

Dieses Upgrade hebt **PatricksPDF** sowohl architektonisch (Speichereffizienz, Datenintegrität, Offline-Unabhängigkeit, deterministische Zustandsverwaltung, strukturiertes Fehlermodell) als auch funktional (Mehrfachauswahl & Teil-Export von Seiten, Android-Ordnerwahl via Storage Access Framework, wiederverwendbare Unterschriftenbibliothek, persistente Exporteinstellungen) auf die nächste Ausbaustufe.

---

## 2. Detaillierte technische Konzeption der 12 Punkte

### Punkt 1: Kompakte Änderungsoperationen statt vollständiger Dokument-Snapshots (`src/hooks/useDocumentHistory.ts`)
- **Ist-Zustand**: Jeder History-Eintrag speichert ein vollständiges `DocumentSnapshot`-Objekt inklusive `pageDocument` (`ArrayBuffer`). Bei großen PDFs und mehreren strukturellen Seitenänderungen vervielfacht sich der RAM-Bedarf.
- **Soll-Architektur**:
  - Einführung einer deduplizierten **Binary-Revision-Tabelle** (`Map<string, PageDocumentSnapshot>`) innerhalb des History-Hooks, referenziert über eine leichtgewichtige `docRevisionId: string`. Reine Overlay- oder Formular-Aktionen (`Add Signature`, `Move Text`, `Fill Field`) referenzieren lediglich dieselbe `docRevisionId` ohne Kopie des `ArrayBuffer`.
  - Speicherung kompakter **Delta-Operationen** (`HistoryOperation`: z. B. `{ type: 'signature-upsert' | 'signature-remove' | 'text-upsert' | 'text-remove' | 'form-patch' | 'page-structure', prev, next, revisionId }`) mit Vorwärts-/Rückwärts-Anwendung (`applyOperation` / `invertOperation`).
  - Bei Überschreiten von `MAX_HISTORY_LENGTH` (50) oder beim Schließen des Dokuments werden nicht mehr referenzierte `docRevisionId`-Puffer automatisch aus der Map bereinigt (Garbage Collection).

### Punkt 2: Export- und Formularfehler weiter absichern (`src/utils/pdfEngine.ts`, `src/components/SaveModal.tsx`)
- **Ist-Zustand**: Im `SaveModal` ruft der manuelle „Retry"-Button `embedSignaturesIntoPdf` direkt auf und umgeht dabei den Optimierungspfad für unveränderte Dokumente, das Aufräumen alter Blob-URLs sowie die einheitliche Fehlerbehandlung. Zudem werden problematische einzelne AcroForm-Felder beim Export nur mit `console.warn` übersprungen, ohne dem Nutzer oder der Diagnose rückzumelden, falls ein Feld oder das Flattening fehlschlug.
- **Soll-Architektur**:
  - Kapselung der PDF-Erzeugung in `SaveModal.tsx` in einer einzigen idempotenten Funktion `buildExportPdf()`, die sowohl vom `useEffect` als auch vom „Retry"-Button genutzt wird (inklusive sauberem `AbortController`/Cancellation-Guard und `URL.revokeObjectURL`).
  - Erweiterung von `embedSignaturesIntoPdf` um strukturierte Validierung: Prüfung von Seitenbereichen, sichere Konvertierung von Feldwerten (inkl. Schutz vor ungültigen Optionswerten in Dropdowns/Radio-Buttons, die in `pdf-lib` sonst Exceptions werfen) und gezielter Fallback, falls `form.flatten()` bei defekten PDF-Widget-Appearances fehlschlägt.

### Punkt 3: Robuste Dokument-Identifikation per Inhalts-Fingerprint (`src/utils/recentDocuments.ts`)
- **Ist-Zustand**: `generateDocId(name, byteLength)` nutzt nur Dateiname und Dateigröße (`doc_${safeName}_${byteLength}`). Gleichnamige PDFs gleicher Größe (z. B. ausgefüllte Formular-Vorlagen) überschreiben sich gegenseitig.
- **Soll-Architektur**:
  - Berechnung eines schnellen, kryptografischen **SHA-256 Content-Fingerprints** (`computePdfFingerprint(buffer: ArrayBuffer): Promise<string>`) über `crypto.subtle.digest('SHA-256', ...)`.
  - Um auch bei 100-MB-PDFs unter 5 ms zu bleiben, wird bei Dateien > 2 MB ein deterministischer Multi-Segment-Slice (erste 256 KB + mittlere 256 KB + letzte 256 KB + exakte Byte-Länge) gehasht, bei kleineren Dateien der gesamte Puffer.
  - Die resultierende `id` lautet `doc_${byteLength}_${sha256Hex.slice(0, 24)}` und ist damit kollisionssicher unabhängig vom Dateinamen.

### Punkt 4: Metadaten von PDF-Binärdaten in IndexedDB trennen (`src/utils/recentDocuments.ts`, `src/App.tsx`, `src/components/EmptyState.tsx`, `src/components/RecentDocumentsModal.tsx`)
- **Ist-Zustand**: `PatricksPDFRecentDB` (Version 1) speichert `pdfBuffer: ArrayBuffer` direkt im Datensatz von `recent_docs`. `getRecentDocuments()` lädt beim App-Start via `store.getAll()` bis zu 50 MB Binärdaten in den Arbeitsspeicher, obwohl für die Startseite nur Name, Seitenzahl, Datum und Thumbnail benötigt werden.
- **Soll-Architektur**:
  - Upgrade auf **`DB_VERSION = 2`** mit zwei getrennten Object Stores:
    1. `recent_docs_meta`: `{ id, name, sizeBytes, numPages, lastOpened, thumbnailDataUrl }` (wenige Kilobyte).
    2. `recent_docs_blobs`: `{ id, pdfBuffer: ArrayBuffer }` (wird nur on-demand über `getRecentDocumentBlob(id)` geladen, wenn ein Dokument tatsächlich geöffnet, gedruckt oder geteilt wird).
  - **Nahtlose Migration**: Im `onupgradeneeded`-Handler (v1 → v2) werden bestehende Einträge aus `recent_docs` automatisch in `recent_docs_meta` und `recent_docs_blobs` aufgeteilt, sodass keine bestehenden Verlaufsdaten verloren gehen.

### Punkt 5: Gespeichert-Status deterministisch aus Dokument-Zustand ableiten (`src/hooks/useDocumentHistory.ts`, `src/App.tsx`)
- **Ist-Zustand**: `isSaved` ist ein manuelles `useState(true)`-Flag in `App.tsx`, das über `markUnsaved()` gesetzt wird. Wenn der Nutzer eine Änderung vornimmt und diese per `Undo` wieder vollständig rückgängig macht (zurück zum Ausgangszustand oder zum zuletzt gespeicherten Zustand), bleibt das Dokument fälschlicherweise als „Ungespeichert" markiert.
- **Soll-Architektur**:
  - Jede committed oder live geänderte Dokument-Revision besitzt einen deterministischen **State-Digest / Revisionszähler** (`currentStateSignature`), berechnet aus:
    - `docRevisionId` (struktureller PDF-Puffer),
    - serialisierten Signaturen (`signatures`),
    - serialisierten Text-Overlays (`textOverlays`),
    - aktuellen Formularwerten (`formValues`) sowie Status eines evtl. laufenden Formular-Debounces.
  - `savedStateSignature` speichert den Digest zum Zeitpunkt des Öffnens bzw. des letzten erfolgreichen Speicherns (`markCurrentStateSaved()`).
  - `isSaved` und `hasUnsavedChanges` leiten sich direkt aus `currentStateSignature === savedStateSignature` ab – inklusive korrekter Rückkehr auf „Gespeichert" nach `Undo` bis zum letzten Speicherpunkt.

### Punkt 6: Externe Google Fonts vollständig entfernen (`index.html`, `src/index.css`)
- **Ist-Zustand**: `index.html` enthält noch `<link rel="preconnect" href="https://fonts.googleapis.com">` sowie das Google-Fonts-Stylesheet für `Caveat`, obwohl `/public/Caveat-Regular.ttf` lokal gebündelt ist.
- **Soll-Architektur**:
  - Entfernen aller Google-Fonts-`<link>`-Tags aus `index.html` (100 % Offline-First & DSGVO-freundlich ohne externe Requests).
  - Deklaration von `@font-face { font-family: 'Caveat'; src: url('/Caveat-Regular.ttf') format('truetype'); font-weight: 400 700; font-display: swap; }` direkt in `src/index.css`.

### Punkt 7: Einheitliche technische Fehlerdiagnose (`src/utils/appError.ts`, `src/components/ErrorDiagnosticsModal.tsx`, `src/App.tsx`)
- **Ist-Zustand**: Fehler werden teils als einfacher String (`pdfErrorMessage`), teils als `shareIssueNotice`-Objekt und teils lokal in Modals behandelt.
- **Soll-Architektur**:
  - Einführung eines zentralen Fehlermodells `AppError` in `src/utils/appError.ts`:
    - `code`: typisierter Fehlercode (z. B. `'PDF_ENCRYPTED'`, `'PDF_CORRUPT'`, `'FORM_EMBED_ERROR'`, `'PAGE_EXPORT_ERROR'`, `'ANDROID_TRANSFER_ERROR'`, `'STORAGE_QUOTA_ERROR'`)
    - `title`: prägnanter deutscher Titel
    - `userMessage`: verständliche deutsche Erklärung & Handlungsempfehlung
    - `technicalDetails`: strukturierter Diagnose-Kontext (Zeitstempel, Aktion, Dateiname, Fehlermeldung/Stack, Plattform)
    - `recoverable`: boolean
  - Einheitliches Fehler-Banner in `App.tsx` und Modals mit optionalem **„Diagnose anzeigen / Kopieren"**-Dialog (`ErrorDiagnosticsModal.tsx`), der sowohl Share-Fehler als auch PDF-/Export-Fehler konsistent darstellt.

### Punkt 8: Ausgewählte Seiten direkt als neues PDF exportieren (`src/utils/pdfEngine.ts`, `src/components/PageManagementModal.tsx`, `src/components/SaveModal.tsx`)
- **Soll-Architektur (gemäß Rückfrage in beiden Dialogen verfügbar)**:
  - Neue Engine-Funktion `exportSelectedPagesToPdf(originalPdfBytes, selectedPageNumbers, signatures, textOverlays, formValues, options)` in `src/utils/pdfEngine.ts`:
    - Erzeugt zunächst das eingebettete PDF (inkl. Signaturen, Texten und Formularwerten auf den betreffenden Seiten) und extrahiert anschließend verlustfrei genau die gewünschten Seiten in ein neues `PDFDocument`, ohne das aktuell geöffnete Arbeitsdokument zu verändern.
  - **Im Speichern-Dialog (`SaveModal.tsx`)**: Auswahl zwischen *„Alle Seiten (1–N)"*, *„Aktuelle Seite"* und *„Seitenbereich / Auswahl (z. B. 1, 3–5)"*.
  - **In der Seitenverwaltung (`PageManagementModal.tsx`)**: Button *„Auswahl als PDF exportieren"* in der Mehrfachauswahl-Aktionsleiste, der direkt den Speichern-Dialog mit den markierten Seiten vorselektiert öffnet.

### Punkt 9: Mehrfachauswahl in der Seitenverwaltung (`src/components/PageManagementModal.tsx`, `src/components/PageManagementHeader.tsx`)
- **Ist-Zustand**: Nur eine einzelne `selectedPageId` möglich; Sammelaktionen (außer „Alle drehen") fehlen.
- **Soll-Architektur**:
  - Unterstützung von `selectedPageIds: Set<string>` mit Auswahl-Checkbox auf jeder Seitenkarte sowie `Shift+Klick` für Bereichsauswahl.
  - Neue **Sammelaktions-Leiste** in der Seitenverwaltung:
    - *Alle auswählen* / *Auswahl aufheben* / *Auswahl umkehren*
    - *Ausgewählte links/rechts drehen (±90°)*
    - *Ausgewählte duplizieren*
    - *Ausgewählte löschen* (mit Schutz, dass mindestens 1 Seite im Dokument verbleibt)
    - *Ausgewählte als neues PDF exportieren* (übergibt die markierten Seiten direkt an den Speichern-Dialog).

### Punkt 10: Speicherort auf Android frei wählen (`android/app/src/main/java/com/patrickspdf/app/MainActivity.java`, `src/utils/nativeBridge.ts`, `src/components/SaveModal.tsx`)
- **Ist-Zustand**: Auf Android speichert `finishPdfTransfer(token, "save", name)` immer direkt über `MediaStore.Downloads` in den Standard-Downloads-Ordner.
- **Soll-Architektur (gemäß Rückfrage beide Optionen im Speichern-Dialog)**:
  - Erweiterung von `MainActivity.java` um die Action `"save_as"` in `finishPdfTransfer`:
    - Kopiert die übertragene Temp-Datei in eine geschützte Staging-Datei (`pendingSaveAsFile`) und startet `Intent.ACTION_CREATE_DOCUMENT` (`type = "application/pdf"`, `Intent.EXTRA_TITLE = safeName`) über den Android ActivityResult-Mechanismus.
    - Im `onActivityResult`-Callback wird der Inhalt von `pendingSaveAsFile` per `getContentResolver().openOutputStream(uri)` in den vom Nutzer gewählten Zielordner/Dateinamen gestreamt und per Toast bestätigt.
  - Erweiterung von `savePdfDocument(fileName, pdfData, options?: { pickLocation?: boolean })` in `src/utils/nativeBridge.ts`.
  - Im `SaveModal.tsx` stehen auf Android zwei klar beschriftete Aktionen bereit:
    1. **„In Downloads speichern"** (Schnell-Speichern mit 1 Tipp)
    2. **„Speicherort wählen…"** (öffnet den nativen Android-Ordner-/Dateidialog).

### Punkt 11: Wiederverwendbare Unterschriftenbibliothek (`src/utils/signatureLibrary.ts`, `src/components/SignatureModal.tsx`)
- **Soll-Architektur (gemäß Rückfrage: mehrere Vorlagen mit frei vergebbarer Bezeichnung)**:
  - Neues Modul `src/utils/signatureLibrary.ts` auf Basis einer dedizierten IndexedDB (`PatricksPDFSignaturesDB`, Store `saved_signatures`), damit hochauflösende transparente PNG-Bytes (`Uint8Array` + `transparentDataUrl` + `aspectRatio` + `label` + `createdAt`) ohne `localStorage`-Größenlimit dauerhaft gespeichert werden.
  - Erweiterung von `SignatureModal.tsx`:
    - Neuer Reiter bzw. Bereich **„Gespeicherte Vorlagen"** (mit Badge der gespeicherten Anzahl):
      - Direktes Einfügen einer gespeicherten Unterschrift mit 1 Klick/Tipp,
      - Umbenennen der Bezeichnung (z. B. „Unterschrift Blau", „Paraphe", „Firmenstempel"),
      - Löschen einzelner Vorlagen.
    - Beim Erstellen einer neuen Unterschrift (Foto-Upload oder Fingerzeichnung): Eingabefeld für die Bezeichnung und eine Checkbox/Schaltfläche **„In meiner Unterschriftenbibliothek speichern"**, sodass neue Signaturen direkt als Vorlage gesichert werden können.

### Punkt 12: Exporteinstellungen dauerhaft merken (`src/utils/exportSettings.ts`, `src/components/SaveModal.tsx`)
- **Soll-Architektur (gemäß Rückfrage: Vorlagen mit Datum oder Suffix plus Formular-Flattening)**:
  - Neues Modul `src/utils/exportSettings.ts` mit `localStorage`-Persistenz (`patrickspdf_export_settings_v1`):
    - `namingPreset`: `'signed-suffix'` (`Name-signed.pdf`) | `'date-prefix'` (`YYYY-MM-DD_Name.pdf`) | `'date-suffix'` (`Name_YYYY-MM-DD.pdf`) | `'custom-suffix'` (`Name_<Suffix>.pdf`) | `'original'` (`Name.pdf`)
    - `customSuffix`: string (Standard: `'-bearbeitet'`)
    - `flattenFormByDefault`: boolean (Standard: `false`)
  - Integration in `SaveModal.tsx`:
    - Kompakte Auswahl für das Dateinamens-Schema (inkl. Live-Vorschau des generierten Dateinamens) und das Standardverhalten für Formular-Flattening.
    - Änderungen werden automatisch gespeichert und beim nächsten Öffnen des Speichern-Dialogs wiederhergestellt.

---

## 3. Betroffene und neue Dateien

### Neue Dateien
- `src/utils/appError.ts` – Einheitliches Fehlermodell (`AppError`), Factory-Helfer und Normalisierer.
- `src/components/ErrorDiagnosticsModal.tsx` – Wiederverwendbarer technischer Diagnose-Dialog mit Kopierfunktion.
- `src/utils/signatureLibrary.ts` – IndexedDB-Speicher für wiederverwendbare Unterschriftenvorlagen mit Bezeichnung.
- `src/utils/exportSettings.ts` – Persistente Exporteinstellungen (Namensschema, Suffix, Flattening) + Dateinamens-Generator.

### Zu aktualisierende Dateien
- `index.html` & `src/index.css` – Entfernung externer Google Fonts, Einbindung der lokalen `/Caveat-Regular.ttf` per `@font-face`.
- `src/types.ts` – Typdefinitionen für `SavedSignatureTemplate`, `ExportSettings`, `AppError`, Seitenbereichs-Export.
- `src/hooks/useDocumentHistory.ts` – Kompakte Delta-Operationen, deduplizierte `docRevisionId`-Speicherung und deterministische `isSaved`-Ableitung.
- `src/utils/recentDocuments.ts` – SHA-256 Dokument-Fingerprint sowie IndexedDB v2 mit Trennung in `recent_docs_meta` und `recent_docs_blobs` inkl. automatischer v1→v2 Migration.
- `src/utils/pdfEngine.ts` – Gehärtetes Formular-Embedding und neue Funktion `exportSelectedPagesToPdf`.
- `src/utils/nativeBridge.ts` & `src/utils/androidPdfTransfer.ts` & `android/app/src/main/java/com/patrickspdf/app/MainActivity.java` – Android `ACTION_CREATE_DOCUMENT` (`save_as`) für freie Ordner-/Dateiwahl.
- `src/components/PageManagementModal.tsx` & `src/components/PageManagementHeader.tsx` – Mehrfachauswahl, Sammelaktionen und direkter Teil-Export.
- `src/components/SaveModal.tsx` – Vereinheitlichter Build-/Retry-Pfad, Seitenbereichs-Auswahl, persistente Exporteinstellungen und Android „Speicherort wählen…"-Button.
- `src/components/SignatureModal.tsx` – Integrierte Unterschriftenbibliothek (Speichern, Auswählen, Umbenennen, Löschen).
- `src/App.tsx` & `src/components/RecentDocumentsModal.tsx` & `src/components/EmptyState.tsx` – Anbindung von On-Demand-Blob-Loading, zustandsbasiertem `isSaved`, `AppError`-Diagnose und Direkt-Export aus der Seitenverwaltung.
- `README.md` – Aktualisierung der Architektur- und Funktionsdokumentation auf den neuen Stand.

---

## 4. Verifikations- & Teststrategie

1. **Automatisierte Unit- & Integrationstests (`npm test`)**:
   - Tests für SHA-256 Fingerprint-Generierung und Kollisionsfreiheit bei gleicher Dateigröße.
   - Tests für kompakte History-Operationen (Undo/Redo über Signaturen, Text, Formularwerte, Seitenstruktur) sowie deterministische `isSaved`-Berechnung (inkl. Undo zurück zum Speicherpunkt).
   - Tests für Seitenbereichs-Parser & Teil-Export (`exportSelectedPagesToPdf`) sowie Dateinamens-Vorlagen (`exportSettings`).
2. **TypeScript-, Lint- & Build-Prüfung**:
   - `lint_applet` (`tsc --noEmit`) und `compile_applet` (`npm run build`) ohne Fehler oder Warnungen.
