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
- **Repo bleibt privat.**
- **Zielbild:** Eine feste PC-Software (Electron). Hauptaufgabe: Schnittstelle zwischen Spiel und Tablet/Handy (lokaler Server im eigenen Netz), läuft meist unsichtbar im Tray. Zusätzlich ein normales Fenster, z. B. für den zweiten Bildschirm. Ein Overlay über dem Spiel ist optional und kommt später. Eine Handy-App kommt später (z. B. Capacitor mit derselben UI). Der Hub bleibt reines Node ohne Electron.
- **Overlay ohne Eingriff ins Spiel:** eigenes transparentes Fenster über dem Spiel, kein DirectX-Hook und kein Einschleusen in den Spielprozess (Anti-Cheat). Funktioniert nur im Modus „Randloses Fenster“. Das Overlay-Fenster nimmt keinen Fokus an, damit Tastendrücke weiter beim Spiel landen.
- **Tastendrücke nur ans Spiel:** Der Treiber prüft vor jedem Tastendruck, ob Star Citizen im Vordergrund ist, und holt es notfalls nach vorn. Gelingt das nicht, wird nichts gesendet und ein Fehler gemeldet. Nie blind in andere Fenster senden.

## Geplant (später)
- **Auto-Update über GitHub Releases:** GitHub Actions baut bei einem Versions-Tag ein Zip mit Prüfsumme und Signatur. Das Tool prüft auf neue Versionen, meldet sie in der UI und installiert erst nach Bestätigung. `config/local.json` und `data/` bleiben bei Updates erhalten. Da das Repo privat bleibt, kommen die Downloads aus einem separaten öffentlichen Release-Repo oder später vom Hub.
- **Electron-App:** Hauptprozess für Tray, Hotkeys, Fenster und Updates. Der bestehende Kern läuft als eigener Server-Prozess (`utilityProcess`) und wird bei einem Absturz neu gestartet. Das Overlay lädt die UI vom lokalen Server, ist also ein Client wie das Tablet. Installer per `electron-builder`, Updates per `electron-updater` (ersetzt den eigenen Launcher). Config und Daten liegen unter `%APPDATA%\BlackHalo`. Ohne Code-Signing-Zertifikat zeigt SmartScreen beim ersten Start eine Warnung.
- **Hintergrundbetrieb:** Autostart mit Windows (abschaltbar), startet ins Tray. Tray-Menü: Fenster öffnen, Gerät verbinden (QR-Code mit Adresse und Token), Update, Beenden. Fenster schließen heißt zurück ins Tray, der Server läuft weiter. Geschlossene Fenster werden beendet statt versteckt (RAM neben dem Spiel).
- **Hauptfenster:** frei verschieb- und skalierbar, merkt Position, Größe und Bildschirm, fällt auf den Hauptbildschirm zurück, wenn der Bildschirm fehlt. Optional „Immer im Vordergrund“. In der Controls-Ansicht nimmt es keinen Fokus an, in Ansichten mit Eingabefeldern schon.
- **Overlay (optional, später):** passiv (durchklickbar, nur Anzeige) und aktiv (per globalem Hotkey, Buttons klickbar).

## Stand (2026-11-25)
- Grundgerüst fertig und getestet: Core, Modul-System, Web-Shell, Module `status` und `controls` (Mock-Treiber)
- Nächste Schritte: Windows-Eingabetreiber, Hub-Anbindung, Org Storage
