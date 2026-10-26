# Implementierungsplan: PatricksPDF Version 2.3 (`2.3.0`)

Dieser Plan setzt alle 7 Punkte aus dem technischen Review präzise und vollständig um.

---

## 1. Vollbildmodus erhält manuell gewählten Zoom & Leseanker (`src/components/PdfViewer.tsx`)
- **Problem:** Bisher existierte nur das Flag `isFitWidthMode`. Beim Umschalten des Vollbildmodus wurde `if (!isFitWidthMode) handleFitPage()` aufgerufen, wodurch ein manuell gewählter Zoom (z. B. `250 %`) auf „Ganze Seite“ zurückgesetzt wurde.
- **Lösung:**
  - Einführung eines expliziten Flags `isFitPageMode` (initial `true` beim Öffnen eines Dokuments) zusätzlich zu `isFitWidthMode`.
  - Jede manuelle Zoom-Aktion (`handleZoomIn`, `handleZoomOut`, `handleResetZoom`, `handleSelectZoomPreset`, Pinch-Zoom / Touch-Gesture / Strg+Mausrad sowie Doppelklick auf `250 %`) setzt sowohl `isFitWidthMode = false` als auch `isFitPageMode = false`.
  - `handleFitPage()` setzt `isFitPageMode = true` und `isFitWidthMode = false`.
  - `handleFitWidth()` setzt `isFitWidthMode = true` und `isFitPageMode = false`.
  - Beim Vollbildwechsel sowie bei `window.resize` wird vor der Layoutänderung der aktuelle Leseanker (`captureZoomAnchor(centerX, centerY)`) gesichert:
    - Ist `isFitPageMode` aktiv, wird der Fit-Page-Zoom für die neue Viewport-Größe neu berechnet.
    - Ist `isFitWidthMode` aktiv, wird der Fit-Width-Zoom neu berechnet.
    - Ist ein **manueller Zoom** aktiv (`!isFitPageMode && !isFitWidthMode`), bleibt `zoomLevel` exakt unverändert und die Leseposition wird über `pendingZoomAnchorRef` sauber wiederhergestellt.

---

## 2. Bestätigter Erfolgsstatus beim Vollbildwechsel (`src/utils/nativeBridge.ts`, `MainActivity.java`, `src/components/PdfViewer.tsx`)
- **Problem:** `setSystemFullscreen()` gab keinen Erfolgsstatus zurück (`Promise<void>`), und `PdfViewer` setzte `isMobileFullscreen` blindlings auf `true`, selbst wenn Browser oder iFrame den Vollbildmodus ablehnten.
- **Lösung:**
  - `setSystemFullscreen(enabled: boolean): Promise<boolean>` gibt einen verifizierten `boolean`-Status zurück:
    - **Android APK (`isNativeAndroid()`):** Ruft `window.NativePdfBridge.setImmersiveFullscreen(enabled)` auf und gibt `true` zurück, wenn die native Bridge den Aufruf bestätigt (`=== true`).
    - **Web / PWA:** Führt `document.documentElement.requestFullscreen()` bzw. `document.exitFullscreen()` aus und prüft danach deterministisch `Boolean(document.fullscreenElement) === enabled`.
    - **Nicht unterstützt / iFrame ohne Fullscreen-Freigabe:** Gibt `false` zurück, wenn `document.fullscreenEnabled` nicht gegeben ist oder der Request abgewiesen wird.
  - In `PdfViewer.tsx`:
    - `handleToggleMobileFullscreen` wartet auf `const ok = await setSystemFullscreen(next)`.
    - Nur wenn `ok === true` (oder beim Verlassen des Vollbildmodus), wird `setIsMobileFullscreen(next)` übernommen; schlägt das Aktivieren fehl, bleibt `isMobileFullscreen` auf `false` (die App-Leisten verschwinden nicht fälschlicherweise ohne echten Vollbildmodus).

---

## 3. Bereinigung des deaktivierten immersiven Navigations-Hooks (`src/components/PdfViewer.tsx`, `src/App.tsx`, `src/hooks/useImmersiveNavigation.ts`)
- **Problem:** `useImmersiveNavigation` wurde mit konstantem `isPinned = true` aufgerufen, und `isToolActive` wurde aus `App.tsx` übergeben, aber nicht mehr genutzt.
- **Lösung:**
  - Vollständige Entfernung des nicht mehr benötigten Hooks `src/hooks/useImmersiveNavigation.ts` sowie der ungenutzten Prop `isToolActive` aus `App.tsx` und `PdfViewerProps`.
  - Direkte, klare Steuerung der Leisten-Sichtbarkeit über `const isControlsVisible = !isMobileFullscreen;` ohne toten oder irreführenden Zwischencode.

