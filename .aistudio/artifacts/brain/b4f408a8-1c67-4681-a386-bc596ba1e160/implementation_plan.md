# Umsetzungsplan: Einheitlich englische Benutzeroberfläche (PatricksPDF v2.3)

## Zielsetzung
Die gesamte Benutzeroberfläche von **PatricksPDF** wird durchgängig und konsistent auf **Englisch** vereinheitlicht, sodass sämtliche deutschsprachigen Beschriftungen, Menüpunkte, Tooltips (`title`), Barrierefreiheits-Attribute (`aria-label`), Statusmeldungen und Fehlerdiagnosen entfernt bzw. sauber übersetzt werden.

## Geplante Änderungen nach Bereichen

### 1. Hauptnavigation, Startbildschirm & Mobile Leisten
- **Desktop-Header (`src/components/Header.tsx`)**:
  - Buttons und Tooltips vereinheitlichen: *History* (statt „Verlauf“), *Print* (statt „Drucken“), *Share* (statt „Teilen“) sowie englische `title`- und `aria-label`-Attribute (*Show App Info & Build Version*, *Recently opened documents*, etc.).
- **Startbildschirm (`src/components/EmptyState.tsx`)**:
  - Upload-Bereich (*Select or drop a PDF document*, *Tap here to open a file from your phone or computer*, *Select PDF*), Verlaufskarte (*Recently Opened*, *View all*, *page/pages*, *Open*, *Print*, *Share*) und die drei Funktions-Kacheln (*Transparent Signature*, *Touch & Placement*, *Android Print & Share*) komplett auf Englisch umstellen.
- **Mobile Kopf- & Fußleiste sowie Seitenblätter-Pille (`src/components/mobile/MobileReaderTopBar.tsx`, `MobileBottomBar.tsx`, `MobileFloatingPill.tsx`)**:
  - Statusanzeige: *Saved* / *Modified* (statt „Gespeichert“ / „Geändert“).
  - 3-Punkte-Menü: *Open File*, *Recent Documents*, *Page Overview*, *Table of Contents*, *Text Reflow (Reader)*, *Print*, *Share*, *Info & Diagnostics*.
  - Untere Werkzeugleiste: *Pages*, *Text*, *Sign*, *Save* inklusive englischer `title`- und `aria-label`-Texte.
  - Seitenblätter-Pille: Englische Tooltips und Screenreader-Labels für Seitenwechsel, Seitenübersicht, Zoom-Reset (*Tap to reset zoom to Fit Page*) und Vollbildmodus (*Enter fullscreen* / *Exit fullscreen*).

### 2. Seitenübersicht & Seitenverwaltung
- **Mobile Seitenübersicht (`src/components/mobile/MobilePageGridBottomSheet.tsx`)**:
  - Header, Seitenzähler (*page/pages*), *To Top*-Button (statt „An den Anfang“), *Manage*-Button (statt „Verwalten“) und Kachel-Labels (*Page X*) auf Englisch umstellen.
- **Seitenverwaltung (`src/components/PageManagementHeader.tsx`, `PageManagementModal.tsx`, `LazyPageThumbnail.tsx`)**:
  - Header-Aktionen: *Page Management*, *Unsaved Changes*, *To Top*, *Rotate All*, *Blank Page*, *Import*.
  - Mehrfachauswahl-Leiste & Aktionen: *Select All*, *Deselect All*, *Invert*, *X of Y selected*, *Duplicate*, *Delete*, *Export Selection as PDF* sowie alle Hinweis- und Fehlermeldungen.

### 3. PDF-Viewer, Volltextsuche & Textauswahl
- **Viewer & Seitenansicht (`src/components/PdfViewer.tsx`, `PdfPageView.tsx`)**:
  - Such-Button in der Desktop-Toolbar (*Search*, *Search entire PDF (Ctrl+F)*) und Link-Fehlermeldungen auf Englisch vereinheitlichen.
- **Volltextsuche (`src/components/PdfSearchPanel.tsx`)**:
  - Eingabefeld (*Search in PDF…*), Trefferanzeige (*match / matches*), Fortschrittsanzeige, mobile Ergebnisliste (*Show matches* / *Hide list*) und Hinweistexte auf Englisch umstellen.
- **Textauswahl-Leiste (`src/components/TextSelectionToolbar.tsx`)**:
  - Zeichen-/Wortzähler (*char/chars*, *word/words*) und Kopier-Button (*Copy* / *Copied!*) übersetzen.

### 4. Dialoge (Speichern, Signatur, Verlauf, Diagnose & Fehlermeldungen)
- **Speichern & Export (`src/components/SaveModal.tsx`, `src/utils/exportSettings.ts`)**:
  - Seitenauswahl (*All*, *Current*, *Page Range*), Formular-Abflachung (*Flatten Form Fields*), Dateinamen-Vorlagen (*Original Name*, *Custom Suffix*), Buttons (*Save to Downloads*, *Choose Save Location…*, *Share*, *Print*, *Preview in new tab*) sowie Validierungsmeldungen in `parsePageRangeInput` auf Englisch umstellen.
- **Signatur-Modal (`src/components/SignatureModal.tsx`)**:
  - Reiter *Template Library*, Schnellauswahl (*Saved Signatures (Tap to insert)*, *Manage all*), Vorlagenverwaltung (*Save to Library*, *Save Only*, *Draw Now*, *Choose Image*) auf Englisch vereinheitlichen.
- **Verlauf (`src/components/RecentDocumentsModal.tsx`, `src/utils/recentDocuments.ts`)**:
  - Dialogtexte (*Recent Documents*, *No recent documents yet*, *Active*, *Clear History*) sowie relative Zeitangaben (*Just now*, *X min ago*, *Today*, *Yesterday*, *X days ago*) auf Englisch umstellen.
- **Fehlerdiagnose & Native Bridge (`src/components/ErrorDiagnosticsModal.tsx`, `ErrorBoundary.tsx`, `src/utils/appError.ts`, `src/utils/nativeBridge.ts`, `src/App.tsx`)**:
  - Diagnose-Modal (*PatricksPDF Info & Diagnostics*, *App Info & Build Version*, *No active runtime errors logged*, *Copy diagnostic report*) sowie sämtliche System-, Datei-, Druck- und Teilen-Meldungen auf Englisch vereinheitlichen.

### 5. Qualitätssicherung & Tests
- Anpassung der Text-Assertions in `test/architectureAndFeatures.test.ts` an die englischen UI-Strings.
- Ausführung von `lint_applet`, `npm test`, `compile_applet` und `npx cap sync android`.
