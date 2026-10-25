# Implementierungsplan: Sichtbereichszentrierte Platzierung von Unterschriften und Texten

## 1. Ausgangslage & Zielsetzung
Beim Hinzufügen einer Unterschrift oder eines Textfeldes werden neue Elemente derzeit an festen Standardkoordinaten der aktuellen PDF-Seite platziert (Unterschriften bei `52% / 78%`, Texte bei `35% / 40%`). Wenn Nutzer zuvor in einen bestimmten Dokumentbereich hineingezoomt und gescrollt haben, liegt das neu eingefügte Element häufig außerhalb des aktuell sichtbaren Ausschnitts oder ist im Verhältnis zum stark vergrößerten Kartenausschnitt überdimensioniert.

Ziel dieser Erweiterung ist es, neue Unterschriften und Texte exakt im **Zentrum des aktuell sichtbaren PDF-Ausschnitts (Viewport)** zu platzieren, ihre Anfangsgröße bei starkem Zoom automatisch an den sichtbaren Ausschnitt anzupassen und bei mehreren nacheinander eingefügten Elementen ohne Zwischenscrollen einen leichten Versatz anzuwenden.

---

## 2. Geometrie & Platzierungslogik

```
+-------------------------------------------------------------------+
| Gesamte PDF-Seite (100% x 100%)                                   |
|                                                                   |
|        +-----------------------------------------+                |
|        | Aktuell sichtbarer Viewport-Ausschnitt  |                |
|        | (visibleLeft..Right, visibleTop..Bottom)|                |
|        |                                         |                |
|        |          +-------------------+          |                |
|        |          | Neues Element     |          |                |
|        |          | (x%, y%, width%)  |          |                |
|        |          |         *         | <-- Viewport-Mittelpunkt  |
|        |          +-------------------+     (centerX%, centerY%)  |
|        |             +--> [2. Element leicht versetzt (+Δx, +Δy)] |
|        +-----------------------------------------+                |
|                                                                   |
+-------------------------------------------------------------------+
```

### 2.1 Ermittlung des sichtbaren Seitenbereichs
- Der PDF-Viewer ermittelt über die Bounding-Box des scrollbaren Containers und der gerenderten Seiten-Container, welche PDF-Seite sich aktuell im Mittelpunkt des sichtbaren Viewports befindet (analog zur bestehenden Zoom-Anker-Berechnung).
- Für diese Zielseite werden ermittelt:
  - **Sichtbarer Mittelpunkt (`centerXPercent`, `centerYPercent`)**: Die Seitenkoordinaten (`0..100%`), die exakt unter der Mitte des sichtbaren Scroll-Containers liegen.
  - **Sichtbarer Seitenanteil (`visibleWidthRatio`, `visibleHeightRatio`)**: Das Verhältnis zwischen sichtbarer Breite/Höhe der Seite im Viewport und der gesamten gerenderten Seitenbreite/-höhe (`0 < ratio <= 1`).
  - **Sichtbare Begrenzung (`visibleMinXPercent` bis `visibleMaxXPercent`, `visibleMinYPercent` bis `visibleMaxYPercent`)**: Der aktuell auf dem Bildschirm sichtbare Bereich der Seite in Prozentkoordinaten.

### 2.2 Zoom-adaptive Anfangsgröße
- **Unterschriften**:
  - Standardbreite bei normaler Ganzseitenansicht bleibt `28%` der Seitenbreite.
  - Wenn stark hineingezoomt ist (`visibleWidthRatio < 1`), wird die Anfangsbreite proportional auf ca. `40%` der aktuell sichtbaren Ausschnittsbreite begrenzt (`Math.min(defaultWidthPercent, visibleWidthPercent * 0.42)`), mit einer sinnvollen Untergrenze (z. B. `6%` der Seitenbreite), damit die Unterschrift sofort angenehm im sichtbaren Bereich sitzt und die Ziehpunkte (Resize-Handles) direkt erreichbar bleiben.
  - Aus dem Seitenverhältnis (`aspectRatio`) der Unterschrift und den Seitenabmessungen wird zudem die prozentuale Höhe (`heightPercent`) abgeleitet, sodass das Element nicht über seinem oberen linken Eckpunkt, sondern über seinem **tatsächlichen optischen Mittelpunkt** zentriert wird:
    - `xPercent = centerXPercent - widthPercent / 2`
    - `yPercent = centerYPercent - heightPercent / 2`
- **Textfelder**:
  - Standardbreite orientiert sich ebenfalls am sichtbaren Ausschnitt (begrenzt auf maximal `25%` der Seitenbreite bzw. `45%` des sichtbaren Ausschnitts, mindestens `10%`), und wird vertikal wie horizontal um die geschätzte initiale Textfeldgröße im sichtbaren Mittelpunkt zentriert.

### 2.3 Kaskadierender Versatz bei Mehrfacheinfügung
- Werden mehrere Unterschriften oder Texte direkt nacheinander eingefügt, ohne dass der Nutzer den sichtbaren Ausschnitt verschoben hat, prüft die Platzierungslogik alle bereits auf derselben Seite vorhandenen Elemente.
- Liegt an der berechneten Zielposition bereits ein Element (innerhalb einer kleinen Toleranzschwelle), wird das neue Element schrittweise leicht nach rechts unten versetzt (`+2.5% * visibleWidthRatio` horizontal und `+2.5% * visibleHeightRatio` vertikal pro Kollisionsstufe).
- Abschließend werden `xPercent` und `yPercent` sicher innerhalb des sichtbaren Seitenbereichs (sowie innerhalb der Seitenränder `2% .. 98%`) begrenzt (Clamping), damit das Element niemals aus dem sichtbaren Bereich oder über den Seitenrand hinausragt.

---

## 3. Verifikation & Qualitätssicherung
- **Unit-Tests**: Reine Berechnungsfunktionen für Mittelpunkt-Berechnung, Zoom-Größenanpassung, Rand-Clamping und Kaskadierungs-Versatz werden durch gezielte Unit-Tests abgedeckt.
- **Bestehende Funktionen**: Verschieben, Skalieren, Drehen, Undo/Redo-Verlauf sowie die Koordinatenumrechnung beim PDF-Export bleiben vollständig unverändert und kompatibel.
