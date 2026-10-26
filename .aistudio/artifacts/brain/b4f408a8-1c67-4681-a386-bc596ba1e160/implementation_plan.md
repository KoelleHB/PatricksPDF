# Implementierungsplan: iFrame-Schutz, transparentere Seitenblätter-Pille & nativer Android-Vollbildmodus

## 1. Analyse der drei Punkte

1. **Absturz in der AI-Studio-Vorschau beim Einschalten des Vollbildmodus:**
   - **Ursache 1 (iFrame-Kontext):** In der AI-Studio-Vorschau läuft die App in einem eingebetteten Cross-Origin-`<iframe>` (`window.self !== window.top`). Ein direkter Aufruf von `document.documentElement.requestFullscreen()` innerhalb des Preview-iFrames führt zu Konflikten mit dem Host-Frame bzw. wird vom Sandbox-Container hart abgebrochen.
   - **Ursache 2 (React State-Updater Side-Effect):** `onControlsVisibilityChange?.(!next)` wurde direkt innerhalb der Updater-Funktion `setIsMobileFullscreen(prev => ...)` aufgerufen, was in React zu einem unzulässigen State-Update einer Elternkomponente (`App`) während des Render-Zyklus von `PdfViewer` führt.
   - **Lösung:**
     - Strikte Trennung von State-Update und Seiteneffekten (`useEffect` für `onControlsVisibilityChange`).
     - Sichere Hilfsfunktion `setAppFullscreen(enabled: boolean)` in `src/utils/nativeBridge.ts`: Prüft auf `window.self !== window.top`. Im iFrame-Preview wird ausschließlich das App-interne Vollbild-Layout (Ausblenden von Top- und Bottom-Bar) umgeschaltet, ohne die Browser-Fullscreen-API anzufordern.

2. **Leicht transparentere Seitenblätter-Pille (`MobileFloatingPill.tsx`):**
   - Reduzierung der Deckkraft des Pill-Hintergrunds von `bg-white/92` auf ein luftigeres, durchscheinendes `bg-white/75 backdrop-blur-md border-slate-200/50 shadow-md`.
   - Anpassung des Zoom-Prozent-Buttons innerhalb der Pille auf `bg-slate-200/55 hover:bg-slate-200/80`, damit der Dokumentenhintergrund dezent durchscheint, während Zahlen und Icons gestochen scharf lesbar bleiben.

3. **Systemweiter Vollbildmodus in der Android-APK (`MainActivity.java` & `nativeBridge.ts`):**
   - **Ursache:** In einer Android-WebView blendet die Web-Fullscreen-API nicht die Android-Systemleisten (Status Bar oben & Navigation Bar unten) aus.
   - **Lösung in `MainActivity.java`:**
     - Erweiterung von `NativePdfBridgeInterface` um `@JavascriptInterface public boolean setImmersiveFullscreen(final boolean enabled)`.
     - Implementierung von `applyImmersiveFullscreen(boolean enabled)` auf dem UI-Thread mittels moderner AndroidX-APIs (`WindowCompat.setDecorFitsSystemWindows`, `WindowInsetsControllerCompat.hide(WindowInsetsCompat.Type.systemBars())` und `BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE` sowie Display-Cutout-Unterstützung `LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES`).
     - Beim Beenden des Vollbildmodus (oder Schließen des Dokuments) werden Status- und Navigationsleiste über `controller.show(WindowInsetsCompat.Type.systemBars())` und `WindowCompat.setDecorFitsSystemWindows(window, true)` sauber wiederhergestellt.

---

## 2. Geplante Dateiänderungen

- **`android/app/src/main/java/com/patrickspdf/app/MainActivity.java`**
  - Hinzufügen von `setImmersiveFullscreen(boolean enabled)` in `NativePdfBridgeInterface`.
  - Implementieren von `applyImmersiveFullscreen(boolean enabled)` mit `WindowCompat` und `WindowInsetsControllerCompat` (komplett frei von Deprecated-APIs).
- **`src/types.ts`**
  - Ergänzen von `setImmersiveFullscreen?: (enabled: boolean) => boolean;` im `NativePdfBridge`-Interface.
- **`src/utils/nativeBridge.ts`**
  - Neue Funktion `setSystemFullscreen(enabled: boolean): Promise<void>`:
    - Nutzt auf Android (`isNativeAndroid()`) direkt `window.NativePdfBridge.setImmersiveFullscreen(enabled)`.
    - Ignoriert in iFrames (`window.self !== window.top`) den Browser-Fullscreen-Call sicher (verhindert AI-Studio-Preview-Absturz).
    - Nutzt in regulären Standalone-Browsern/PWAs `document.documentElement.requestFullscreen()` / `document.exitFullscreen()` mit vollständiger Fehlerkapselung.
- **`src/components/PdfViewer.tsx`**
  - Saubere Entkopplung von `handleToggleMobileFullscreen` ohne Side-Effects im State-Updater.
  - Automatische Rückstellung des systemweiten Vollbildmodus beim Unmounten / Schließen des Dokuments.
- **`src/components/mobile/MobileFloatingPill.tsx`**
  - Transparenteres Glassmorphism-Styling (`bg-white/75 backdrop-blur-md border-slate-200/50`).
- **`test/architectureAndFeatures.test.ts` & Dokumentation (`CHANGELOG.md`)**
  - Tests für `setImmersiveFullscreen`, iFrame-Guard und Pill-Transparenz ergänzen.
