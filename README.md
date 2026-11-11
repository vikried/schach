# Schachbretter – Home-Assistant-Add-on

Schachbretter verwalten und Stellungen festhalten (ohne Schachlogik). Änderungen werden live an alle offenen Browser verteilt.

## Installation in Home Assistant

1. **Einstellungen → Add-ons → Add-on-Store → ⋮ → Repositories**
2. `https://github.com/vikried/schach` hinzufügen
3. Add-on **Schachbretter** installieren und starten
4. Optional: „In Seitenleiste anzeigen“ aktivieren

Die Bretter werden im persistenten Add-on-Verzeichnis `/data` gespeichert.

## Lokal starten

```bash
node schachbretter/server.js
```

Dann http://localhost:8099 öffnen.
