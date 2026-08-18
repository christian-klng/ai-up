@AGENTS.md

# AI-Up – Projekthinweise

- Plan & Phasen: `PLAN.md` (Abschnitt 11 = Reihenfolge). Setup/Betrieb: `README.md`.
- Sprache: UI-Texte immer in `messages/de.json` **und** `messages/en.json` pflegen (next-intl, kein URL-Prefix, Cookie `aiup_locale`). Code, Kommentare, MCP-Felder, LLM-Instruktionen: Englisch.
- Auth: Better Auth (nur Magic Link). Registrierung ist ein eigener Flow (`registerUser`, Status `pending`); Guards über `requireUser()/requireAdmin()` (Pages) bzw. `assertUser()/assertAdmin()` (Server Actions). `src/proxy.ts` ist nur ein Cookie-Gate, keine Autorisierung.
- DB: Drizzle, Schema in `src/server/db/schema.ts`, Spalten snake_case (casing). Nach Schemaänderung: `npm run db:generate` (Migration committen) und `npm run db:migrate`.
- Medien: nie überschreiben – neue `media_files`-Zeile pro Version; Auslieferung über `/api/files/:id`.
- Shared Server-Code (`src/server/**`) darf nichts aus `next/*` oder React importieren, wenn er auch im Worker (`worker/`) läuft; `server-only` nur in Next-spezifischen Modulen (z. B. `src/server/auth/session.ts`).
- Prüfen vor Abschluss: `npm run typecheck && npm run lint && npm run build`.
