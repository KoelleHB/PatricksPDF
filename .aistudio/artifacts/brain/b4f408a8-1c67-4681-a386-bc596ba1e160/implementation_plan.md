# Implementierungsplan: Menü-Anpassung, Undo/Redo & Performance-Optimierung

## 1. Drei-Punkte-Menü Aktualisierung (`MobileReaderTopBar.tsx`)
- **Entfernen:** Der Menüeintrag „Seiten organisieren“ wird aus dem Overflow-Menü entfernt.
- **Hinzufügen:**
  - **Datei öffnen:** Ermöglicht das direkte Auswählen und Öffnen einer neuen PDF-Datei (unter Berücksichtigung von ungespeicherten Änderungen).
  - **Verlauf zeigen:** Öffnet die Liste der zuletzt geöffneten Dokumente (`RecentDocumentsModal`).
- Icons: `FolderOpen` für „Datei öffnen“ und `History` / `Clock` für „Verlauf zeigen“.

## 2. Undo & Redo in der mobilen Top-Bar
- Platzierung: Direkt neben dem Such-Icon in der oberen Leiste für bequemen Einhand-Zugriff.
- Verhalten:
  - `Undo2`- und `Redo2`-Icons mit optischem Feedback (deaktiviert bei `!canUndo` bzw. `!canRedo`).
  - Direkte Ausführung der History-Schritte inklusive automatischer Navigation zur betroffenen Seite.
  - Weiterleitung der Props `canUndo`, `canRedo`, `onUndo`, `onRedo` von `App.tsx` über `PdfViewer` an `MobileReaderTopBar`.

## 3. Performance-Optimierung der Seitenübersicht (`MobilePageGridBottomSheet.tsx`)
- **Ursache der Verzögerung:** Bisher wurden beim Öffnen des Bottom-Sheets sämtliche Seiten gleichzeitig und ungepuffert per Canvas gerendert. Bei Dokumenten mit 20–100 Seiten blockierten dutzende parallele PDF.js-Worker den JavaScript-Event-Loop.
- **Lösung:**
  - Umstellung auf echtes **Lazy Loading mit `IntersectionObserver`** (Pre-Fetching mit `rootMargin: '200px'`).
  - Nur die im Smartphone-Viewport sichtbaren Seitenkacheln (ca. 6–9 Stück) fordern ein Thumbnail an.
  - Sofortige Freigabe von Ressourcen beim Verlassen des sichtbaren Bereichs.
  - Sofortige Öffnungszeit des Bottom-Sheets ohne Ruckler oder Wartezeiten.

## 4. Beschleunigung beim Öffnen größerer PDF-Dateien
- **Ursache:** Beim Laden wurden schwere Zusatzoperationen (AcroForm-Feldextraktion, Generierung des hochauflösenden Verlaufs-Thumbnails und CMaps-Verarbeitung) synchron im Haupt-Thread gebündelt.
- **Lösung:**
  - Die Erstellung des Verlaufs-Thumbnails wird in den Hintergrund verschoben (`requestIdleCallback` bzw. `setTimeout`), sodass die erste Seite für den Nutzer augenblicklich gerendert wird.
  - Optimierung des CMaps- und Font-Preloads, um unnötige Ladeblockaden zu vermeiden.

## 5. Verifikation
- Überprüfung mit `lint_applet` (Typensicherheit) und `compile_applet`.
- Funktions- und Performance-Check im mobilen Viewport (< 768px).
