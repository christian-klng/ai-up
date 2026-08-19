@AGENTS.md

# AI-Up – Projekthinweise

- Plan & Phasen: `PLAN.md` (Abschnitt 11 = Reihenfolge; Stand siehe `README.md`). Entwickler-Doku: `docs/entwicklung.md`, Workflows/MCP: `docs/workflows.md`.
- Sprache: UI-Texte immer in `messages/de.json` **und** `messages/en.json` pflegen (next-intl, kein URL-Prefix, Cookie `aiup_locale`). Achtung ICU: keine `{{ }}`/`<tag>` in Übersetzungsstrings (bricht das Message-Format). Code, Kommentare, MCP-Felder, Trigger-/Aktions-IDs, LLM-Instruktionen: Englisch; Labels dazu `{ de, en }`.
- Auth: Better Auth (nur Magic Link). Registrierung ist ein eigener Flow (`registerUser`, Status `pending`); Guards über `requireUser()/requireAdmin()` (Pages) bzw. `assertUser()/assertAdmin()` (Server Actions). `src/proxy.ts` ist nur ein Cookie-Gate, keine Autorisierung. MCP-Auth: API-Keys (`src/server/domain/api-keys.ts`, Scopes).
- DB: Drizzle, Schema in `src/server/db/schema.ts`, Spalten snake_case (casing). Nach Schemaänderung: `npm run db:generate` (Migration committen) und `npm run db:migrate`. Korrelierte Subqueries: Spalten explizit qualifizieren (`${table}."col"`).
- Medien: nie überschreiben – neue `media_files`-Zeile pro Version; Auslieferung über `/api/files/:id`; Upload nur über `/api/upload` (Magic-Bytes-Prüfung). Nutzer-URLs nur über `safeFetch` (SSRF-Schutz).
- Events: Fachlogik emittiert Domain-Events über `emitDomainEvent()` (`src/server/events/bus.ts`); der Bus ruft den Workflow-Dispatcher auf. Realtime an Clients ausschließlich über `publishToUser/publishBroadcast` (`src/server/realtime/publish.ts`, Typen in `src/lib/realtime-events.ts`); Client-Abos per `useRealtimeEvent()`.
- Workflows: neue Trigger/Aktionen als Registrierung in `src/server/workflows/triggers|actions/index.ts` (zod-Config, `fields` für den Editor, englisches `doc`, `run()`); Templates sind LiquidJS. Seiteneffekte aus Workflows mit `origin: { kind: "workflow" }` taggen (Schleifenschutz). System-Bot: `src/server/domain/bot.ts` (`BOT_USER_ID`), Bot aus Nutzerlisten/Audiences ausschließen (`users.isBot`).
- Shared Server-Code (`src/server/**`) darf nichts aus `next/*` oder React importieren, wenn er auch im Worker (`worker/`) läuft (Ausnahme: `react`'s `cache` in `domain/settings.ts`, Worker nutzt `loadAppSettings`); `server-only` nur in Next-spezifischen Modulen (z. B. `src/server/auth/session.ts`). BullMQ-Job-IDs dürfen kein `:` enthalten.
- Prüfen vor Abschluss: `npm run typecheck && npm run lint && npm run build && npm run worker:build`. Multi-User-Tests lokal: zweite Identität über `http://127.0.0.1:3000` (eigene Cookies).
