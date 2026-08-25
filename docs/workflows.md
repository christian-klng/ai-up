# Workflows & MCP

Technische Referenz zum „Maschinenraum“. Nutzersicht: Verwaltung → Workflows / LLM / Fragen / API-Schlüssel.

## Workflow-Engine

- Definitionen (Trigger + Schritte) liegen in `workflows` (JSON), jede Änderung als Version in `workflow_versions`; Läufe in `workflow_runs` / `workflow_run_steps`.
- Registry: `src/server/workflows/triggers` (content.created, content.updated, schedule, manual, question.answered, bot.message.received, member.registered, member.approved, meeting.started, meeting.ended, meeting.recording.available) und `src/server/workflows/actions` (llm, read_webpage, notify_user, send_message, create_content, ask_user). Neue Trigger/Aktionen = eine Datei mit zod-Schema, Feldbeschreibung (de/en) und `run()`.
- Ausführung im **Worker** (`npm run worker`, BullMQ-Queue `workflow-runs`); Zeit-Trigger als BullMQ Job Scheduler, Abgleich bei jeder Workflow-Änderung und beim Worker-Start.
- Templates: LiquidJS – `{{ trigger.* }}`, `{{ steps.<id>.output.* }}`, `{{ app.name }}`, `{{ app.purpose }}`.
- LLM: OpenAI-kompatible Provider unter Admin → LLM (Schlüssel AES-256-GCM-verschlüsselt mit `APP_ENCRYPTION_KEY`); Structured Output über `response_format` mit Fallback-Parsing.
- Realtime-Events `workflow.run.started/finished` → Toasts oben rechts (min. 2 s), Fehler-Notifications an Admins.
- Aktion `send_message`: Chat-Nachricht vom **System-Bot** (Name unter Verwaltung → Allgemein) an Empfänger; die Bot-Unterhaltung erscheint ohne Kontaktanfrage im Messenger. Antworten an den Bot feuern den Trigger `bot.message.received` (z. B. für LLM-Antworten).
- Aktion `ask_user`: erzeugt eine Frage (Umfrage/Bewertung/CTA), die Mitgliedern unten links als Mini-Formular erscheint; Antworten feuern den Trigger `question.answered` (Filter `questionKey`). Auswertung unter Verwaltung → Fragen.

## MCP-Server

- Endpunkt `POST /api/mcp` (Streamable HTTP, stateless), Auth `Authorization: Bearer aiup_…` **oder** `x-api-key: aiup_…` (API-Schlüssel unter Verwaltung → API-Schlüssel; nur Admins, Scopes `workflows:read|write`, `runs:read|trigger`, `llm:read`, `questions:read`, `landing:read|write`, `knowledge:read|write`).
- Sammlungen per MCP (`knowledge:read|write`): `list_collections`, `get_structure`, `validate_structure`, `save_structure`, `delete_structure`, `list_entries`, `get_entry`, `create_entry`, `update_entry`. Format und Regeln liefert die dynamische Resource `aiup://docs/collections`. Strukturierte Sammlungen verlangen `answers` (Element-Key → Antwort, validiert wie im UI); Autor ist der Schlüssel-Inhaber. Bild-/Video-Einträge lassen sich nicht per MCP anlegen (Upload nötig). `x-api-key` ist für claude.ai-Custom-Connectors gedacht: Dort ist der `Authorization`-Header für OAuth reserviert, im Dialog unter „Request headers" also `x-api-key` mit dem rohen Schlüssel (ohne „Bearer") eintragen.
- Tools: `list_triggers`, `list_actions`, `describe_action`, `describe_trigger`, `list_llm_providers`, `list_llm_models`, `list_workflows`, `get_workflow`, `validate_workflow`, `create_workflow`, `update_workflow`, `set_workflow_status`, `delete_workflow`, `list_runs`, `get_run`, `trigger_workflow`, `get_workflow_stats`, `list_questions`, `get_question_results`, `get_landing_page`, `validate_landing_page`, `update_landing_page`, `list_landing_page_versions`, `restore_landing_page_version`, `set_landing_enabled`, `list_landing_media`. Resources `aiup://docs/workflow-schema`, `aiup://docs/landing-page`.
- Landing Page: strukturierte Sektionen (zod-validiert, versioniert in `landing_page_versions`); Design-Regeln + aktuelle App-Variablen (Name, Zweck, Theme) liefert die Resource `aiup://docs/landing-page` dynamisch. Aktivierung unter Verwaltung → Landing Page oder per `set_landing_enabled`.
- Claude Code: `claude mcp add --transport http aiup https://<domain>/api/mcp --header "Authorization: Bearer <KEY>"`.

