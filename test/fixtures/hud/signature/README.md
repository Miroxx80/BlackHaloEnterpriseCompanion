# Radar-Signatur-Marker (Testbilder)

Ausschnitte (Suchband 648x352 ab 636,230 bei 1920x1080) aus Spielbildern des Projekts
[ocrx-plugins](https://github.com/PetitCastor/ocrx-plugins) (`tests/fixtures/corpus/scan-signature`), MIT-Lizenz
(siehe `LICENSE-ocrx-plugins.txt`). Auf 1920x1080 verkleinert.

- `band-3400-orange.png`: Lindinium 3,400 (Argo MOLE, orangenes HUD), Original 2560x1440.
- `band-7200-green.png`: 7,200 (grünes HUD, FOV 84°), Original 2560x1440.

- `band-4180-prospector-pc-test.png`: eigener PC-Test 2026-11-27 (Prospector, 1920x1080, über den Chat als WebP). Im Band stehen auch der Kurs "267°" (wurde als 2672 gelesen) und "5.0km": dürfen nicht als Signatur gelten.

Eigene Aufnahmen des Besitzers (Prospector, 1920x1080, Aaron Halo, 2026-11-28, Dev-Schalter „Radar: alle Bilder
speichern“), verlustfrei als WebP. Ziffern nur ~9 px hoch mit Farbsäumen; die alte freie Lesung lag hier falsch:

- `band-11520-aaron-halo.webp`: 11,520 (früher als "1.520" -> 1520 gelesen; jetzt mit Schild-Schrift `both`).
- `band-19275-aaron-halo.webp`: 19,275 (früher "10,275"; das Modell sieht wirklich eher 10,275 -> nichts lesen).
- `band-17080-aaron-halo.webp`: 17,080 (die führende 1 ist für das Modell kaum besser als 7,080, margin 0,9 -> nichts
  lesen, auch nicht mit Schild-Schrift: die Stufe `tag` verlangt margin ab 1).
- `band-11565-aaron-halo-blur.webp`: 11,565 unscharf (früher "1,565" und falsch bestätigt -> nichts lesen; die
  Schild-Schrift liest 11565, aber die Erkennung sieht nur "55", die 6 nicht, und die Schild-Schrift ergänzt keine Ziffer).

Grün (7200) und PC-Test (4180): Pin und Lexikon finden den richtigen Wert, die Schild-Schrift findet diese Schilder aber
nicht -> keine Lesung (`no-tag`; das Lexikon allein zählt nicht mehr).

## `tags/`: markierte Schilder (Schild-Schrift, `scripts/ocr-train-tagfont.mjs`)

31 Ausschnitte aus 31 Bildern derselben Aufnahme (Aaron Halo, 2026-11-28), je ein Schild mit Pin und Zahl, von Hand
geprüft. `labels.json`: `value` (wahre Signatur), `box` (Kasten der Zahl im Ausschnitt, wie der Detektor ihn fand;
`kind` `partial` = nur ein Teil wie „,565“, `undetected` = Detektor fand nichts, Kasten von Hand), `frame` (Uhrzeit des
Bilds), `at` (Lage des Ausschnitts bei 1920x1080). Werte: 11520, 19275, 2000, 10620, 21425, 17080, 11565, 3540, 15360,
21275, 17200. Daraus und aus den Bändern oben lernt das Skript `src/modules/mining/data/ocr/tagfont.json`. Die vier
`band-*-aaron-halo*.webp` stammen aus denselben Bildern; Tests, die ehrlich messen sollen, lernen ohne den geprüften Wert.
