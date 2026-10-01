# SV-Portal – Mauritius-Gymnasium Büren

Koordinations-Website für die Schülervertretung: Sitzungen mit Tagesordnung und Protokoll, Projekte mit Aufgaben, Abstimmungen, Dateien, Pinnwand und SV-Kasse. Konten entstehen nur über Einladungen der SV-Lehrkräfte, ohne E-Mail-Adressen.

Technik: Node.js 22, Express, SQLite (eine Datei), kein Build-Schritt, keine externen Dienste, keine Tracker, Schriften lokal eingebunden.

## Rollen

| Rolle | Darf |
|---|---|
| SV-Mitglied | Ideen und Projekte anlegen, Teams beitreten, Aufgaben, Termine (außer Sitzungen), Tagesordnungspunkte vorschlagen, Protokolle schreiben, Dateien hochladen, abstimmen, Pinnwand |
| SV-Vorstand | zusätzlich: Sitzungen planen, Tagesordnung sortieren, Abstimmungen starten und beenden, Kasse buchen, Beiträge anheften, alle Inhalte bearbeiten und löschen |
| Lehrkraft | zusätzlich: Einladungen erstellen, Rollen und Ämter vergeben, Passwörter zurücksetzen, Konten deaktivieren und löschen. Stimmt nur bei Abstimmungen mit, bei denen das eingestellt ist |

## Einrichtung auf dem Server

Voraussetzung: Docker mit Compose und ein Reverse Proxy mit HTTPS (Caddy oder nginx).

```bash
cp .env.example .env          # PUBLIC_URL auf die echte Adresse setzen
docker compose up -d --build
docker compose logs -f        # "SV-Portal läuft auf Port 3000"
```

Die App lauscht nur auf `127.0.0.1:3010`. Caddy, `Caddyfile`:

```
sv.mauri-tools.de {
    encode gzip
    request_body {
        max_size 30MB
    }
    reverse_proxy 127.0.0.1:3010
}
```

nginx, im `server`-Block mit TLS:

```nginx
client_max_body_size 30m;
location / {
    proxy_pass http://127.0.0.1:3010;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

`PUBLIC_URL` muss mit `https://` beginnen, sonst werden die Anmelde-Cookies nicht als „Secure“ gesetzt. Ohne Reverse Proxy `TRUST_PROXY=0` setzen, sonst lässt sich die Anmeldesperre über gefälschte Header umgehen.

## Erste Lehrkraft anlegen

```bash
docker compose exec sv-portal node src/cli.js lehrkraft-anlegen mueller "Herr Müller"
```

Ausgabe ist ein Einmal-Passwort wie `wolke-tiger-482`. Beim ersten Anmelden wird ein eigenes Passwort festgelegt.

Die Kollegin lädst du danach im Portal ein: **Mitglieder → Einladen → Rolle „Lehrkraft“, für 1 Person**, Code oder Link persönlich weitergeben.

## Ablauf für die erste SV-Sitzung

1. **Mitglieder → Einladen**: Rolle „SV-Mitglied“, „Für wie viele Personen?“ = Anzahl im Raum, gültig 1 Tag.
2. Im Ergebnis-Fenster **Beamer-Ansicht** öffnen. Alle scannen den QR-Code oder geben unter `…/einladung` den Code ein und legen Name, Klasse, Nutzername und Passwort selbst fest.
3. Danach unter **Mitglieder** bei den Schülersprecherinnen und -sprechern über das Menü **Bearbeiten** die Rolle „SV-Vorstand“ und das Amt eintragen (z. B. „Schülersprecherin“, „Kasse“).
4. Nicht genutzte Einladungen unter „Offene Einladungen“ zurückziehen.

## Passwort vergessen

**Mitglieder → Passwort zurücksetzen** bei der Person. Das Portal zeigt ein Einmal-Passwort an, das du persönlich weitergibst. Die Person wird auf allen Geräten abgemeldet und legt beim nächsten Login ein eigenes Passwort fest. Eine Anmeldesperre nach Fehlversuchen wird dabei aufgehoben.

Notfall, wenn keine Lehrkraft mehr hineinkommt:

```bash
docker compose exec sv-portal node src/cli.js passwort-zuruecksetzen <nutzername>
docker compose exec sv-portal node src/cli.js konten
```

