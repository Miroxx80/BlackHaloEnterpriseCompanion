# Anleitung

Details zur Bedienung. Kurzüberblick und Installation: [README](../README.md).

## Tablet oder Handy verbinden

Im Fenster auf „Verbinden“ (oder Tray, „Gerät verbinden“) und den QR-Code mit dem Handy scannen. Das Gerät muss im selben WLAN sein wie der PC. Fragt die Windows-Firewall nach Netzwerkzugriff, für **private Netzwerke** erlauben.

Einstellungen, Zugangsschlüssel und Loadouts liegen unter `%APPDATA%\BlackHalo` (Ordner öffnen über das Tray-Menü) und bleiben bei Updates und beim Deinstallieren erhalten. Eigene Einstellungen gehören in `%APPDATA%\BlackHalo\config\local.json`.

## Tasten anpassen

Controls ist zur Zeit **gesperrt**: Das Menü ist ausgegraut, und das Tool sendet keine Tasten. Zum Testen einschalten: in der lokalen Config `"modules": { "controls": { "enabled": true } }`, dann das Tool neu starten.

Die Buttons stehen unter `modules.controls` in der Config. Eigene Buttons gehören in die lokale Config (`%APPDATA%\BlackHalo\config\local.json`). Dort ersetzt die Liste `buttons` die Standardliste komplett.

```json
{
  "modules": {
    "controls": {
      "target": { "process": "StarCitizen.exe" },
      "buttons": [
        { "id": "landing-gear", "label": "Fahrwerk", "key": "n" },
        { "id": "eject", "label": "Aussteigen", "key": "y", "hold": 1500 },
        { "id": "power", "label": "Energie", "key": "ralt+u" }
      ]
    }
  }
}
```

- **`key`:** eine Taste oder Kombination mit `+`, höchstens 4 Tasten. Namen wie in Star Citizens Keybinds (US-Layout): `a`–`z`, `0`–`9`, `f1`–`f24`, `lalt`/`ralt`, `lctrl`/`rctrl`, `lshift`/`rshift`, `space`, `enter`, `tab`, `escape`, `up`/`down`/`left`/`right`, `np_0`–`np_9`, `np_add` usw. (vollständige Liste in `src/modules/controls/input/keys.ts`). Kurzformen: `alt`, `ctrl`/`strg`, `shift`, `esc`.
- **US-Layout heißt:** Es zählt die Position der Taste, nicht die Beschriftung. Auf einer deutschen Tastatur ist `z` die Taste mit dem „Y“ und umgekehrt. Genau so erwartet es das Spiel.
- **`hold`:** Taste so viele Millisekunden halten (für Aktionen, die im Spiel „halten“ verlangen). Ohne `hold` gibt es einen kurzen Druck (50 ms).
- **`target.process`:** Programm, das die Tasten bekommt. Standard `StarCitizen.exe`, zum Testen z. B. `notepad.exe`.
- **`driver`:** `auto` (Standard: unter Windows echte Tasten, sonst `mock`), `windows` oder `mock` (nur protokollieren).
- Feintuning, nur falls nötig: `tapMs` (Dauer eines kurzen Drucks), `comboGapMs` (Pause zwischen den Tasten einer Kombination), `focusSettleMs` (Wartezeit nach dem Wechsel ins Spiel).

**So kommt der Tastendruck an:** Vor jedem Druck prüft das Tool, ob das Zielprogramm im Vordergrund ist, und holt es notfalls nach vorn (auch aus der Minimierung). Gelingt das nicht oder läuft es nicht, wird **nichts** gesendet, und die Oberfläche zeigt eine Meldung. Tasten landen nie in einem anderen Fenster. Mehrere Drücke laufen strikt nacheinander. Mehr als 5 wartende werden abgelehnt.

**Wichtig:** Läuft Star Citizen bzw. der RSI Launcher **als Administrator**, lässt Windows Tastendrücke von normalen Programmen nicht durch (ohne Fehlermeldung). Dann das Spiel normal starten, nicht als Administrator.

Ein Knopfdruck ist genau eine Tastenaktion, wie bei einem Stream Deck. Keine Automatik, keine Wiederholungen, keine Verbindung zwischen Texterkennung und Tastendrücken. Das Tool liest keinen Spielspeicher, schleust nichts ins Spiel ein und ändert keine Spieldateien. Tasten gehen über die normale Windows-Schnittstelle (`SendInput`).

