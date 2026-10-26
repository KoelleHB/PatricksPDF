# CI-Wartung und Gradle-Warnungen (Stand: Version 2.1 – 26.10.2026)

## Umgesetzt

- **Version 2.1 (`2.1.0`)**: `package.json`, `package-lock.json` und der lokale Fallback in `android/app/build.gradle` sind auf `2.1.0` vereinheitlicht; der CI-Workflow `.github/workflows/build-apk.yml` vergibt `PATRICKSPDF_VERSION_NAME: 2.1.${{ github.run_number }}` und erzeugt die Artefakte `PatricksPDF-release-v2.1.<run_number>` bzw. `PatricksPDF-debug-v2.1.<run_number>`.
- **Sicherheits- & Integritäts-Gate**: `enableScripting: false` und `isEvalSupported: false` werden in automatisierten Unit-Tests verifiziert.
- **Erweiterte Test-Gate-Prüfung im CI**: Vor dem Web- und Android-Build führt `.github/workflows/build-apk.yml` `npm run lint`, alle Test-Suiten via `npm test` (inkl. Prüfung auf Versionskonsistenz, Mobile-UI-Architektur, physische Bereinigung entfernter Seiten beim Teil-Export und Viewport-Platzierung) sowie den Headless-Chrome-Browser-Smoke-Test mit verschlüsselter PDF aus.
- **Bereinigung von Repository-Altlasten**: Entfernen des fremden `bun.lock` (ausschließliche Nutzung von `package-lock.json` mit `npm ci`), der doppelten Legacy-CMaps unter `/public/cmaps/` sowie veralteter Zwischennotizen.
- GitHub Actions: checkout v7, setup-java v6, setup-node v7 und upload-artifact v7.
- npm: Die drei fehlenden React-/CSS-Typ-Pakete sind mit überprüften Registry-Integritätswerten dauerhaft in `package-lock.json` ergänzt.
- CI verwendet ausschließlich `npm ci`.
- Gradle startet mit `--warning-mode all` (konkrete Gradle-Deprecations).
- Java-Compile verwendet `-Xlint:deprecation` (konkrete API-Callsites).

## Bekannte Hinweise im Android-/Gradle-Build

1. `flatDir`: In `android/app/build.gradle` ist ein `flatDir`-Repository für lokal verteilte Android/Cordova-JARs konfiguriert. Gradle warnt, weil Flat Directory Repositories keine POM-/Ivy-Metadaten unterstützen. Diese Capacitor-Standardkonfiguration wird bewusst beibehalten.
2. Java-API: In `MainActivity.java` wird `Environment.getExternalStoragePublicDirectory(...)` ausschließlich als Fallback für Android vor API 29 (`Build.VERSION.SDK_INT < Build.VERSION_CODES.Q`) benutzt; ab API 29 kommt `MediaStore.Downloads` bzw. `Intent.ACTION_CREATE_DOCUMENT` zum Einsatz.
3. In `MainActivity.java` wird beim Auslesen von `Intent.EXTRA_STREAM` für ältere Android-Versionen unterhalb von API 33 ein abgesichertes `@SuppressWarnings("deprecation")` genutzt, während ab API 33 `Intent.getParcelableExtra(String, Class)` verwendet wird.

## Test-/Mergehinweise

Jeder Workflow-Lauf auf `main` schließt `npm ci`, TypeScript (`npm run lint`), `npm test`, den Browser-Smoke-Test, den Vite-PWA-Build, `npx cap sync android`, Gradle und die APK-Signaturprüfung ab.

