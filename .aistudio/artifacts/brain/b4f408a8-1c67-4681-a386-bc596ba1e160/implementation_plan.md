# Verlustfreie & Performante PDF-Dateigrößen-Optimierung (PatricksPDF)

Ziel dieser Erweiterung ist es, beim Speichern und Exportieren von PDF-Dokumenten stets die kleinstmögliche Dateigröße ohne sichtbaren Qualitätsverlust und bei gleichzeitig kürzerer Export-Laufzeit zu gewährleisten.

## User Review & Critical Decisions

> [!IMPORTANT]
> Alle fünf Optimierungsstufen arbeiten **100 % lokal im Browser/WebView** ohne zusätzliche externe Abhängigkeiten und erhalten die volle Kompatibilität mit allen PDF-Readern, Druck-Spoolern (Android Print) und Formular-Standards.

- **Entscheidung 1 – PDF 1.5 Object Streams (`useObjectStreams: true`)**: Komprimiert sämtliche indirekten PDF-Objekte (Formularfelder, Annotationen, Seitenbäume und Cross-Reference-Streams) per `FlateDecode`.
- **Entscheidung 2 – XObject-Deduplizierung für Signaturen & Bilder**: Mehrfach platzierte identische Unterschriften oder Stempel werden beim Export anhand eines schnellen Binär-Fingerprints erkannt, nur einmalig als PDF-`XObject` eingebettet und auf allen Zielseiten referenziert.
- **Entscheidung 3 – Font-Subsetting & Bedarfs-Einbettung**: Die Schreibschrift (`Caveat`) wird mit `{ subset: true }` eingebettet, sodass nur tatsächlich verwendete Glyphen gespeichert werden; Standard-Fonts (`Helvetica`) werden nur eingebunden, wenn ein Standard-Text-Overlay existiert.
- **Entscheidung 4 – Zero-Alpha RGB Pre-Cleaning & 300-DPI-Deckelung**: Vollständig transparente Hintergrundpixel (`alpha === 0`) erhalten vor der PNG-Erzeugung `R=0, G=0, B=0`, wodurch die `FlateDecode`-Kompression das Bild um 50–75 % stärker packt.
- **Entscheidung 5 – Nativer JPEG-Passthrough (`DCTDecode`) für voll-opake Bilder**: Wenn im „Original (As-Is)“-Modus ein Foto ohne jegliche Transparenz eingefügt wird, wird es als hochwertiges JPEG (`quality: 0.88`) kodiert und beim PDF-Export direkt via `embedJpg()` eingebettet.

---

## 1. Overview & Core Concept

- **Was wird verbessert**: Reduktion der erzeugten PDF-Dateigrößen um typischerweise **30 % bis 80 %** (insbesondere bei Formularen, mehrseitigen Verträgen mit mehreren Paraphen/Unterschriften sowie eingefügten Fotos/Stempeln).
- **Zielgruppe & Nutzungskontext**: Mobile (Android APK) und Desktop-Nutzer (PWA), die signierte oder ausgefüllte Dokumente per E-Mail, Messenger oder Upload-Portal mit strengen Dateigrößenlimits versenden.
- **Mehrwert**: Kleinere Dateien beim Teilen/Speichern und schnellere Export-Geschwindigkeit, da redundante PNG-Kompressionsläufe entfallen.

---

## 2. User Experience & Visual Design

- **Nahtloser Ablauf (Zero-Configuration)**:
  - Die Größenoptimierung greift vollautomatisch bei jedem Speichern, Teilen, Drucken und Teilseiten-Export – ohne dass der Nutzer zusätzliche Schalter bedienen muss.
  - Die visuelle Qualität von Unterschriften (300+ DPI Kantenschärfe), Vektorschriften und Dokumentseiten bleibt zu 100 % erhalten.
- **Visuelle Identität**:
  - Unverändertes, klares Interface-Design von PatricksPDF.

---

## 3. Key Product Decisions & Trade-Offs

