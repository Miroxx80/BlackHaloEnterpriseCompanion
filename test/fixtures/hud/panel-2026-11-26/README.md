# PC-Test 2026-11-26 (Prospector, Helix I, 1920x1080)

- `scan-1..5.png`: gespeicherte Panel-Ausschnitte (200x265 ab 1355,475) der ersten Version. Das Panel lag bei
  Scan 3–5 rund 95 px tiefer, deshalb sind die Zeilen abgeschnitten. Nur für die Panelsuche (Versatz).
- `region-*.webp`: Suchbereich (576x608 ab 1184,392) der zweiten Version, über den Chat als WebP (verlustbehaftet).
  Echte Werte in `regions.json` (region-rock: von der Org-Leitung als 100 % korrekt gelesen bestätigt;
  region-snow: Masse 32240 aus dem Bild, die OCR las 32249 ohne Markierung -> Regel für 0/6/8/9 verschärft).
- `region-dark-ice-3312kg.png` (verlustfrei, dunkler Boden) und `region-headlight-ice-2296kg.webp` (Scheinwerfer):
  Werte aus dem Bild, bei reinem Eis bestätigt über Masse = SCU x 142,857 (Dichte 1). Erster Scan zeigte die
  weiße Schrift als "grün" (Farbsaum der HUD-Schrift) -> Farberkennung über den Mittelwert.
- `region-*-ice-2296kg/460kg`: zwei Eis-Steine je ohne/mit Scheinwerfer (PC-Test 4). Mit Licht erschien eine leere
  Phantom-Zeile in der Zusammensetzung -> Zeilen ohne lesbaren Inhalt werden ausgelassen.
- `region-confirmed-*`: aus den ersten bestätigten Trainingsdaten ("Alles geprüft", 21 Scans, Weltraum und 3 Planeten). Schwierige Fälle: Masse 10323 als 18323 gelesen, zwei fehlende Zeilen, Panel um 117 px verschoben.
