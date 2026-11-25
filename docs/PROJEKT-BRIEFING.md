# Black Halo Enterprises – Star Citizen Org-Tool

## Grundlagen
- Tool für das Spiel **Star Citizen**
- Nur intern genutzt von der kleinen Freundes-Organisation "Black Halo Enterprises"
- Nutzer: alle Windows, aktuell max. 5 Personen in getrennten Netzwerken, später evtl. mehr

## Geplante Funktionen (Liste wird laufend erweitert)
1. **Geräte-Verbindung**: PC <-> Handy/Tablet über lokalen Server
2. **Live-Interface mit Buttons** (ähnlich GameGlass): Spielfunktionen vom Tablet/Handy auslösen
3. **Info-Übersicht**: Karten, Routen, Locations, POIs. Optional: Live-Tracking der Position, später evtl. Sync zwischen Usern
4. **Organisation Storage**: Bestände der Orga (Materialien etc.)
5. **Support-Tool für Mining & Salvage** (Referenz: https://the-forsaken.org/bedrock)

## Entscheidungen
- **Stack:** Node.js + TypeScript, Fastify, WebSocket. Frontend ohne Build-Schritt (ES-Module). Priorität: Stabilität und Erweiterbarkeit.
- **Zwei Rollen, eine Codebasis:** `companion` (läuft auf jedem Gaming-PC, Tastendrücke und lokale UI) und `hub` (zentraler Server für geteilte Daten wie Org Storage). Nötig, weil alle in getrennten Netzen sitzen.
- **Modular:** Jedes Feature ist ein Modul in `src/modules/<id>/`, wird automatisch gefunden und kann per Ordner löschen oder `enabled: false` entfernt werden. Ein defektes Modul stoppt die anderen nicht.
- **Eingabe:** Treiber-Abstraktion. Aktuell nur Mock, Windows-Treiber (SendInput) folgt.
- **Positions-Tracking:** Keine offizielle API. Mögliche Wege: `/showlocation`, `Game.log`, manuelle Eingabe. Kein Speicherauslesen (Anti-Cheat-Risiko).

## Stand (2026-11-25)
- Grundgerüst fertig und getestet: Core, Modul-System, Web-Shell, Module `status` und `controls` (Mock-Treiber)
- Nächste Schritte: Windows-Eingabetreiber, Hub-Anbindung, Org Storage