## Sicherung

Alle Daten liegen im Docker-Volume `sv-data` (Datenbank plus Ordner `files/`).

```bash
# konsistente Datenbank-Kopie im laufenden Betrieb nach /data/sicherungen/
docker compose exec sv-portal node src/cli.js sicherung
# komplettes Volume als Archiv ins aktuelle Verzeichnis
docker run --rm -v sv-portal_sv-data:/data:ro -v "$PWD":/backup alpine \
  tar czf /backup/sv-portal-$(date +%F).tgz -C /data .
```

Wiederherstellen: Container stoppen, Archiv ins Volume entpacken, Container starten. Den Volume-Namen zeigt `docker volume ls`.

## Aktualisieren

```bash
docker compose up -d --build
```

Die Datenbank bleibt erhalten, neue Tabellen legt die App beim Start selbst an.

## Schuljahreswechsel

Die SV wird jedes Jahr neu gewählt. Ausgeschiedene Mitglieder unter **Mitglieder → Menü → Deaktivieren** sperren: Ihre Beiträge, Protokolle und Dateien bleiben erhalten, sie können sich aber nicht mehr anmelden. Die neue SV lädst du wie oben ein.

## Datenschutz

- Gespeichert werden Nutzername, Anzeigename, Klasse, Rolle, Amt, Zeitpunkt der letzten Anmeldung und die Inhalte, die im Portal angelegt werden. Keine E-Mail-Adressen, keine Tracker, keine externen Schriften oder Skripte.
- Passwörter werden mit scrypt gehasht. Sitzungen liegen als Hash in der Datenbank.
- Anonyme Abstimmungen speichern nur, wer teilgenommen hat, und eine Zählung pro Antwort. Welche Person was gewählt hat, ist nicht rekonstruierbar.
- Hochgeladene Dateien werden nie als Webseite ausgeliefert (HTML, SVG usw. nur als Download), damit über Uploads kein Schadcode im Portal laufen kann.
- Die Seite ist für Suchmaschinen gesperrt (`noindex`).
- Vor dem Einsatz mit Schulleitung und Datenschutzbeauftragter abstimmen. Läuft das Portal auf einem privaten Server oder über einen Dienstleister, ist ein Auftragsverarbeitungsvertrag mit dem Schulträger nötig.

## Konfiguration (`.env`)

| Variable | Standard | Bedeutung |
|---|---|---|
| `PUBLIC_URL` | `http://localhost:3000` | Öffentliche Adresse, wird in Einladungslinks, QR-Codes und Kalender-Abos verwendet |
| `SITE_NAME` | `SV-Portal` | Name in Kopfzeile und Browser-Tab |
| `SCHOOL_NAME` | `Mauritius-Gymnasium Büren` | Untertitel in der Seitenleiste |
| `MAX_UPLOAD_MB` | `25` | Maximale Größe pro Datei |
| `SESSION_DAYS` | `30` | Anmeldedauer, verlängert sich bei Nutzung |
| `TRUST_PROXY` | `1` | Anzahl Reverse-Proxys vor der App, ohne Proxy `0` |
| `CALENDAR_FEED` | `true` | Persönlicher Kalender-Abo-Link (ICS) im Profil |
| `DATA_DIR` | `/data` (Docker) | Ort für Datenbank und Dateien |

## Lokal entwickeln

```bash
npm install
node src/cli.js lehrkraft-anlegen test "Test Lehrkraft"
npm start                     # http://localhost:3000, Daten in ./data
```

## Aufbau

```
src/server.js        Express, Sicherheits-Header, Routing
src/db.js            SQLite-Schema
src/auth.js          Passwörter, Sitzungen, Rechte, Anmeldesperre
src/routes/*.js      API: Konten, Mitglieder, Termine, Projekte, Abstimmungen, Dateien, Kasse, Pinnwand, Kalender-Abo
src/cli.js           Kommandozeile: Lehrkraft anlegen, Notfall-Reset, Sicherung
public/js/app.js     Router und Grundgerüst der Oberfläche
public/js/views/     Seiten der Oberfläche
public/css/app.css   Gestaltung (hell und dunkel)
```
