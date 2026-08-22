# AI-Up

Selbst gehostete Community-Plattform nach dem Vorbild von Circle.so – mit einem „Maschinenraum“, in dem Admins Automatisierungen (Workflows) mit LLM-Aktionen bauen und per MCP aus Claude Code heraus pflegen können.

## Was die App kann

- **Mitglieder & Login** – Registrierung mit Freigabe durch einen Admin, Login ausschließlich per Magic Link, Profile mit Foto oder zufälligem Avatar, Mitgliederübersicht.
- **Wissensbereiche** – vom Admin angelegte Kategorien mit Zweck; Inhalte als Markdown, Bild, Video oder Link (Upload oder URL), jede Änderung versioniert mit Verlauf und Wiederherstellen.
- **Messenger & Benachrichtigungen** – Kontaktanfrage → bestätigen → chatten (live, mit Gelesen-Status, Tipp-Indikator, Bild-Anhängen), Notification-Center, Zähler an Nachrichten- und Glocken-Icon.
- **System-Bot** – schickt Nachrichten aus Workflows in den Messenger; Antworten an den Bot können Workflows auslösen.
- **Workflows** – Trigger (Inhalt erstellt/aktualisiert, Zeitplan, Frage beantwortet, Nachricht an den Bot, manuell) + Aktionen (LLM über OpenAI-kompatible Endpunkte wie OpenRouter/Cortecs, Webseite lesen, Benachrichtigung, Bot-Nachricht, Inhalt anlegen, Frage stellen). Live-Toasts, Historie und Statistik; Mitglieder sehen jede Definition.
- **Fragen & Umfragen** – Mini-Formulare unten links (Auswahl, Text, Bewertung, Ja/Nein, Call-to-Action) mit Auswertung.
- **MCP-Server** – API-Schlüssel für Admins; Workflows per Claude Code einsehen, anlegen, ändern, starten.
- **Zweisprachig** (Deutsch/Englisch), Branding (Name, Logo, Favicon, Farbschema) durch den Admin.

Geplant: Meeting-Bereiche mit Nextcloud-Talk-Calls und Audio-Mitschnitt (siehe [PLAN.md](PLAN.md)).

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind v4 + shadcn/ui · PostgreSQL + Drizzle · Redis + BullMQ (Worker) · Better Auth · next-intl · Docker Compose (Coolify)

## Schnellstart

```bash
cp .env.example .env.local                         # Secrets/SEED_ADMIN_EMAIL setzen
docker compose -f docker-compose.dev.yml up -d     # Postgres, Redis, Mailpit (http://localhost:8025)
npm install && npm run db:migrate
npm run dev                                        # http://localhost:3000
npm run worker                                     # zweites Terminal: Workflow-Worker
```

Magic-Link-Mails landen lokal in Mailpit. Der erste Admin ist die Adresse aus `SEED_ADMIN_EMAIL`.

## Dokumentation

- [docs/entwicklung.md](docs/entwicklung.md) – lokale Entwicklung, Skripte, Projektstruktur, Deployment auf Coolify, Sicherheit
- [docs/workflows.md](docs/workflows.md) – Workflow-Engine, Trigger/Aktionen, LLM-Provider, MCP-Server
- [docs/meetings-livekit.md](docs/meetings-livekit.md) – Media-Server (LiveKit) auf Coolify einrichten, Spike & Lasttest
- [PLAN.md](PLAN.md) – Architektur- und Umsetzungsplan mit Phasen

## Lizenz

Noch nicht festgelegt.