- **Entscheidung 1: `useObjectStreams: true` beim Speichern**
  - *Gewählter Ansatz*: Aktivierung komprimierter Objekt-Streams in allen Speicherpfaden (Signatur-/Formular-Export sowie Seitenverwaltung).
  - *Warum*: Spart bei formular- oder annotationsreichen PDFs 15–45 % Dateigröße ohne jeglichen Qualitätsverlust.
  - *Verworfene Alternative*: Unkomprimierte Objekt-Tabellen (`useObjectStreams: false`) blähen mehrseitige Dokumente unnötig durch Klartext-Dictionaries auf.

- **Entscheidung 2: Binär-Fingerprint-Caching während des Exports**
  - *Gewählter Ansatz*: Berechnung eines deterministischen Fingerprints über die Bild-Bytes (`byteLength` + Stichproben/FNV-1a-Hash) und Wiederverwendung der `PDFImage`-Instanz.
  - *Warum*: Verhindert, dass bei 10 paraphierten Vertragsseiten 10 identische Bild-Streams im PDF landen; halbiert zudem die CPU-Zeit beim Export.

- **Entscheidung 3: Automatische Formatwahl (PNG vs. JPEG) über Alpha-Erkennung**
  - *Gewählter Ansatz*: Freigestellte Signaturen und Bilder mit Transparenz nutzen weiterhin verlustfreies 32-Bit-PNG mit genullten transparenten RGB-Kanälen; komplett undurchsichtige Bilder im `as-is`-Modus nutzen JPEG (`0.88`) und `embedJpg`.
  - *Warum*: `pdf-lib` reicht JPEG-Streams direkt als `DCTDecode` durch, was bei Fotos bis zu 90 % Speicherplatz und massiv RAM auf Mobilgeräten spart.

---

## 4. Technical Architecture & Data Strategy

### Architektur- & Pipeline-Diagramm

```
┌──────────────────────────────────────────────────────────────────────────┐
│                     Bild- & Signatur-Aufbereitung                        │
│                                                                          │
│  [Eingabebild / Canvas]                                                  │
│         │                                                                │
│         ├──► Freistellung / Transparenz vorhanden?                       │
│         │       ├─ JA ──► Zero-Alpha RGB Cleaning (alpha=0 -> RGB=0,0,0) │
│         │       │         + Optimales Bounding-Box-Cropping (PNG)        │
│         │       └─ NEIN ► Opakes Bild im As-Is-Modus -> JPEG (q=0.88)    │
└─────────┼────────────────────────────────────────────────────────────────┘
          │
          ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                        PDF-Export-Pipeline                               │
│                                                                          │
│  1. Formular- & Seiten-Isolation (Entfernen verwaister Objekte)          │
│  2. Selektives Font-Embedding:                                           │
│     ├─ Standard-Text vorhanden? ──► Helvetica (0 KB Zusatzdaten)         │
│     └─ Schreibschrift vorhanden? ─► Caveat-Regular mit { subset: true }  │
│  3. XObject-Bild-Deduplizierung:                                         │
│     ├─ Fingerprint(imgBytes) im Export-Cache?                            │
│     │    ├─ JA ──► Bestehendes PDFImage-XObject wiederverwenden          │
│     │    └─ NEIN ► Magic-Byte-Check (PNG vs. JPEG) -> embedPng/embedJpg  │
│  4. Serialisierung mit Komprimierung:                                    │
│     └─► targetDoc.save({ useObjectStreams: true })                       │
└──────────────────────────────────────────────────────────────────────────┘
```

### Verifikation & Dokumentation
- **Automatisierte Tests**:
  - Nachweis, dass eine mehrfach platzierte Signatur die PDF-Dateigröße im Vergleich zur einfachen Platzierung nur um wenige Bytes (Seiten-Referenz) statt um die volle Bildgröße erhöht.
  - Nachweis der Dateigrößen-Reduktion durch `useObjectStreams: true`, Font-Subsetting und JPEG/PNG-Optimierung.
  - Sicherstellung, dass alle bestehenden 51 Tests (inklusive Datenschutz-/Teilseiten-Isolation) fehlerfrei durchlaufen.
- **Dokumentation**:
  - Aktualisierung der Architektur- und Release-Dokumentation um die automatische PDF-Größenoptimierung.
