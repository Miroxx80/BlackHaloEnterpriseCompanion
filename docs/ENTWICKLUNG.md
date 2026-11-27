# Entwicklung

Für die Entwickler des Tools (Mitarbeit nur nach Absprache, siehe [LICENSE](../LICENSE)). Bedienung für Nutzer: [README](../README.md) und [Anleitung](ANLEITUNG.md). Projektziele, Entscheidungen und Stand: [PROJEKT-BRIEFING.md](PROJEKT-BRIEFING.md).

## Starten (Windows)

Voraussetzung: [Node.js](https://nodejs.org) 20 oder neuer (LTS).

```
npm install
npm run desktop
```

Es öffnen sich ein Fenster und ein Icon im Tray. Fenster schließen beendet die App nicht, der Server läuft im Tray weiter.

- **Nutzerordner** `%APPDATA%\BlackHalo`: `config\local.json` (eigene Einstellungen, enthält den Zugangsschlüssel), `data\` (Moduldaten), `logs\blackhalo.log`, `desktop.json` (Fensterposition usw.).
- **`--hidden`** startet nur ins Tray (wird für den Autostart genutzt).
- Ohne Electron (z. B. für den Hub): `npm run dev`. Dann gilt `config/local.json` im Projektordner, die URLs stehen in der Konsole.
- Unter Linux: `ONNXRUNTIME_NODE_INSTALL=skip npm install` (sonst lädt onnxruntime CUDA-Dateien herunter).

Tests:
- `npm test`: Kern und Module
- `npm run test:desktop`: Desktop-App Ende-zu-Ende (braucht Playwright, wird sonst übersprungen)
- OCR messen: `npm run build`, dann `node scripts/ocr-eval.mjs <Ordner ocr-samples\confirmed>` (Trefferquote, unnötiges Gelb, falsche Werte ohne Markierung). Die Beispiele entstehen über „Alles geprüft“ im Mining-Rechner.

## Release bauen und veröffentlichen

Auf einem **Windows-PC** im Projektordner (unter Linux/macOS bricht `npm run dist` ab, weil sonst die falsche Binary für die Tastendrücke eingepackt würde):

1. Version in `package.json` (`"version"`) erhöhen, z. B. `0.4.0`.
2. Bauen:

   ```
   npm install
   npm run dist
   ```

3. Auf GitHub ein Release mit Tag `v0.4.0` anlegen (Tag = Version mit `v` davor) und **alle drei Dateien** aus `release\` hochladen:
   - `BlackHalo-Setup-0.4.0.exe`
   - `BlackHalo-Setup-0.4.0.exe.blockmap`
   - `latest.yml`

   Ohne `latest.yml` findet der Update-Knopf die neue Version nicht. Das Release darf kein Entwurf und keine Vorabversion sein. Der Text des Releases erscheint im Tool als Änderungsnotiz.

Das Windows-Icon ist die fertige Datei `assets/icon.ico` (das Icon-Werkzeug von electron-builder stürzt unter Windows teils ab). Ändert sich das Logo `assets/icon.png`: `node scripts/make-ico.mjs`.

Zum Ausprobieren ohne Installer: `npm run dist:dir` erzeugt nur den Programmordner (`release\win-unpacked\BlackHalo.exe`).

**Updates im Tool** (`src/desktop/updater.ts`, electron-updater): Beim Start sieht die installierte App einmal auf GitHub nach und meldet eine neue Version (Windows-Benachrichtigung, Hinweis in der Seitenleiste). Herunterladen und Installieren erst auf Knopfdruck: Seite „Status“ (auch vom Handy) oder Tray-Menü. Danach installiert sich die neue Version still und startet neu. In der Entwicklungsversion (`npm run desktop`) gibt es keine Updates.

## Spieldaten aktualisieren

Die Module bringen ihre Daten als `src/modules/<id>/data/dataset.json` mit. Erzeugt werden sie aus [scunpacked-data](https://github.com/StarCitizenWiki/scunpacked-data), optional mit einem Commit als Argument:

- `node scripts/mining-data.mjs`: Mining (Laser, Module, Gadgets, Erze, Signaturen).
- `node scripts/navigation-data.mjs`: Sprunghilfen (Orte in Stanton, Sternradius, Bänder des Aaron Halo). Das Skript prüft Namen, Quantum-Ziele und die Referenzroute ARC L1 -> CRU L4 gegen die Cornerstone-Karte und bricht bei Abweichungen ab. Die Monde von microTech liegen in scunpacked gespiegelt, das Skript korrigiert das.

Referenzwerte für die Sprunghilfen: `test/fixtures/halo` (Abschrift der Cornerstone-Karten 3.16.1, siehe README dort).

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
    nav: { label: 'Mein Modul', icon: 'module', description: 'Kurzbeschreibung' },  // Navigation (Icon-Namen: web/icons.js)
    ui: true,                        // hat einen Ordner ui/
  },
  setup(ctx) {
    ctx.http.get('/hallo', async () => ({ ok: true }));      // GET /api/meinmodul/hallo
    ctx.ws.on('ping', (_p, client) => client.send('pong'));  // meinmodul:ping -> meinmodul:pong
  },
};
export default mod;
```

3. Optional `ui/index.js` mit `export function mount(root, api) { ... }` (optional eine Aufräum-Funktion zurückgeben). Die API bietet `get(path)`, `post(path, body)`, `put(path, body)`, `send(name, payload)`, `on(name, handler)` und `meta` (Nummer, Name, Beschreibung für den Seitenkopf). Die Navigation erscheint automatisch.
   Für das Aussehen gibt es gemeinsame Bausteine: `import { el, icon, pageHead, panel, button, chip, notice } from '/ui.js'` und die Klassen in `web/shell.css` (Design „Industrial“: `.panel`, `.btn`, `.field`, `.input`, `.select`, `.seg`, `.note`, `.alert`, `.kv` ...). Keine Emojis, Icons kommen aus `web/icons.js`.
4. Optional Einstellungen unter `modules.<id>` in der Config. Sie kommen als `ctx.config` an.
   Für eigene Dateien gibt es `ctx.dataDir` (`data/<id>/`). Der Ordner existiert schon, wenn `setup()` läuft.
5. `npm run dev`.

**Ein Modul entfernen:** Ordner löschen oder `"enabled": false` unter `modules.<id>` setzen. Am Kern ändert sich nichts. `npm run build` leert `dist/` vorher, damit gelöschte Module nicht aus einem alten Build weiterlaufen.

Module sollen sich nicht gegenseitig importieren. Für Zusammenarbeit gibt es `ctx.events` (Ereignisse) und `ctx.services` (bereitgestellte Funktionen, z. B. `input` von `controls`).

## Controls: Buttons-Konfiguration für Entwickler

Siehe [Anleitung, Tasten anpassen](ANLEITUNG.md#tasten-anpassen). Treiber und Tastennamen: `src/modules/controls/input/`.
