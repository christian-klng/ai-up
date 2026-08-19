# AI-Up

Community-Plattform (Circle.so-artig) mit Wissensbereichen, Meetings (Nextcloud Talk), Messenger, Notifications und einem Workflow-„Maschinenraum" (Trigger/Aktionen, LLM, MCP). Vollständiger Plan: [PLAN.md](PLAN.md).

**Stand:** Phasen 1–3 und 5 umgesetzt – Registrierung mit Admin-Freigabe, Magic-Link-Login, App-Shell (de/en), Admin (Branding, Zweck, Mitglieder, Wissensbereiche, LLM-Provider, Workflows), Wissensbereiche mit versionierten Inhalten (Text/Bild/Video/Link), Realtime (SSE), Messenger mit Kontaktanfragen, Notification-Center, Workflow-Engine (Trigger/Aktionen, Worker, Toasts, Historie/Statistik), Fragen-Aktion mit Mini-Formular und `question.answered`-Trigger, MCP-Server mit API-Schlüsseln. Offen: Phase 4 (Meetings/Nextcloud Talk), Phase 7 (Härtung).

## Workflows (Maschinenraum)

- Definitionen (Trigger + Schritte) liegen in `workflows` (JSON), jede Änderung als Version in `workflow_versions`; Läufe in `workflow_runs` / `workflow_run_steps`.
- Registry: `src/server/workflows/triggers` (content.created, content.updated, schedule, manual) und `src/server/workflows/actions` (llm, read_webpage, notify_user, create_content). Neue Trigger/Aktionen = eine Datei mit zod-Schema, Feldbeschreibung (de/en) und `run()`.
- Ausführung im **Worker** (`npm run worker`, BullMQ-Queue `workflow-runs`); Zeit-Trigger als BullMQ Job Scheduler, Abgleich bei jeder Workflow-Änderung und beim Worker-Start.
- Templates: LiquidJS – `{{ trigger.* }}`, `{{ steps.<id>.output.* }}`, `{{ app.name }}`, `{{ app.purpose }}`.
- LLM: OpenAI-kompatible Provider unter Admin → LLM (Schlüssel AES-256-GCM-verschlüsselt mit `APP_ENCRYPTION_KEY`); Structured Output über `response_format` mit Fallback-Parsing.
- Realtime-Events `workflow.run.started/finished` → Toasts oben rechts (min. 2 s), Fehler-Notifications an Admins.
- Aktion `send_message`: Chat-Nachricht vom **System-Bot** (Name unter Verwaltung → Allgemein) an Empfänger; die Bot-Unterhaltung erscheint ohne Kontaktanfrage im Messenger. Antworten an den Bot feuern den Trigger `bot.message.received` (z. B. für LLM-Antworten).
- Aktion `ask_user`: erzeugt eine Frage (Umfrage/Bewertung/CTA), die Mitgliedern unten links als Mini-Formular erscheint; Antworten feuern den Trigger `question.answered` (Filter `questionKey`). Auswertung unter Verwaltung → Fragen.

## MCP-Server

- Endpunkt `POST /api/mcp` (Streamable HTTP, stateless), Auth `Authorization: Bearer aiup_…` (API-Schlüssel unter Verwaltung → API-Schlüssel; nur Admins, Scopes `workflows:read|write`, `runs:read|trigger`, `llm:read`, `questions:read`).
- Tools: `list_triggers`, `list_actions`, `describe_action`, `describe_trigger`, `list_llm_providers`, `list_llm_models`, `list_workflows`, `get_workflow`, `validate_workflow`, `create_workflow`, `update_workflow`, `set_workflow_status`, `delete_workflow`, `list_runs`, `get_run`, `trigger_workflow`, `get_workflow_stats`, `list_questions`, `get_question_results`. Resource `aiup://docs/workflow-schema`.
- Claude Code: `claude mcp add --transport http aiup https://<domain>/api/mcp --header "Authorization: Bearer <KEY>"`.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 + shadcn/ui · Drizzle ORM + PostgreSQL 16 · Better Auth (Magic Link) · next-intl · BullMQ + Redis · nodemailer · sharp · DiceBear.

## Lokale Entwicklung

Voraussetzungen: Node 24, Docker.

```bash
cp .env.example .env.local           # Werte anpassen (SEED_ADMIN_EMAIL, Secrets per `openssl rand -base64 32`)
docker compose -f docker-compose.dev.yml up -d   # Postgres :5432, Redis :6379, Mailpit :1025 (UI http://localhost:8025)
npm install
npm run db:migrate                   # Migrationen + Seed (erster Admin = SEED_ADMIN_EMAIL)
npm run dev                          # http://localhost:3000
npm run worker                       # in zweitem Terminal: BullMQ-Worker
```

Alle Mails (Magic Links!) landen im lokalen Mailpit unter http://localhost:8025.

### Nützliche Skripte

| Skript | Zweck |
|---|---|
| `npm run db:generate` | Neue Migration aus `src/server/db/schema.ts` erzeugen |
| `npm run db:migrate` | Migrationen anwenden + Seed |
| `npm run db:studio` | Drizzle Studio |
| `npm run typecheck` / `npm run lint` | Typen / ESLint |
| `npm run build` | Next.js Production-Build (standalone) |
| `npm run worker:build` | Worker + Migrate-Skript mit esbuild nach `dist/` bündeln |

## Projektstruktur (Auszug)

```
src/app/(auth)      Login, Registrierung, Warten-auf-Freigabe
src/app/(app)       eingeloggter Bereich (Start, Mitglieder, Profil, Notifications, Platzhalter)
src/app/admin       Verwaltung (Allgemein/Branding, Zweck, Mitglieder)
src/app/api         auth (Better Auth), files (Medien-Auslieferung), health
src/server/auth     Better-Auth-Konfiguration, Session-Guards
src/server/db       Drizzle-Schema, Client, Migrate/Seed
src/server/domain   Fachlogik (users, settings, notifications)
src/server/media    Storage (Volume), Bildpipeline, Avatare
src/server/mail     SMTP + Templates (de/en)
src/server/actions  Server Actions
src/i18n, messages  next-intl (de.json, en.json)
worker/             BullMQ-Worker-Entry
docker/             Dockerfile, entrypoint.sh
drizzle/            SQL-Migrationen
```

## Deployment auf Coolify

1. Repo in Coolify als **Docker Compose**-Ressource anlegen (`docker-compose.yml` im Root).
2. Umgebungsvariablen im Coolify-UI setzen (siehe `.env.example`): `APP_URL`, `SEED_ADMIN_EMAIL`, `BETTER_AUTH_SECRET`, `APP_ENCRYPTION_KEY`, `POSTGRES_PASSWORD`, `SMTP_*`.
3. Domain auf Service `web`, Port `3000` legen (Let's Encrypt über Coolify).
4. Deploy: `web` führt beim Start die Migrationen aus, `worker` startet danach. Health: `GET /api/health`.
5. Volumes `uploads`, `pgdata`, `redisdata` sind persistent; Backups über Coolify (Postgres) + Volume-Backup für `uploads`.

## Sicherheit (Phase 1)

- Nur Magic-Link-Login (15 Min gültig, Einmalnutzung, Token gehasht gespeichert), keine Konto-Enumeration.
- `pending`/`suspended` Konten werden serverseitig auf `/pending` geleitet; Admin-Routen und Server Actions prüfen Rolle erneut.
- Uploads werden neu kodiert (WebP), SVG nur für Admin-Logos mit Sanitizer-Check; Auslieferung über `/api/files/:id` (Branding/Avatare öffentlich, Rest nur mit Session).
