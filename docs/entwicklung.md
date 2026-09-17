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
src/app/(app)       eingeloggter Bereich (Start, Wissen, Mitglieder, Meetings inkl. Call-Seite, Nachrichten, Notifications, Workflows, Profil, Community anlegen)
src/app/(public)    öffentliche Seiten mit breitem Rahmen: Meeting-Einladung /invite, Community-Beitritt /join
src/app/c/[slug]    Redirect-Route für teilbare Links: setzt die aktive Community und leitet weiter
src/app/admin       Verwaltung (Allgemein/Branding, Zweck, Webseiten*, Communities*, Mitglieder, Sammlungen, Meeting-Bereiche, Fragen, LLM, Workflows, Integrationen*, API-Schlüssel) – * nur in der Haupt-Community
src/app/api         auth (Better Auth), files (Medien), upload, events (SSE), mcp, livekit/webhook, health
src/server/auth     Better-Auth-Konfiguration, Session-Guards
src/server/db       Drizzle-Schema, Client, Migrate/Seed
src/server/domain   Fachlogik (communities, community-setup, community-invites, users, knowledge, meetings, integrations, messenger, notifications, questions, bot, api-keys)
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

## Mandanten (Communities)

Jede Zeile gehört genau einer Community; die Installation selbst ist die **Haupt-Community**
(`ROOT_COMMUNITY_ID = "default"`). Beim Arbeiten am Code sind drei Regeln wichtig:

1. **Die Community ist ein expliziter Parameter, meist der erste** (`listAreas(communityId)`).
   Kein impliziter Kontext – Worker, Workflow-Dispatcher und MCP haben keinen Request.
2. **Rechte stehen in `community_members`**, nicht in `users`. `user.role` aus den Guards ist die
   Rolle in der *aktiven* Community. Was dem Betreiber gehört (Integrationen, öffentliche Seiten,
   Modell-Fähigkeiten), schützt `requireRootAdmin()`/`assertRootAdmin()`.
3. **Funktionen, die per Id laden, prüfen die Zugehörigkeit** und antworten sonst `undefined` –
   dieselbe Antwort wie „gibt es nicht", damit Ids nicht über Community-Grenzen erratbar sind.

Lokal mit zwei Communities testen: eine zweite per SQL anlegen (`communities` + `community_members`),
dann über das Modal am Community-Namen wechseln. Details und Begründungen in `docs/communities.md`.

**Subdomains** (`COMMUNITY_SUBDOMAINS=true`) geben jeder Community einen eigenen Host
`<slug>.<app-host>`; produktiv braucht das Wildcard-DNS und ein Wildcard-Zertifikat
(`docs/communities.md` 7.5). Auf `localhost` funktioniert alles außer der geteilten Session – der
Browser nimmt kein Cookie für `.localhost`. Für den vollständigen Durchlauf einen Eintrag in
`/etc/hosts` (`127.0.0.1 aiup.test lesekreis.aiup.test`) setzen und `APP_URL=http://aiup.test:3000`.

**Eigene Domains** (`COMMUNITY_CUSTOM_DOMAINS=true`) tragen Community-Admins unter *Verwaltung →
Allgemein* ein. Sie wirken erst nach einem DNS-Nachweis (TXT `_aiup-verify.<host>` oder CNAME auf den
App-Host); bis dahin ist die Zeile sichtbar, aber wirkungslos. Weil ein Cookie keine registrierbare
Domain überquert, läuft die Anmeldung dort über den Handoff – `switchCommunityAction` schickt den
Browser über `/auth/handoff`. Lokal prüfbar, indem man eine Zeile mit gesetztem `verified_at` per SQL
anlegt (etwa für `127.0.0.1`, das einen eigenen Cookie-Speicher hat) – über die Oberfläche geht das
nicht, denn dort entscheidet DNS. Produktiv muss der Proxy den fremden Host annehmen
(`docs/communities.md` 7.10).

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
