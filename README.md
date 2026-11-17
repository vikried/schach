# Schachbretter – Home-Assistant-Add-on

Schachpartien nach den Regeln spielen und mehrere Bretter verwalten. Änderungen werden live an alle offenen Browser verteilt.

- **Nur regelkonforme Züge**: abwechselnd Weiß/Schwarz, Rochade (König zwei Felder ziehen), en passant, Bauernumwandlung mit Figurenauswahl. Schach, Matt, Patt und Remis durch zu wenig Material werden erkannt; dreifache Wiederholung und 50-Züge-Regel werden angezeigt. Der Server prüft jeden Zug.
- **Bedienung**: Figur ziehen oder antippen – erlaubte Felder werden markiert, der letzte Zug ist hervorgehoben.
- **Zurück / Vor** (auch mit ← →): jeder Schritt pro Brett lässt sich rückgängig machen. Der Verlauf liegt auf dem Server und gilt für alle Geräte.
- **Letzter Zug in Notation** unter dem Brett, z. B. `12. ♘xe5+`, `O-O`, `e8=♕#`.
- **Stellung bearbeiten**: Figuren frei setzen und entfernen, festlegen, wer am Zug ist und welche Rochaden noch erlaubt sind. Bei „Fertig“ wird geprüft, ob die Stellung spielbar ist (je ein König, keine Bauern auf Grundreihe, der Spieler, der nicht am Zug ist, steht nicht im Schach).

## Installation in Home Assistant

1. **Einstellungen → Add-ons → Add-on-Store → ⋮ → Repositories**
2. `https://github.com/vikried/schach` hinzufügen
3. Add-on **Schachbretter** installieren und starten
4. Unter **Konfiguration** ein `admin_password` setzen und das Add-on neu starten
5. Optional: „In Seitenleiste anzeigen“ aktivieren

## Zugriffsschutz

- Über die Home-Assistant-Seitenleiste (Ingress) ist kein extra Passwort nötig – dort bist du schon angemeldet.
- Jeder andere Zugriff (z. B. per Cloudflare-Tunnel) verlangt das Admin-Passwort. Die Anmeldung bleibt 30 Tage gültig.
- Nach 10 Fehlversuchen wird eine IP 15 Minuten gesperrt.
- Ein neues Passwort meldet alle bestehenden Sitzungen ab.
- Ohne gesetztes Passwort ist die App nur über Home Assistant erreichbar.

Die Bretter werden im persistenten Add-on-Verzeichnis `/data` gespeichert.

## Lokal starten

```bash
ADMIN_PASSWORD=test node schachbretter/server.js
```

(Windows PowerShell: `$env:ADMIN_PASSWORD="test"; node schachbretter/server.js`)

Dann http://localhost:8099 öffnen.
