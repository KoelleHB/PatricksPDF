# CI-Wartung und Gradle-Warnungen (18.10.2026)

## Umgesetzt

- GitHub Actions: checkout v7, setup-java v6, setup-node v7 und upload-artifact v7.
- npm: Die drei fehlenden React-/CSS-Typ-Pakete sind mit überprüften Registry-Integritätswerten dauerhaft in `package-lock.json` ergänzt.
- CI verwendet jetzt ausschließlich `npm ci` statt eines vorausgehenden Lockfile-Abgleichs.
- Gradle startet mit `--warning-mode all` (konkrete Gradle-Deprecations).
- Java-Compile verwendet `-Xlint:deprecation` (konkrete API-Callsites).

## Bisher identifizierte Hinweise im erfolgreichen Release-Log 39142600039

1. `flatDir`: In `android/app/build.gradle` ist ein `flatDir`-Repository für lokal verteilte Android/Cordova-JARs konfiguriert. Gradle warnt, weil Flat Directory Repositories keine POM-/Ivy-Metadaten unterstützen. Ob sich diese Anbindung entfernen lässt, muss nach Prüfung der generierten Capacitor-/Cordova-Abhängigkeiten entschieden werden. Sie wird bewusst nicht blind entfernt.
2. Java-API: In `MainActivity.java` wird `Environment.getExternalStoragePublicDirectory(...)` auf dem Fallback für Android vor API 29 benutzt; die Methode ist seit API 29 deprecated. Die Ausführung auf alten Android-Versionen soll beim Ersetzen erhalten bleiben.
3. In `MainActivity.java` wird `Bundle.get(String)` beim Auslesen von `Intent.EXTRA_STREAM` benutzt; diese Methode ist seit API 33 deprecated. Ein typisierter Zugriff benötigt eine API-Level-Fallunterscheidung.
4. Gradle 9: Der vorherige Build berichtete allgemein „Deprecated Gradle features were used“, aber ohne einzelne Ursachen. `--warning-mode all` liefert diese im nächsten Build. Ohne dieses Protokoll lässt sich nicht seriös sagen, welche Einträge aus Projektcode, Android-Gradle-Plugin oder Capacitor-Generator stammen.
5. Node.js/punycode/url.parse: Warnungen entstanden bei alten GitHub Actions runtimes. Der Versionswechsel kann sie beseitigen, ist aber noch nicht durch einen erneuten Workflow-Lauf bestätigt.

## Test-/Mergehinweise

Der nächste automatische Workflow-Lauf auf `main` muss `npm ci`, TypeScript, Web-Build, Gradle und APK-Signaturprüfung erfolgreich abschließen. Bei Problemen zuerst den exakt fehlgeschlagenen Step und die neuen Deprecation-Warnungen auswerten.

Diese Bereinigung ändert nicht die bestehenden Gradle-/Android-Plugin-Versionen oder den APK-Signaturschlüssel. Der bereits offene Feature-PR #1 bleibt unverändert; nach Bestätigung des CI-Builds soll er auf den aktuellen `main`-Stand gebracht werden.
