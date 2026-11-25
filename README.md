# Black Halo Tool

Modulares Org-Tool für Star Citizen (Black Halo Enterprises). Dieses Repo ist das Grundgerüst: ein Kern, der Module lädt, plus zwei Beispielmodule.

Projektziele, Entscheidungen und Stand: siehe [docs/PROJEKT-BRIEFING.md](docs/PROJEKT-BRIEFING.md).

## Starten (Windows)

Voraussetzung: [Node.js](https://nodejs.org) 20 oder neuer (LTS).

```
npm install
npm run dev
```

Der Server zeigt beim Start die URLs an. Auf Tablet oder Handy im selben WLAN die Zeile `Tablet: http://...` im Browser öffnen. Beim ersten Start fragt die Windows-Firewall nach Netzwerkzugriff, den bitte für private Netzwerke erlauben.

Tests: `npm test`

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

## Stand

- Fertig: Kern, Modul-System, Web-Shell, Modul `status`, Modul `controls` mit Mock-Treiber (loggt Tastendrücke nur).
- Als Nächstes: Windows-Eingabetreiber, damit die Buttons wirklich Tasten im Spiel auslösen.
- Die Tasten in `config/default.json` sind Beispiele. Passe sie an deine Keybinds an.
