# AI-Up

Selbst gehostete Community-Plattform nach dem Vorbild von Circle.so – mit einem „Maschinenraum“, in dem Admins Automatisierungen (Workflows) mit LLM-Aktionen bauen und per MCP aus Claude Code heraus pflegen können.

## Was die App kann

- **Mitglieder & Login** – Registrierung mit Freigabe durch einen Admin, Login ausschließlich per Magic Link, Profile mit Foto oder zufälligem Avatar, Mitgliederübersicht.
- **Sammlungen** – vom Admin angelegte Kategorien mit Zweck; jede Änderung versioniert mit Verlauf und Wiederherstellen. Inhalte entstehen über **Vorlagen**: vom Admin separat verwaltete, visuell zusammengestellte Formulare (Texte, Bilder, Links, Videos, Fragen, Chips, Dropdowns, Checkboxen, Frage-Antwort-Paare, editierbares Prozessdiagramm mit Verzweigungen), die pro Sammlung zugewiesen werden – ohne Zuweisung gelten nicht löschbare Standard-Vorlagen (einfacher Text, Bild, Link, Video). Mitglieder wählen beim Anlegen aus der Vorlagen-Liste; wird eine Vorlage aktualisiert, können Einträge beim Bearbeiten auf die neue Fassung gehoben werden. Jeder Eintrag wird deterministisch zu Markdown (inkl. Mermaid-Flowchart) und ist als `.md` exportierbar – z. B. als Rohmaterial für System Prompts oder Skill-Dateien.
- **Messenger & Benachrichtigungen** – Kontaktanfrage → bestätigen → chatten (live, mit Gelesen-Status, Tipp-Indikator, Bild-Anhängen), Notification-Center, Zähler an Nachrichten- und Glocken-Icon.
- **Meetings** – Meeting-Bereiche mit Zweck; Meetings als Protokoll (versioniertes Markdown, gemeinsam schreibbar), **Audio- oder Video-Call direkt in der App** (selbst gehosteter LiveKit-Server, Screen-Share, Chat), grün blinkender Live-Punkt im Menü, Teilnehmerliste, automatischer **Audio-Mitschnitt** als Player am Meeting.
- **System-Bot** – schickt Nachrichten aus Workflows in den Messenger; Antworten an den Bot können Workflows auslösen.
- **Workflows** – Trigger (Inhalt erstellt/aktualisiert, Zeitplan, Frage beantwortet, Nachricht an den Bot, neue Registrierung, neues Mitglied, Meeting gestartet/beendet, Aufzeichnung verfügbar, manuell) + Aktionen (LLM über OpenAI-kompatible Endpunkte wie OpenRouter/Cortecs, Webseite lesen, Benachrichtigung, Bot-Nachricht, Inhalt anlegen, Frage stellen). Live-Toasts, Historie und Statistik; Mitglieder sehen jede Definition.
- **Fragen & Umfragen** – Mini-Formulare unten links (Auswahl, Text, Bewertung, Ja/Nein, Call-to-Action) mit Auswertung.
- **Webseiten** – optionale öffentliche Seiten: Landing Page auf `/` (sonst geht es direkt zum Login), Impressum (`/imprint`) und Datenschutz (`/privacy`), jeweils separat aktivierbar. Aufgebaut aus strukturierten Sektionen (Hero, Features, Text, CTA, FAQ, Bild), übernehmen Farbschema und Logo automatisch; Inhalte werden per MCP gepflegt (z. B. mit Claude Code) oder direkt in der Vorschau bearbeitet und sind versioniert mit Wiederherstellen.
- **MCP-Server** – API-Schlüssel für Admins; Workflows und Landing Page per Claude Code einsehen, anlegen, ändern, starten.
- **Zweisprachig** (Deutsch/Englisch), Branding (Name, Logo, Favicon, Farbschema) durch den Admin.

Läuft produktiv auf zwei VPS: die App auf dem einen, der Media-Server für Calls und Aufzeichnungen auf dem anderen. Offen: Lasttest mit 30 Teilnehmenden sowie Härtung, Tests und Sicherheits-Review (siehe [PLAN.md](PLAN.md), Phasen 4f und 7).

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind v4 + shadcn/ui · PostgreSQL + Drizzle · Redis + BullMQ (Worker) · Better Auth · next-intl · LiveKit (Calls & Aufzeichnung) · Docker Compose (Coolify)

## Schnellstart

```bash
cp .env.example .env.local                         # Secrets/SEED_ADMIN_EMAIL setzen
docker compose -f docker-compose.dev.yml up -d     # Postgres, Redis, Mailpit (http://localhost:8025)
npm install && npm run db:migrate
npm run dev                                        # http://localhost:3000
npm run worker                                     # zweites Terminal: Workflow-Worker
docker compose -f docker-compose.dev.yml --profile media up -d   # optional: LiveKit + Egress für Meetings
```

Magic-Link-Mails landen lokal in Mailpit. Der erste Admin ist die Adresse aus `SEED_ADMIN_EMAIL`.

## Dokumentation

- [docs/entwicklung.md](docs/entwicklung.md) – lokale Entwicklung, Skripte, Projektstruktur, Deployment auf Coolify, Sicherheit
- [docs/workflows.md](docs/workflows.md) – Workflow-Engine, Trigger/Aktionen, LLM-Provider, MCP-Server
- [docs/meetings-livekit.md](docs/meetings-livekit.md) – Media-Server (LiveKit) auf Coolify einrichten, Webhook/Aufzeichnungen, Spike & Lasttest
- [PLAN.md](PLAN.md) – Architektur- und Umsetzungsplan mit Phasen

## Lizenz

[GNU Affero General Public License v3.0](LICENSE). Für eine selbst gehostete Anwendung bewusst die AGPL und
nicht die GPL: Wer AI-Up verändert und die geänderte Fassung über ein Netzwerk als Dienst anbietet, muss deren
Quellcode zugänglich machen – auch ohne die Software selbst weiterzugeben.
