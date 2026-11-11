# Schachbretter – Home-Assistant-Add-on

Schachbretter verwalten und Stellungen festhalten (ohne Schachlogik). Änderungen werden live an alle offenen Browser verteilt.

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
