# PatricksPDF – signierte Android-Releases

Die GitHub Action `.github/workflows/build-apk.yml` baut bei vollständig hinterlegten Signatur-Secrets automatisch eine signierte Release-APK. Solange die vier Secrets fehlen, erzeugt sie weiterhin nur eine Debug-APK.

## 1. Einmalig privaten Keystore erzeugen

Auf einem eigenen vertrauenswürdigen Rechner mit installierter Java-JDK-Umgebung:

```bash
keytool -genkeypair -v -keystore patrickspdf-release.jks -storetype PKCS12 -alias patrickspdf -keyalg RSA -keysize 3072 -validity 10000
```

Das Zertifikat ist zur Android-APK-Signierung gedacht, nicht zur digitalen Signatur von PDF-Dokumenten. Die Keystore-Datei **niemals committen**. Die Originaldatei und alle Passwörter sicher außerhalb GitHub sichern. Der gleiche Schlüssel wird für **alle folgenden App-Updates** benötigt.

## 2. GitHub Actions Secrets einrichten

Repository → Settings → Secrets and variables → Actions → New repository secret.

| Secret | Inhalt |
| --- | --- |
| `ANDROID_RELEASE_KEYSTORE_BASE64` | Vollständige Base64-Kodierung der JKS-Datei, ohne Zeilenumbrüche |
| `ANDROID_RELEASE_STORE_PASSWORD` | Keystore-Passwort |
| `ANDROID_RELEASE_KEY_ALIAS` | `patrickspdf` |
| `ANDROID_RELEASE_KEY_PASSWORD` | Passwort des privaten Schlüssels (bei PKCS12 üblicherweise dasselbe wie das Store-Passwort) |

Keystore in Base64 umwandeln (Linux / Chromebook-Linux-Terminal):
```bash
base64 -w 0 patrickspdf-release.jks
```

Bei Systemen ohne `-w`: `base64 patrickspdf-release.jks | tr -d '\\n'`.

## 3. Build starten

Unter GitHub → Actions → **Build Android APK** → **Run workflow**. Alternativ wird die Action bei einem Push auf `main` ausgeführt.

Bei vollständig vorhandenen Secrets entsteht das Artefakt `PatricksPDF-release-v2.2.<run_number>`. Die Action überprüft die Signatur und die Android-Paketkennung automatisch mit den Android SDK Build Tools.

## 4. Updates und Versionierung

`applicationId = com.patrickspdf.app` bleibt erhalten. `versionCode` wird aus `github.run_number` abgeleitet; `versionName` lautet `2.2.<run_number>` (lokaler Standard-Fallback in `build.gradle` und `package.json`: `2.2.0`). Der Zähler steigt bei weiteren Ausführungen **dieser Workflow-Datei**. Workflow nicht löschen und neu anlegen, ohne das Nummerierungsschema vorher anzupassen.

Release-Versionen lassen sich über eine bestehende Release-Installation aktualisieren, sofern dieselbe `applicationId`, dasselbe Signaturzertifikat und ein höherer `versionCode` verwendet werden.

**Achtung:** Zuvor mit einem anderen Debug-Schlüssel installierte APKs können nicht einfach durch diese Release-APK ersetzt werden. Vor einer eventuellen Deinstallation gespeicherte PDFs exportieren/sichern. Android-Appdaten können beim Deinstallieren verloren gehen.

## 5. Falls ein Build fehlschlägt

* `npm ci` scheitert: `package-lock.json` stimmt nicht mit `package.json` überein; Lockfile konsistent aktualisieren.
* Signatur schlägt fehl: Secrets auf korrekte Werte prüfen; Base64 darf keine zusätzlichen Zeichen enthalten.
* APK vorhanden, aber Update verweigert: vorhandene App-Signatur und `versionCode` prüfen.
* Die Release-APK wird bei unvollständigen Secrets **nicht** erzeugt; der Debug-Build bleibt als Fallback erhalten.

Für die Veröffentlichung über Google Play ist eine gesonderte Entscheidung über Play App Signing und ein Android App Bundle (AAB) erforderlich. Dieser Workflow ist für direkte private APK-Installation gedacht.
