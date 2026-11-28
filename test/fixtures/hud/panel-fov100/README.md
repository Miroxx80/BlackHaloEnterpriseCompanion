# FOV 100 (Prospector, 1920x1080, 2026-11-27)

Quelle: ein Freund der Org-Leitung, über die Org-Leitung für die Verbesserung der Texterkennung bereitgestellt. Er spielt mit FOV 100 (die
Org-Leitung mit dem Standard 86). Dadurch ist das ganze HUD kleiner: Das Scan-Panel ist ~0,86x so groß (passt zu
Maßstab ~ 86 / FOV) und rückt zur Bildmitte (hier ~50 px weiter links).

- `<Zeit>-panel.png`: gespeicherter Suchbereich der App (576x608 ab 1184,392).
- `<Zeit>-truth.json`: mit "Alles geprüft" bestätigte Werte (Format wie in ocr-samples/confirmed), Zeilen in der
  Reihenfolge auf dem Bildschirm. Wo das Bild eindeutig anderes zeigt, korrigiert:
  - `18-55-10`: Die alte Version hat die erste Zeile (9.42 % Taranite 718) direkt unter dem Balken übersehen; sie wurde
    beim Bestätigen am Ende ergänzt (hier an die richtige Stelle gesetzt). INST-Farbe ist weiß (bestätigt war rot: die
    alte Version las rot, vermutlich vom IMPOSSIBLE-Balken darunter). SCU war leer gelassen; im Bild 25.28.
  - `18-36-46`: unverändert.
- Auswerten auch mit `node scripts/ocr-eval.mjs test/fixtures/hud/panel-fov100`.
