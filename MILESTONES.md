# PatricksPDF – Meilensteine & Architektur-Historie

Dieses Dokument dient als dauerhafte Referenz für wesentliche Projekt-Meilensteine, deren Kernfeatures und Wiederherstellungspunkte.

---

## 🏆 Meilenstein 1: Vollständige Offline-Engine, Loopback-Binärtransfer & High-Precision Zoom

- **Datum**: 18. Oktober 2026
- **Branch**: `feature/native-binary-resource-refactor` (Basis für `main`)
- **Empfohlener Git-Tag**: `v1.0.0-gold-offline-binary-refactor` (oder `v1.0.0-milestone`)

### Warum dieser Stand so wichtig ist:
Dieser Meilenstein vereint alle Kernoptimierungen, die PatricksPDF von einem Prototyp zu einer robusten, autarken Produktiv-Anwendung (PWA & native Android APK) gemacht haben.

### Zusammenfassung der Kernarchitektur:

1. **Vollständige Offline-Autarkie (Zero-CDN)**:
   - PDF.js Web-Worker, Standard-14-Fonts und CMap-Dateien werden bei jedem Build lokal aus `node_modules` nach `/public/pdfjs/` kopiert.
   - PWA-Caching speichert alle Binär-Assets (`bcmap`, `pfb`, `ttf`). Die App funktioniert ohne Internetverbindung im Flugmodus uneingeschränkt.

2. **Loopback-Binärtransfer für Android (`MainActivity.java` & `androidPdfTransfer.ts`)**:
   - PDF-Dateien bis zu 512 MB werden beim Speichern, Teilen und Drucken direkt als Binär-Blob über einen lokalen `127.0.0.1`-Loopback-Server gestreamt.
   - Beseitigt Base64-String-Kopien im Heap und verhindert `OutOfMemoryError`-Abstürze bei großen PDFs. Robuster Fallback auf Chunked-Transfer.

3. **High-Performance Zoom-Engine (35 % bis 500 %)**:
   - Dynamisches High-DPI Canvas Rendering (skaliert bis Faktor 4.0 für gestochen scharfe Vektorschriften bei extremer Vergrößerung).
   - Schnellwahl-Menü für Zoomstufen (`50%`, `75%`, `100%`, `150%`, `200%`, `300%`, `400%`, `500%`, `Fit Width`, `Fit Page`).
   - Mathematisch zentriertes Pinch-to-Zoom am Finger-Mittelpunkt und Smart Double-Tap / Double-Click zum Umschalten zwischen 250 % und Seitenbreite.

4. **Präzise Textmarkierung & Android-Auswahlgriffe**:
   - Korrektur der PDF.js `--scale-factor`-Berechnung für Subpixel-Genauigkeit zwischen Cursor und Vektorglyphen auf dem Desktop.
   - Entfernung von übergeordnetem `select-none` in Android WebViews: Langes Drücken auf Text blendet nativ die Android-Auswahlgriffe und das Lupen-Kontextmenü ein.
   - Schwebende Kopierleiste mit Zeichen- und Wortzählung sowie Bestätigung.

5. **Strukturierte Undo/Redo-Seitenverwaltung**:
   - `PageDocumentSnapshot` sichert den gesamten PDF-ArrayBuffer, sodass Seitendrehungen, Löschungen und Umsortierungen voll rückgängig gemacht werden können.
   - Beim Duplizieren von Seiten werden Signaturen und Text-Overlays geklont und erhalten neue, eindeutige IDs.
   - Progressives Rendering der Seiten-Vorschau (LRU-Cache bis max. 64 Thumbnails).

6. **Speicher-Lebenszyklus (`pdfDocumentLifecycle.ts`)**:
   - Saubere Freigabe von PDF.js-Dokumentinstanzen und Worker-Tasks (`disposePdfJsResources()`) beim Schließen oder Wechseln von Dokumenten.

7. **Sichere CI/CD-Pipeline (`.github/workflows/build-apk.yml`)**:
   - Deterministisches `npm ci`, Typprüfung (`npm run lint`), monomolekulare Versionsnummerierung über `github.run_number`.
   - Signierte Release-APKs über GitHub Secrets mit Keystore-Löschung nach dem Build und Signatur-Verifikation via `apksigner`.

---

## 📌 Wie finde ich diesen Stand in Git / GitHub wieder?

### Option A: Einen Git-Tag setzen (Empfohlen)
Im lokalen Terminal des GitHub-Klons:

```bash
# 1. Tag auf den aktuellen Commit setzen
git tag -a v1.0.0-gold-offline-binary-refactor -m "Meilenstein: Offline-Engine, Binärtransfer, 500% Zoom, High-Precision Text"

# 2. Tag zu GitHub hochladen
git push origin v1.0.0-gold-offline-binary-refactor
```

### Option B: Über GitHub Releases anlegen
1. Auf GitHub das Repository öffnen.
2. Rechts auf **Releases** → **Draft a new release** klicken.
3. Als Tag z. B. `v1.0.0-gold` eingeben und den aktuellen Branch/Commit auswählen.
4. Titel: `Meilenstein v1.0: Offline-Engine, Binärtransfer & High-Precision Zoom`.
5. Die obige Zusammenfassung hineinkopieren und auf **Publish release** klicken.
6. Der Release-Stand bleibt auf GitHub dauerhaft mit Download-Archiv (`.zip` / `.tar.gz`) und zugehörigem Commit archiviert.

### Option C: Stand jederzeit auschecken
Solltest du später an einer anderen Stelle experimentieren und zu genau diesem Stand zurückwollen:

```bash
git checkout v1.0.0-gold-offline-binary-refactor
```