## Mining Companion

Rechner für die Prospector: Steinwerte eingeben (oder einlesen), Loadout wählen. Das Tool sagt, ob der Stein brechbar ist, mit wie viel Laserleistung, und auf welche Entfernung (z. B. „45 % bei 39 m“). Reicht der Laser nur mit Gadget, steht dort „Machbar mit Gadget“. Der aktuelle Scan ist zwischen PC, Handy und zweitem Bildschirm synchron.

### Scan einlesen (OCR)

Das Tool liest das Scan-Panel aus einem Bild des Bildschirms (1920×1080, englisches HUD). Das Sichtfeld (FOV) ist egal: Das HUD wird mit dem FOV kleiner oder größer (bei FOV 100 etwa 0,87× so groß wie bei FOV 86), das Tool erkennt die Größe selbst (getestet mit FOV 86 und 100, künstlich nachgestellt etwa FOV 70–120).

- **Am PC einlesen** (Knopf im Rechner, z. B. am Handy, während du im Spiel bist): Die Desktop-App fotografiert den Hauptbildschirm und trägt die Werte ein. Star Citizen sollte im Modus „Randloses Fenster“ laufen, im exklusiven Vollbild kann die Aufnahme schwarz sein.
- Der Hotkey Alt+Shift+S kommt nicht an, solange das Spiel den Fokus hat. Im Spiel deshalb den Knopf am Handy nutzen.
- Alternativ im Rechner: „Screenshot einlesen“ (Bilddatei) oder ein Bild mit **Strg+V** einfügen.
- Unsichere Werte (v. a. 0/6/8/9) sind **gelb markiert**. Prüfen, ggf. korrigieren, dann „Alles geprüft“. Vor hellem Planetenboden ist mehr gelb. Bei einem anderen FOV als 86 ist ebenfalls mehr gelb: Die eigene Ziffernerkennung, die viele Zweifel bei FOV 86 ausräumt, ist nur dafür gelernt. Erkennt das Tool die Größe des Panels nicht sicher, ist alles gelb. Ein JPEG oder ein Bild in anderer Auflösung ergibt ebenfalls deutlich mehr gelb (die Kompression verändert die Ziffern); am besten „Am PC einlesen“ oder ein PNG in 1920×1080.
- Bilder werden standardmäßig **nicht** gespeichert. Wer beim Verbessern der Texterkennung hilft, schaltet im Menü **Dev** „OCR-Scans als Bild speichern“ ein. Dann liegen die letzten 60 Lesungen in `data\mining\ocr-samples`, und „Alles geprüft“ legt den Scan mit Bildausschnitt in `data\mining\ocr-samples\confirmed` ab (bis 200 Stück, ca. 0,5 MB pro Scan). Im Menü Dev steht auch, wie viel Platz die Ordner belegen, und man kann sie dort leeren.
- Die Texterkennung (PaddleOCR) läuft lokal auf der CPU, ca. 0,5–0,7 s pro Bild (bei anderem FOV etwas länger, ohne Scan-Panel im Bild bis ~1 s).
- Ausschalten: in `config\local.json` unter `modules.mining` `"ocr": false`.

### Radar-Signatur

Oben im Mining-Bereich: Zahl vom Radar eintippen (z. B. 16.960), optional den Ort wählen. Das Tool zeigt, was dahinter steckt: Erz × Anzahl Steine (16.960 = Kupfer ×4), Bodenvorkommen (ROC 4000, Handabbau 3000, Bergung/Pflanzen 2000 je Teil), Wracks. Mehrdeutige Werte zeigen alle Möglichkeiten, sonst Kombinationen aus zwei Kontakten. Daten: Spieldaten 4.10.3 (scunpacked).

**Live lesen** (Knopf im Feld Radar-Signatur, nur mit der Desktop-App): Das Tool nimmt etwa jede Sekunde den Bereich um das Fadenkreuz auf, findet die Signatur-Schilder nach einem Ping und zeigt sie mit Deutung auf allen Geräten. Eine Zahl erscheint erst, wenn sie mehrfach gleich gelesen wurde. Läuft nur, solange Star Citizen im Vordergrund ist. Tippen auf einen Eintrag übernimmt ihn ins Feld. Einstellungen unter `modules.mining`: `signatureIntervalMs` (Standard 800), `gameProcess` (Standard `StarCitizen.exe`).