---

## 4. Aktuelle Dateigröße in der mobilen Kopfzeile (`src/components/mobile/MobileReaderTopBar.tsx`)
- **Problem:** `const sizeBytes = pdfState.file?.size ?? pdfState.arrayBuffer?.byteLength ?? 0;` bevorzugte die ursprüngliche `File.size`, auch nachdem Seiten gelöscht, gedreht oder hinzugefügt wurden.
- **Lösung:**
  - Umstellung auf `const sizeBytes = pdfState.arrayBuffer?.byteLength ?? pdfState.file?.size ?? 0;`, sodass stets die tatsächliche Größe des aktuellen Dokument-Buffers im Speicher angezeigt wird.

---

## 5. Vollständige Build- & APK-Versionsanzeige in „Info / Diagnose“ (`MainActivity.java`, `src/utils/nativeBridge.ts`, `src/utils/appError.ts`, `src/components/ErrorDiagnosticsModal.tsx`, `src/App.tsx`)
- **Problem:** Der Header zeigt `v2.3`, aber die konkrete APK-Build-Version (z. B. `2.3.<run_number> (Code <run_number>)`) fehlte in der UI, und das Diagnose-Modal war nur bei einem aktiven Fehler erreichbar.
- **Lösung:**
  - `MainActivity.java`: Neue `@JavascriptInterface`-Methode `getAppBuildInfo()`, die aus `PackageInfo` den exakten `versionName` und `longVersionCode` liefert (z. B. `2.3.42 (Build 42)`).
  - `nativeBridge.ts`: Hilfsfunktion `getRuntimeVersionInfo()`, die auf Android die native APK-Version und im Web/PWA `2.3.0 (Web / PWA)` zurückgibt.
  - `ErrorDiagnosticsModal.tsx` & `App.tsx`:
    - Das Modal ist jederzeit über das Drei-Punkte-Menü (**„Info & Diagnose“**) sowie per Klick auf den Versions-Badge `v2.3` im Desktop-Header aufrufbar – auch wenn kein Fehler vorliegt.
    - Zeigt im Kopfbereich und im kopierbaren Diagnosebericht prominent die vollständige App-/APK-Build-Version, Plattform und den aktuellen Dokumentstatus an.

---

## 6. Behebung des fehlenden `xs:`-Breakpoints & Barrierefreiheit (`src/index.css`, `src/components/mobile/MobilePageGridBottomSheet.tsx`, `src/components/PageManagementHeader.tsx`, `src/components/HandwrittenSignaturePad.tsx`)
- **Problem:** `hidden xs:inline` wurde verwendet, obwohl kein `xs`-Breakpoint in Tailwind CSS v4 definiert war, wodurch Labels wie „Verwalten“ dauerhaft ausgeblendet blieben und ein `aria-label` am Button fehlte.
- **Lösung:**
  - Definition von `--breakpoint-xs: 22.5rem;` (360px) in `src/index.css` via `@theme`.
  - In `MobilePageGridBottomSheet.tsx`: Button „Verwalten“ erhält ein explizites `aria-label="Seiten verwalten"`, `title="Seiten verwalten"` und das Text-Label wird direkt sichtbar (`<span>Verwalten</span>`) gerendert.
  - Prüfung und Bereinigung aller weiteren Stellen (`PageManagementHeader.tsx`, `HandwrittenSignaturePad.tsx`).

---

## 7. Komplettes Release-Upgrade auf Version 2.3 (`2.3.0`) & Tests
- **Versionssynchronisation auf `2.3.0` / `v2.3`:**
  - `package.json` & `package-lock.json` (`2.3.0`)
  - `src/components/Header.tsx` (`v2.3`)
  - `src/utils/appError.ts` (`APP_VERSION = '2.3.0'`)
  - `android/app/build.gradle` (`2.3.0`)
  - `.github/workflows/build-apk.yml` (`2.3.${{ github.run_number }}`, Artefakte `PatricksPDF-release-v2.3.<run_number>` und `PatricksPDF-debug-v2.3.<run_number>`)
- **Dokumentation & Tests:**
  - Aktualisierung von `README.md`, `CHANGELOG.md`, `MILESTONES.md`, `docs/ARCHITECTURE.md`, `CI_MAINTENANCE.md` und `ANDROID_RELEASE_SIGNING.md` auf Version 2.3.
  - Erweiterung von `test/architectureAndFeatures.test.ts` um Tests für alle 7 Punkte und vollständige Ausführung von `npm run lint`, `npm test` und `compile_applet`.
