# Testreferenz: Aaron Halo Mining Routes (Cornerstone)

`cornerstone-3.16.1.json` ist eine Abschrift der Karten **„Aaron Halo Mining Routes 3.16.1-LIVE Rel.1“** von
**CaptSheppard / Cornerstone** ([cstone.space](https://cstone.space)), Seiten 3 bis 7 (Raffinerien ARC-L1, CRU-L1,
HUR-L1, HUR-L2, MIC-L1). Die Karten gehören ihren Autoren. Wir nutzen die Zahlen nur als Referenz für den Test
`test/navigation.test.mjs`, im Tool selbst werden sie nicht angezeigt oder verwendet.

## Aufbau

- `pages[].refinery`: Raffinerie (Start), Bezeichnung wie auf der Karte (`ARC-L1`, `HUR-L2` ...).
- `pages[].columns[].to`: Ziel oben über der Spalte (`CRU-L4`, `CRUSADER`, `MICROTECH` ...).
- `bands[]`: für jedes Band die beiden Zahlen der Karte in km, in der Reihenfolge, in der sie auf der Seite stehen
  (Seite 3 und 7 von Band 1 bis 10, Seite 4 bis 6 von Band 10 bis 1).
  - `left`: Restentfernung zum Ziel beim Flug Raffinerie -> Ziel, an der dichtesten Stelle des Bands.
  - `right`: Restentfernung zur Raffinerie beim Rückflug Ziel -> Raffinerie, an derselben Stelle.
    Es gilt `left + right = Routenlänge`. Die Bedeutung ist auf allen Seiten gleich, auch dort, wo die Bänder von
    10 nach 1 sortiert sind.

Die Werte stehen so in der Datei, wie sie gedruckt sind, auch ein erkennbarer Druckfehler (siehe unten).

## Abgleich mit unseren Daten (Spieldaten 4.10.3)

Der Test rechnet jede Zelle mit den Mittelpunkten der L-Punkte (`*-centre` im Datensatz) und den
Planetenmittelpunkten nach und verlangt höchstens 20 km Abweichung. Gemessen sind es höchstens rund 1 km, mit drei
bekannten Ausnahmen, die der Test ausdrücklich behandelt:

1. **Druckfehler auf Seite 4**, CRU-L1 -> ARC-L3, Band 8, linke Zahl: gedruckt `10 992 695`, richtig ist
   `10 922 695`. Nur damit stimmt `left + right` mit der Routenlänge (18 649 640 km) überein, und genau das rechnen
   wir auch.
2. **microTech stand 3.16.1 woanders.** Alle Spalten mit Ziel MICROTECH weichen bei uns um rund 140 km ab, immer
   in dieselbe Richtung. Mit der alten Position `22 462 016 / 37 185 625 km` stimmen alle Zellen auf etwa 1 km. In
   den Spieldaten 4.10.3 liegt microTech rund 139 km weiter außen (69 / 120 km verschoben).
3. **CRU-L3 lag 3.16.1 genau gegenüber von Crusader** (`18 962 176 / 2 664 960 km`). Die Markierung in 4.10.3 liegt
   rund 12 km daneben. Auf der flach geschnittenen Route ARC-L1 -> CRU-L3 wächst das bis Band 1 auf 22 km.

Die Positionen für 2. und 3. stehen nur im Test (Stand der Karte), nicht im Datensatz.