### Overlay über dem Spiel

Tray-Menü, „Overlay über dem Spiel“, oder vom Handy (Mining, „Overlay“). Ein durchsichtiges, durchklickbares Fenster über dem Hauptbildschirm (Star Citizen im Modus „Randloses Fenster“). Beim Live-Lesen steht die Deutung jeder Radar-Signatur direkt neben dem Marker. Kein Eingriff ins Spiel, nur Anzeige. Das Overlay ist von Bildschirmaufnahmen ausgenommen, damit die eigene Texterkennung es nicht mitliest.

## Sprunghilfen: Aaron Halo

Der Aaron Halo ist der Asteroidengürtel in Stanton (rund 19,7 bis 21,3 Gm vom Stern). Er ist in 10 Bänder geteilt, Band 5 ist das dichteste, Band 1 fast leer. Ein Quantum-Sprung, dessen gerade Strecke den Gürtel kreuzt, lässt sich mitten im Band abbrechen.

1. Unter **Sprunghilfen** Start und Ziel wählen (der Pfeil-Knopf tauscht beide). Die Auswahl merkt sich jedes Gerät.
2. Oben steht die Empfehlung, z. B. **„Bei 13,2 Gm abbrechen“**, darunter, zwischen welchen Restentfernungen du im Band bist.
3. Im Spiel den Sprung zum Ziel planen und starten. Sobald die Restentfernung im HUD den Wert zeigt, aus dem Quantum-Sprung gehen.

- Die Tabelle zeigt alle Bänder in der Reihenfolge der Route. „Abbrechen bei“ ist der Wert in Gm, wie ihn das HUD zeigt (eine Nachkommastelle). „Im Band“ ist der Bereich der Restentfernung, in dem du im Band bist.
- Manche Routen kreuzen den Gürtel zweimal (hinein und wieder hinaus), diese Zeilen sind als „2. Durchquerung“ markiert.
- „über dem Band“ / „unter dem Band“: Die Route kreuzt den Gürtel zu hoch oder zu tief, dort ist kaum etwas. Das passiert z. B. bei den Gateways.
- Führt die Route durch einen Planeten oder den Stern, erscheint eine Warnung. Im Spiel ist so ein Sprung evtl. gesperrt.
- **Ziele vom Start aus:** Band wählen (Standard 5). Die Liste zeigt die kürzesten Routen vom Start, die dieses Band innerhalb seiner Dicke kreuzen (ohne Routen durch einen Planeten oder Mond). Antippen setzt das Ziel. Die Empfehlung oben gilt für das gewählte Band, solange die Route es kreuzt.
- Gelb markierte Werte sind knapp: Das Band ist dort schmaler als ein HUD-Schritt (0,1 Gm).
- Unter 1 Gm vor dem Ziel zeigt das HUD keine Gm mehr. Bänder, die erst so kurz vor dem Ziel kommen (z. B. auf dem Weg zur Wikelo Emporium Selo Station, die selbst in Band 4 liegt), stehen in der Tabelle mit „–“ und den Bereich in Mm (1 Mm = 1.000 km).
- Im Spiel bestätigt (4.10): MIC-L1 Shallow Frontier Station -> Hurston, Abbruch bei 13,2 Gm, sehr dichter Bereich.
- Daten: Positionen aus den Spieldaten 4.10.3, Bänder aus der Vermessung von CaptSheppard / Cornerstone (Alpha 3.16.1).

## Menü „Dev“

Schalter für die Entwicklung des Tools. Für normales Spielen alles auf „Aus“ lassen.

- **OCR-Scans als Bild speichern:** Trainingsdaten für die Texterkennung (siehe Mining).
- **Radar-Bilder speichern:** Bilder vom Live-Lesen der Radar-Signaturen (die letzten 60).
- **Gespeicherte Bilder:** Größe der Ordner und Knopf zum Leeren. Die bestätigten Scans (Trainingsdaten) sind ein eigener Ordner und bleiben beim Leeren der übrigen erhalten.

Die Schalter gelten für alle Geräte und bleiben nach einem Neustart oder Update erhalten (`data\dev\settings.json`).
