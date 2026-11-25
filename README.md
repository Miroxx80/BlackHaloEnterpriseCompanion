# Black Halo Tool

Modulares Org-Tool für Star Citizen (Black Halo Enterprises). Desktop-App (Electron) für den Gaming-PC: läuft im Tray, stellt einen lokalen Server fürs Tablet/Handy bereit und hat ein Fenster, z. B. für den zweiten Bildschirm.

Projektziele, Entscheidungen und Stand: siehe [docs/PROJEKT-BRIEFING.md](docs/PROJEKT-BRIEFING.md).

## Starten (Windows)

Voraussetzung: [Node.js](https://nodejs.org) 20 oder neuer (LTS). Später gibt es einen Installer, dann ist Node nicht mehr nötig.

```
npm install
npm run desktop
```

Es öffnen sich ein Fenster und ein Icon im Tray (neben der Uhr). Fenster schließen beendet die App nicht, der Server läuft im Tray weiter. Beenden über Rechtsklick aufs Tray-Icon.

- **Tablet/Handy verbinden:** im Fenster auf „Verbinden“ (oder Tray, „Gerät verbinden“) und den QR-Code scannen. Das Gerät muss im selben WLAN sein. Beim ersten Start fragt die Windows-Firewall nach Netzwerkzugriff, bitte für private Netzwerke erlauben.
- **Nutzerordner** `%APPDATA%\BlackHalo`: `config\local.json` (eigene Einstellungen, enthält den Zugangsschlüssel), `data\` (Moduldaten), `logs\blackhalo.log`, `desktop.json` (Fensterposition usw.). Ordner öffnen über das Tray-Menü.
- **`--hidden`** startet nur ins Tray (wird für den Autostart genutzt).

Ohne Electron (z. B. für den Hub oder zum Entwickeln): `npm run dev`. Dann gilt `config/local.json` im Projektordner, und die URLs stehen in der Konsole.

Tests:
- `npm test`: Kern und Module
- `npm run test:desktop`: Desktop-App Ende-zu-Ende (braucht Playwright, wird sonst übersprungen)

## Architektur

```
Gaming-PC (Companion)                      Zentral (Hub, später)
  Node-Server                                 Node-Server, gleiche Codebasis
  - Module: controls, status, ...             - Module: org-storage, ...
  - Tastendrücke ans Spiel                    - gemeinsame Daten aller Mitglieder
  - Web-UI für Tablet/Handy im LAN
          \________ Verbindung über Internet ________/
```

Alle Mitglieder sitzen in getrennten Netzen. Deshalb gibt es zwei Rollen, die aus **derselben Codebasis** laufen und per `role` in der Config gewählt werden:

- **companion**: läuft auf dem Gaming-PC jedes Mitglieds. Löst Tastendrücke aus und liefert die Oberfläche an Tablet/Handy im eigenen Netz.
- **hub**: ein zentraler Server für alles, was die ganze Orga teilt (Org Storage, später evtl. Positions-Sync).

Jedes Modul sagt in seinem Manifest, in welcher Rolle es läuft.

### Desktop-App (`src/desktop`)

```
Electron-Hauptprozess (main.ts)
 ├─ Tray (tray.ts), Fenster (window.ts), Einstellungen (settings.ts), Log (log.ts)
 ├─ Supervisor (supervisor.ts) ──startet──> Server-Prozess (serverEntry.ts = Kern + Module)
 │                                           ▲            ▲
 └─ Fenster lädt http://127.0.0.1:<port> ────┘            └── Tablet/Handy im WLAN
```

- Der Server läuft in einem eigenen Prozess. Stürzt er ab, startet der Supervisor ihn neu (1 s, 2 s, 5 s, 10 s). Nach 5 Abstürzen in einer Minute gibt er auf und zeigt den Fehler im Fenster und im Tray.
- Das Fenster ist nur ein weiterer Client, wie das Tablet. Es sieht dieselbe Oberfläche. Beim Schließen wird es wirklich beendet (spart RAM neben dem Spiel). Position, Größe und Bildschirm werden gemerkt. Fehlt der Bildschirm, öffnet es auf dem Hauptbildschirm.
- Die Seite im Fenster hat keinen Zugriff auf Node oder Electron (kein Preload, Sandbox aktiv).
- Die Desktop-App läuft immer mit Zugangsschlüssel. Fehlt einer, wird er beim ersten Start erzeugt.

### Kern (`src/core`)

| Datei | Aufgabe |
|---|---|
| `moduleLoader.ts` | Findet Module, prüft sie, sortiert nach `dependsOn`, startet sie isoliert |
| `ws.ts` | WebSocket-Router mit Namensräumen pro Modul |
| `events.ts` | Event-Bus und Service-Registry für lose Kopplung zwischen Modulen |
| `config.ts` | `config/default.json`, dann `config/local.json`, dann Umgebungsvariablen |
| `app.ts` | Server, Token-Schutz, statische Dateien |

### Stabilität

- Ein Modul, das beim Laden oder Starten fehlschlägt, wird als `failed` markiert. Alle anderen laufen weiter. Seine Routen antworten dann mit 503, und alles, was es vorher angemeldet hat (WebSocket-Handler, Services, Event-Handler), wird zurückgenommen.
- Module haben getrennte Namensräume für REST (`/api/<id>/...`) und WebSocket (`<id>:<name>`). Sie können sich nicht gegenseitig überschreiben.
- WebSocket-Nachrichten sind auf 64 KB begrenzt, kaputtes JSON wird abgefangen.
- Optionaler Zugriffsschutz: `security.token` in `config/local.json` setzen. Dann brauchen `/api` und `/ws` das Token. Die URL mit `?token=...` merkt sich der Browser.

## Ein Modul hinzufügen

1. Ordner `src/modules/<id>/` anlegen (Ordnername = ID).
2. `index.ts` mit einem Default-Export:

```ts
import type { BhModule } from '../../core/types.js';

const mod: BhModule = {
  manifest: {
    id: 'meinmodul',
    name: 'Mein Modul',
    version: '0.1.0',
    roles: ['companion'],            // oder ['hub'] oder beides
    nav: { label: 'Mein Modul' },    // Eintrag in der Navigation
    ui: true,                        // hat einen Ordner ui/
  },
  setup(ctx) {
    ctx.http.get('/hallo', async () => ({ ok: true }));      // GET /api/meinmodul/hallo
    ctx.ws.on('ping', (_p, client) => client.send('pong'));  // meinmodul:ping -> meinmodul:pong
  },
};
export default mod;
```

3. Optional `ui/index.js` mit `export function mount(root, api) { ... }`. Die API bietet `get(path)`, `send(name, payload)` und `on(name, handler)`. Die Navigation erscheint automatisch.
4. Optional Einstellungen unter `modules.<id>` in der Config. Sie kommen als `ctx.config` an.
   Für eigene Dateien gibt es `ctx.dataDir` (`data/<id>/`). Der Ordner existiert schon, wenn `setup()` läuft.
5. `npm run dev`.

**Ein Modul entfernen:** Ordner löschen oder `"enabled": false` unter `modules.<id>` setzen. Am Kern ändert sich nichts. `npm run build` leert `dist/` vorher, damit gelöschte Module nicht aus einem alten Build weiterlaufen.

Module sollen sich nicht gegenseitig importieren. Für Zusammenarbeit gibt es `ctx.events` (Ereignisse) und `ctx.services` (bereitgestellte Funktionen, z. B. `input` von `controls`).

## Controls: Buttons und Tasten

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

**Wichtig:** Läuft Star Citizen bzw. der RSI Launcher **als Administrator**, blockiert Windows Tastendrücke von normalen Programmen, ohne Fehlermeldung. Dann entweder das Spiel normal starten oder Black Halo ebenfalls als Administrator.

Es wird nichts in das Spiel eingeschleust und kein Speicher gelesen. Das Tool sendet nur Tastendrücke über die normale Windows-Schnittstelle (`SendInput`), wie ein Makro-Programm.

## Stand

- Fertig: Kern, Modul-System, Web-Shell, Desktop-App (Tray, Fenster, Server-Prozess mit Neustart), Module `status`, `pairing` (QR-Code) und `controls` mit Windows-Treiber (Scancodes, Kombinationen, Halten, Vordergrund-Prüfung) und Mock-Treiber.
- Als Nächstes: Installer und Auto-Update.
- Die Tasten in `config/default.json` sind Beispiele. Passe sie an deine Keybinds an.
