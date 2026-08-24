# Entwicklung & Betrieb

## Lokale Entwicklung

Voraussetzungen: Node 24, Docker.

```bash
cp .env.example .env.local           # Werte anpassen (SEED_ADMIN_EMAIL, Secrets per `openssl rand -base64 32`)
docker compose -f docker-compose.dev.yml up -d   # Postgres :5432, Redis :6379, Mailpit :1025 (UI http://localhost:8025)
npm install
npm run db:migrate                   # Migrationen + Seed (erster Admin = SEED_ADMIN_EMAIL)
npm run dev                          # http://localhost:3000
npm run worker                       # in zweitem Terminal: BullMQ-Worker
docker compose -f docker-compose.dev.yml --profile media up -d   # optional: LiveKit + Egress (Meetings), siehe docs/meetings-livekit.md
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
src/app/(app)       eingeloggter Bereich (Start, Wissen, Mitglieder, Meetings inkl. Call-Seite, Nachrichten, Notifications, Workflows, Profil)
src/app/admin       Verwaltung (Allgemein/Branding, Zweck, Mitglieder, Sammlungen, Meeting-Bereiche, Fragen, LLM, Workflows, Integrationen, API-Schlüssel)
src/app/api         auth (Better Auth), files (Medien), upload, events (SSE), mcp, livekit/webhook, health
src/server/auth     Better-Auth-Konfiguration, Session-Guards
src/server/db       Drizzle-Schema, Client, Migrate/Seed
src/server/domain   Fachlogik (users, settings, knowledge, meetings, integrations, messenger, notifications, questions, bot, api-keys)
src/server/meetings LiveKit-Glue (Token, Raum, Webhook-Verarbeitung, Aufzeichnung/Egress)
src/server/events   Domain-Event-Bus (→ Workflow-Dispatch)
src/server/realtime Redis-Pub/Sub → SSE
src/server/workflows Registry (triggers/actions), Engine, Queue/Scheduler, Katalog, Definitionen
src/server/llm      OpenAI-kompatibler Client, Provider-Verwaltung
src/server/mcp      MCP-Server (Tools/Resources)
src/server/webreader SSRF-sicherer Fetch, Link-Vorschau, Readability
src/server/media    Storage (Volume), Bildpipeline, Avatare
src/server/mail     SMTP + Templates (de/en)
src/server/actions  Server Actions
src/i18n, messages  next-intl (de.json, en.json)
worker/             BullMQ-Worker-Entry
deploy/livekit/     Compose-Vorlage + Konfiguration für den LiveKit-Media-Server (eigene Coolify-Ressource)
docker/             Dockerfile, entrypoint.sh
drizzle/            SQL-Migrationen
```

## Deployment auf Coolify

1. Repo in Coolify als **Docker Compose**-Ressource anlegen (`docker-compose.yml` im Root).
2. Umgebungsvariablen im Coolify-UI setzen (siehe `.env.example`): `APP_URL`, `SEED_ADMIN_EMAIL`, `BETTER_AUTH_SECRET`, `APP_ENCRYPTION_KEY`, `POSTGRES_PASSWORD`, `SMTP_*`.
3. Domain auf Service `web`, Port `3000` legen (Let's Encrypt über Coolify).
4. Deploy: `web` führt beim Start die Migrationen aus, `worker` startet danach. Health: `GET /api/health`.
5. Volumes `uploads`, `pgdata`, `redisdata` sind persistent; Backups über Coolify (Postgres) + Volume-Backup für `uploads`.

## Sicherheit

- Nur Magic-Link-Login (15 Min gültig, Einmalnutzung, Token gehasht gespeichert), keine Konto-Enumeration.
- `pending`/`suspended` Konten werden serverseitig auf `/pending` geleitet; Admin-Routen und Server Actions prüfen Rolle erneut.
- Uploads werden neu kodiert (WebP), SVG nur für Admin-Logos mit Sanitizer-Check; Auslieferung über `/api/files/:id` (Branding/Avatare öffentlich, Rest nur mit Session).
