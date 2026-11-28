# Black Halo Tool

Begleit-App für Star Citizen unter Windows. Läuft im Tray neben dem Spiel, stellt die Oberfläche fürs Handy oder Tablet im eigenen WLAN bereit und hat ein Fenster, z. B. für den zweiten Bildschirm.

## Funktionen

- **Controls:** Knöpfe auf Handy oder Tablet lösen Tasten im Spiel aus (Fahrwerk, Energie, ...). Frei belegbar.
- **Mining Companion:** Rechner für die Prospector. Zeigt, ob ein Stein brechbar ist, mit welcher Laserleistung und auf welche Entfernung (z. B. „45 % bei 39 m“), und welche Gadgets passen.
  - **Scan einlesen:** liest das Scan-Panel per Texterkennung vom Bildschirm (Knopf „Am PC einlesen“ am Handy). Unsichere Werte werden gelb markiert.
  - **Radar-Signatur:** deutet die Zahl vom Radar (z. B. 16.960 = Kupfer ×4), auch live vom Bildschirm.
  - **Overlay:** zeigt die Deutung der Signaturen direkt neben den Markern über dem Spiel.
- **Sprunghilfen (Aaron Halo):** Start und Ziel in Stanton wählen, das Tool sagt, bei welcher Restentfernung im HUD du den Quantum-Sprung abbrichst, um mitten im Asteroidengürtel zu landen (z. B. MIC-L1 -> Hurston: „Bei 13,2 Gm abbrechen“, Band 5). Mit Vorschlägen für Ziele, deren Route durch ein bestimmtes Band führt.
- **Sync:** PC, Handy und zweiter Bildschirm zeigen denselben Stand.
- **Dev:** Schalter für die Entwicklung, z. B. ob Scans als Bild gespeichert werden (Standard aus).

Voraussetzungen: Windows und Star Citizen im Modus „Randloses Fenster“. Texterkennung und Overlay brauchen 1920×1080 und das englische HUD.

## Installieren

1. Unter [Releases](https://github.com/Miroxx80/BlackHaloEnterpriseCompanion/releases/latest) `BlackHalo-Setup-x.y.z.exe` herunterladen und ausführen. Admin-Rechte sind nicht nötig.
2. Windows zeigt beim ersten Mal „Der Computer wurde durch Windows geschützt“, weil der Installer nicht kostenpflichtig signiert ist: **Weitere Informationen**, dann **Trotzdem ausführen**.
3. Beim ersten Start fragt die Windows-Firewall nach Netzwerkzugriff: für **private Netzwerke** erlauben (nötig für Handy und Tablet).
4. Handy verbinden: im Fenster auf „Verbinden“ und den QR-Code scannen. Das Handy muss im selben WLAN sein.

## Updates

Das Tool sieht beim Start nach, ob es eine neue Version gibt, und meldet sie unten in der Seitenleiste. Installiert wird mit einem Klick unter „Status“ (geht auch vom Handy) oder im Tray-Menü. Danach startet das Tool neu. Einstellungen und Loadouts unter `%APPDATA%\BlackHalo` bleiben erhalten.

Die Versionen 0.1.0 und 0.2.0 haben noch keinen Update-Knopf. Von dort einmal den neuen Installer von Hand über die alte Version installieren.

## Sicherheit und Spielregeln

- Das Tool liest **keinen Spielspeicher**, schleust nichts ins Spiel ein und ändert keine Spieldateien. Es sieht nur den Bildschirm, wie ein Screenshot.
- **Nur anzeigen, nie steuern:** Ein Knopfdruck ist genau eine Tastenaktion. Es gibt keine Automatik und keine Verbindung zwischen Texterkennung und Tastendrücken.
- Tasten gehen nur an Star Citizen. Ist das Spiel nicht im Vordergrund, wird nichts gesendet.
- Alles läuft lokal auf deinem PC. Es werden keine Daten an fremde Server geschickt, außer der Update-Abfrage bei GitHub.

## Mehr

- [Anleitung](docs/ANLEITUNG.md): Tasten anpassen, Mining im Detail
- [Entwicklung](docs/ENTWICKLUNG.md): selbst bauen, Releases, Architektur, eigene Module

## Hinweise

Black Halo ist ein inoffizielles Fanprojekt und steht in keiner Verbindung zur Cloud-Imperium-Unternehmensgruppe. Star Citizen®, Roberts Space Industries® und Cloud Imperium® sind Marken der Cloud Imperium Rights LLC. Spieldaten und Screenshots aus dem Spiel gehören ihren jeweiligen Eigentümern. Das Tool ist kostenlos und nicht kommerziell.

**Lizenz:** Alle Rechte vorbehalten. Der Code ist nur zum Ansehen veröffentlicht. Das Tool darf jeder kostenlos privat nutzen, Kopieren, Ändern und Weitergeben des Codes sind nicht erlaubt. Details in [LICENSE](LICENSE). Pull Requests von außen werden nicht angenommen.

**Datenquellen und Dank:**
- Spieldaten (Star Citizen 4.10.3) über [scunpacked-data](https://github.com/StarCitizenWiki/scunpacked-data) (StarCitizenWiki, ScDataDumper von octfx). Spieldaten © Cloud Imperium Games.
- Das Bruchmodell folgt den veröffentlichten Messungen von [Bedrock](https://github.com/SC-Ravaxx/Bedrock) (SC-Ravaxx). Code aus Bedrock wird nicht verwendet.
- Aaron Halo: Lage und Dicke der Bänder aus der Vermessung von CaptSheppard / Cornerstone ([cstone.space](https://cstone.space), Alpha 3.16.1). Danke für die Arbeit.
- Texterkennung: [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) PP-OCRv4 (Apache-2.0).
- Schriften: Barlow Condensed und JetBrains Mono (SIL Open Font License).
