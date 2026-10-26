# Implementierungsplan: Fixes Mobile-Layout, Fullscreen-Modus & beruhigte Bottom-Bar

## 1. Problemstellung & Analyse
- **Überdeckung beim Öffnen:** Aktuell sind `MobileReaderTopBar` und `MobileBottomBar` als `fixed` Overlays über dem Dokumenten-Container positioniert. Beim Öffnen einer PDF verdeckt die obere Titelleiste daher den oberen Rand der ersten Seite (wie im Screenshot ersichtlich).
- **Auto-Hide vs. Fixes Layout:** Das automatische Ein-/Ausblenden beim Scrollen führt zu Unruhe. Stattdessen sollen obere Leiste, untere Leiste und die Seitenblätter-Pille grundsätzlich **fix stehen** und das Dokumenten-Viewport exakt den Raum dazwischen einnehmen, sodass weder oben noch unten Inhalte überdeckt oder abgeschnitten werden.
- **Echter Fullscreen-Modus:** In der schwebenden Seitenblätter-Pille (`MobileFloatingPill`) wird ein Umschalter für einen echten Fullscreen-Modus integriert (`Maximize2` / `Minimize2`), der Top- und Bottom-Bar ausblendet und den gesamten Bildschirm für das Dokument freigibt.
- **Beruhigung der Farben in der Bottom-Bar:** Die bisherige Kombination aus dunklem Speichern-Button und knallblauem Signieren-Button wird durch ein einheitliches, ruhiges, helles Design (`bg-slate-50 / hover:bg-slate-100 / border border-slate-200`) mit harmonischen Icons für alle 4 Aktionen ersetzt.

---

## 2. Detaillierte Änderungen

### A. Fixes, überdeckungsfreies Layout in `src/components/PdfViewer.tsx` & `src/App.tsx`
1. **Flex-Layout ohne Überdeckung:**
   - Auf mobilen Geräten (`isMobile`) wird `MobileReaderTopBar` nicht als schwebendes Overlay, sondern als nativer oberer Block im Flex-Container gerendert (oder mit festem Header-Platz).
   - Der Scroll-Container `containerRef` (`data-pdf-scroll-container`) füllt den Raum zwischen oberer und unterer Leiste (`flex-1 min-h-0`) sauber aus.
   - Dadurch startet Seite 1 beim Öffnen exakt unterhalb der oberen Titelleiste. `calculateFitPageZoom` berechnet den Zoom basierend auf der tatsächlichen sichtbaren Containerhöhe. Kein Dokumentinhalt wird mehr verdeckt.
2. **Fullscreen-State (`isFullscreen`):**
   - Zustandsverwaltung `isMobileFullscreen` in `PdfViewer.tsx` (bzw. durchgereicht aus `App.tsx`).
   - Im Fullscreen-Modus werden Top-Bar und Bottom-Bar ausgeblendet, der Dokument-Container nutzt 100% der Höhe.
   - Anbindung an die Browser-Fullscreen-API (`requestFullscreen` / `exitFullscreen`), wo verfügbar.

### B. Fullscreen-Button in `src/components/mobile/MobileFloatingPill.tsx`
1. **Neuer Button in der Pille:**
   - Ergänzung eines Buttons mit `Maximize2` (im Normalmodus) bzw. `Minimize2` (im Fullscreen-Modus).
   - Bleibt auch im Fullscreen-Modus dezent verfügbar, sodass der Vollbildmodus jederzeit mit einem Klick beendet werden kann.
2. **Feste Platzierung:**
   - Bleibt fixiert über der unteren Leiste positioniert (`bottom-20` im Normalmodus, `bottom-6` im Fullscreen-Modus), ohne störendes Ein-/Ausblenden.

### C. Beruhigtes, einheitlich helles Design in `src/components/mobile/MobileBottomBar.tsx`
1. **Einheitliche Button-Hierarchie:**
   - Alle 4 Buttons (Seiten, Text, Signieren, Speichern) erhalten dasselbe ruhige, helle Farbschema:
     - Hintergrund: `bg-slate-50 hover:bg-slate-100 active:bg-slate-200/70`
     - Rahmen: `border border-slate-200/80`
     - Typografie: `text-slate-700 font-medium text-[11px]`
   - Dezent akzentuierte Icons (z. B. feines Blau für Signatur-Icon, feines Smaragd für Download/Speichern-Icon), statt vollflächiger knalliger Hintergrundfarben.
2. **Sichtbarkeit:**
   - Fix eingeblendet im Normalmodus; nur ausgeblendet im aktiven Fullscreen-Modus.

---

## 3. Verifikation & Tests
1. **Test-Suite:**
   - Aktualisierung von `test/architectureAndFeatures.test.ts` für die neuen Fullscreen-Eigenschaften der Floating-Pill und das ruhige Styling der Mobile-Bottom-Bar.
   - Ausführung aller 44 Unit- und Integrationstests via `npm test`.
2. **Build- und Lint-Prüfung:**
   - `lint_applet` (`tsc --noEmit`) und `compile_applet` (Vite Production Build) fehlerfrei validieren.
3. **Dokumentation:**
   - Dokumentation in `CHANGELOG.md` und `README.md`.
