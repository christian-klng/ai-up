# KI-Agenten (Planung, Stand 06.09.2026)

Planungsdokument für das Feature „KI-Agenten“: Chat-Oberfläche mit agentischem Loop und Werkzeugen,
Datenbasis sind die **Sammlungen**. Der System-Bot wird zum Standard-Agenten für alle Nutzer.

Stand: **Phasen A–D umgesetzt** (06.09.2026), Phasen E–G offen. Das Dokument enthält (1) die kritische
Prüfung gegen den Bestand, (2) das Zielbild, (3) Datenmodell und Module, (4) den Schnitt in Phasen,
(5) die getroffenen Entscheidungen.

---

## 1. Kritische Prüfung gegen die bestehende App

Zwölf Punkte, an denen die Idee auf den Bestand trifft. Ohne Entscheidung zu diesen Punkten wird die
Umsetzung teuer nachgearbeitet.

### 1.1 Es gibt bereits einen Bot-Chat – zwei Chats mit derselben Identität

Bestand: Die Aktion `send_message` schreibt als System-Bot in den Messenger, Antworten des Mitglieds
feuern den Trigger `bot.message.received` (`src/server/workflows/triggers/index.ts:162`). Damit kann heute
schon jemand mit „Assistent“ chatten – über Workflows verdrahtet.

Mit dem neuen Feature entstünde eine **zweite** Unterhaltung mit demselben Namen und Avatar, an anderer
Stelle, mit anderem Verhalten. Das ist für Mitglieder nicht erklärbar.

**Entscheidung (06.09.2026): Die Bot-Unterhaltung im Messenger wird empfangsseitig.**
Nachrichten an den Bot sind nicht mehr möglich, Unterhaltungen mit anderen Mitgliedern bleiben
unverändert. Damit sagt die Oberfläche selbst, wofür der Kanal da ist: Benachrichtigungen aus Workflows
lesen – gearbeitet wird beim KI-Agenten.

Umsetzung:
- `src/components/messenger/chat-thread.tsx`: Eingabefeld ausblenden, wenn `other.isBot` (die Flagge
  liegt schon vor, Zeile 20/197). Statt des Composers ein Hinweis mit Link auf `/agents`.
- **Serverseitig hart absichern**, nicht nur in der UI: `sendMessageAction`
  (`src/server/actions/messages.ts`) lehnt Nachrichten an `BOT_USER_ID` ab. Ohne das bleibt der Pfad
  über einen manuellen Request offen.
- Trigger `bot.message.received` wird damit unerreichbar → aus der Registry entfernen, samt Erwähnung in
  `docs/workflows.md` und `CLAUDE.md`. **Geprüft am 06.09.2026: In der Produktion existiert derzeit kein
  einziger Workflow** (`list_workflows` liefert `[]`), es geht also nichts kaputt.
- `messages.botHint` in `messages/de.json` und `messages/en.json` neu texten.
- Domain-Event `bot.message.received` und sein Payload-Typ in `src/server/events/bus.ts:45` entfallen.

### 1.2 Der System-Bot ist eine `users`-Zeile, kein Agenten-Modell

Bestand: `BOT_USER_ID = "system-bot"`, Name aus `app_settings.bot_name`, Avatar auf
`users.avatar_media_id` (`src/server/domain/bot.ts`). Das trägt genau **einen** Bot.

Die Anforderung „später legen Nutzer eigene Agenten an“ passt darauf nicht: Man bekommt weder mehrere
Namen noch mehrere Modelle noch Besitzverhältnisse in `app_settings` unter. Wer das jetzt an
`app_settings` anflanscht, migriert es später unter Schmerzen (Fremdschlüssel, Messenger-Historie).

**Empfehlung:** Sofort eine Tabelle `ai_agents` einführen – auch wenn zunächst genau eine Zeile darin
steht (`is_system = true`). Der Bot-Nutzer bleibt bestehen, aber nur noch als *Messenger-Identität*
des System-Agenten (`ai_agents.bot_user_id`). `ensureBotUser()` liest Name und Avatar künftig aus
`ai_agents` und spiegelt sie auf die `users`-Zeile, damit Messenger und Verlauf unverändert
funktionieren. `app_settings.bot_name` wird einmalig kopiert und danach nicht mehr gelesen.

Betroffene Stellen des Umzugs: `src/server/domain/bot.ts:22`, `src/app/admin/general/page.tsx:20`,
`src/app/admin/general/general-form.tsx:48`, `src/server/actions/admin-settings.ts:26`,
`messages/de.json` + `messages/en.json` (`admin.general.botName`).

### 1.3 Der LLM-Client kann weder Tool-Calling noch Streaming

Das ist der eigentliche Kern der Arbeit, und er wird in der Idee nicht sichtbar.
`src/server/llm/client.ts` baut `messages` als `{role, content: string}`, liest nur
`choices[0].message.content` und kennt kein `tools`, kein `tool_calls`, keine `role: "tool"`-Nachricht
und kein `stream: true`. Ohne diese Erweiterung gibt es keinen agentischen Loop.

Dazu kommt die **Fähigkeits-Prüfung**: `modelCapabilities()` kennt `tools` nicht. Ein Admin kann heute
jedes beliebige Modell als Standard setzen – darunter reichlich Modelle ohne Tool-Unterstützung. Bei
Providern der Art `generic` und `cortecs` ist `supported_parameters` oft gar nicht befüllt, die
Erkennung ist dann bestenfalls optimistisch.

**Umgesetzt in Phase B:** `chatCompletion` sendet und liest `tools`/`tool_calls`,
`streamChatCompletion` liefert Text-, Reasoning- und Tool-Call-Deltas (SSE, abbrechbar über ein
`AbortSignal`). `modelCapabilities` kennt `tools`; `modelToolSupport` ist dreiwertig, damit die
Agenten-Konfiguration Modelle *ohne* Tool-Unterstützung ausblendet und bei *unbekannter* Fähigkeit
(generische Endpunkte melden keine) nur warnt. Offen bis Phase C: die verständliche Fehlermeldung im
Thread, wenn ein Modell entgegen der Meldung doch keine Werkzeuge kann.

### 1.4 Schreibende Werkzeuge sind ein Autorisierungsproblem

Bestand: `canEditContent()` erlaubt Bearbeiten nur Admins oder dem Autor
(`src/server/domain/knowledge.ts:341`). Wenn der Agent als Bot-Nutzer schreibt, gilt:
- Einträge des Agenten sind für normale Mitglieder danach **nicht** mehr bearbeitbar (Autor = Bot).
- Ein Mitglied könnte über den Agenten Einträge ändern, die es selbst nicht ändern darf.

**Empfehlung (nicht verhandelbar):** Der Agent handelt **im Namen des aufrufenden Nutzers**.
Jeder Schreibvorgang läuft über die Domänenschicht mit `actorId = user.id` und wird gegen dieselben
Guards geprüft wie das UI. Die Thread-Konfiguration kann Rechte nur **einschränken**, nie erweitern.
Die Sammlungsauswahl im rechten Panel ist damit ein Fokus-Werkzeug, keine Sicherheitsgrenze – das
sollte auch so beschriftet sein (Sammlungen haben ohnehin keine ACL, jedes Mitglied sieht alle).

### 1.5 Agenten-Schreibvorgänge lösen Workflows und Evaluationen aus

Bestand: `dispatchEvent()` hat einen Schleifenschutz nur für `origin.kind === "workflow"`
(`src/server/workflows/dispatch.ts:30`). Und jedes Speichern eines strukturierten Eintrags reiht einen
Evaluations-Job ein, der **pro Kriterium einen LLM-Call** macht (`src/server/domain/evaluation.ts`).

Ein Agent, der eine Sammlung mit 50 Einträgen überarbeitet, erzeugt also 50 Workflow-Läufe *und*
50 × N Bewertungs-Calls – ausgelöst durch einen einzigen Chat-Satz. Das ist kein hypothetisches Risiko,
das ist der Normalfall des von dir gewünschten Anwendungsfalls („Agenten helfen bei der Überarbeitung
von Sammlungen“).

**Entscheidung (06.09.2026): Standard aus, je Trigger einschaltbar** – exakt nach dem Muster, das die
Content-Trigger schon haben. `contentConfig` trägt bereits `includeWorkflowOrigin` (Standard `false`,
Hilfetext „Vorsicht: kann Schleifen erzeugen“, `src/server/workflows/triggers/index.ts:6`). Es kommt ein
zweites Feld `includeAgentOrigin` daneben, gleiche Semantik, gleicher Standard.

Umsetzung:
- `EventOrigin` um `{ kind: "agent"; threadId: string; agentId: string; userId: string }` erweitern
  (`src/server/events/bus.ts:9`).
- `matchesContent()` verwirft Events mit `origin.kind === "agent"`, solange `includeAgentOrigin` aus ist.
- Der Agenten-Loop begrenzt Schreibvorgänge je Turn (Vorschlag: 10).
- Evaluation: im Curate-Modus je Eintrag nur einmal am Turn-Ende einreihen (die Job-Id
  `eval-<versionId>` entdoppelt bereits pro Version).

### 1.6 Es gibt keine Retrieval-Infrastruktur

Bestand: Suche über `ilike(contents.search_text, '%q%')` (`src/server/domain/knowledge.ts:299`).
Kein pgvector – die Produktion fährt `postgres:16-alpine` ohne Extension.

„Datenbasis aus den Sammlungen“ klingt nach Embeddings, ist aber ohne Vektorsuche zunächst:
Werkzeuge + Zeichenbudget. Das ist für den Start gut genug (eine Sammlung hat Dutzende, nicht Millionen
Einträge) und deutlich transparenter – der Agent zeigt, welchen Eintrag er gelesen hat.

**Empfehlung:** MVP ohne Embeddings, dafür ein sauberes Budget (z. B. 40.000 Zeichen Instruktionskontext,
`get_entry` auf 20.000 Zeichen gedeckelt wie in der Evaluation). pgvector als eigene, spätere Phase –
sie erfordert einen Image-Wechsel (`pgvector/pgvector:pg16`) und ein Backfill-Skript, das ist kein
Nebenbei-Schritt.

### 1.7 Keine Kostenkontrolle vorhanden

Bestand: Nirgends ein Budget. Workflow-Läufe erfassen `usage` je Schritt, das war's. Ein agentischer
Loop mit Werkzeugen ist der erste Ort in der App, an dem ein **Mitglied** unbegrenzt Kosten auf dem
Schlüssel des Admins erzeugen kann – iterativ, im Hintergrund, ohne Deckel.

**Entscheidung (06.09.2026): Wochenkontingent je Nutzer, Eingabe- und Ausgabe-Tokens getrennt gezählt
und gewichtet zusammengeführt. Durchsetzung erst nach v1 – die Erfassung aber ab v1.**

Das ist die richtige Reihenfolge: Ein Limit lässt sich jederzeit nachrüsten, aber nur, wenn die Zahlen
vorher schon geschrieben werden. Fehlt die Erfassung, steht man später ohne Datenbasis da und muss
raten, wo ein sinnvoller Deckel liegt.

Warum gewichtet: Ausgabe-Tokens kosten je nach Modell das Drei- bis Fünffache der Eingabe. Ein simples
`prompt + completion` würde teure Turns unterschätzen. Deshalb:

```
verbrauch = promptTokens + (completionTokens × faktor)     # faktor konfigurierbar, Vorschlag 4
```

`prompt_tokens` und `completion_tokens` liegen roh in `agent_messages.usage`, der Faktor in
`ai_agents` bzw. den App-Einstellungen. Nutzer sehen nur „x % des Wochenkontingents verbraucht“ –
keine Beträge. Kosten (OpenRouter liefert `usage.cost` mit) werden mitgeschrieben, aber nur im
Admin-Bereich gezeigt.

Für v1 gilt trotzdem eine **harte technische Grenze je Turn**: `max_steps` (Standard 12) und ein
Token-Deckel je Turn. Das ist kein Budget, sondern der Schutz gegen den durchdrehenden Loop – und der
darf nicht warten.

### 1.8 Laufzeit und Speicher des App-VPS

Bestand: 2 vCPU / 3,8 GB + 4 GB Swap; `next build` braucht bereits ~4,7 GB (siehe `CLAUDE.local.md`).
Agentische Turns laufen Minuten. Ein Next-Route-Handler ist dafür der falsche Ort (Traefik-Timeouts,
Verlust bei Deploy/Reload, blockierte Web-Worker).

**Empfehlung:** Der Loop läuft im **Worker** (BullMQ), so wie Workflows und Evaluation. Die UI bekommt
die Tokens über den bestehenden SSE-Kanal (`/api/events` → Redis-Pub/Sub → `useRealtimeEvent`). Vorteil:
übersteht Reload und Deploy, ist abbrechbar, braucht keine neue Infrastruktur. Nachteil, den man kennen
muss: Redis-Pub/Sub fächert an **alle** Tabs des Nutzers auf – Token-Deltas müssen gebündelt werden
(z. B. Flush alle ~100 ms oder satzweise), sonst erzeugt ein Turn Tausende Redis-Nachrichten.

Zusätzlich: BullMQ `lockDuration` steht auf 5 Minuten (`worker/index.ts`). Lange Turns brauchen entweder
eine eigene Queue mit längerem Lock oder – besser – kurze Jobs je Loop-Schritt.

### 1.9 Werkzeuge doppeln den MCP-Server

Bestand: `src/server/mcp/server.ts` (812 Zeilen) enthält bereits genau die Werkzeuge, die der Agent
braucht: `list_collections`, `list_entries`, `get_entry`, `create_entry`, `update_entry`,
`list_templates`, `get_template` … – nur eingebettet in `registerTool()`-Closures mit Scope-Prüfung
gegen API-Schlüssel, nicht als wiederverwendbare Registry.

**Empfehlung:** Eine eigene Registry `src/server/agents/tools/` nach dem Muster der Workflow-Aktionen
(zod-Schema, `fields`, englisches `doc`, `run(input, ctx)`). Beide Seiten – MCP und Agent – rufen
dieselben Domänenfunktionen, aber vorerst mit getrennten Registrierungen. Die MCP-Schicht jetzt
umzubauen wäre Risiko ohne Gegenwert; die Dopplung ist bewusste, kleine Schuld (ein Absatz in
`docs/workflows.md`). Erst wenn der dritte Konsument kommt, lohnt die Vereinheitlichung.

### 1.10 Threads sind keine Conversations

Verlockend, `conversations`/`messages` wiederzuverwenden. Passt nicht: dort hängen
`conversation_members`, Ungelesen-Zähler, Kontaktlogik und Anhänge dran; hier braucht es Tool-Calls,
Tool-Ergebnisse, Thread-Konfiguration, Usage und Abbruch-Zustand. **Eigene Tabellen.**

### 1.11 Einträge haben keinen Entwurfszustand

Bestand: `contents` kennt nur `deleted_at` und Versionen – kein Draft. Was der Agent schreibt, ist sofort
für alle sichtbar (immerhin versioniert und wiederherstellbar).

**Entscheidung (06.09.2026):** Statt eines Draft-Zustands (großer Eingriff ins Datenmodell) eine
**Freigabe vor dem Schreiben** im Chat – wie die Berechtigungsabfrage in Claude Code, umschaltbar über
ein Icon im Chat-Kopf (Abschnitt 7, Punkt 2). Der Loop hält an, schreibt den geplanten Tool-Call als
Nachricht mit Status `awaiting_approval` in den Thread, der Turn endet; die Zustimmung reiht einen
Folge-Job ein. Das vermeidet blockierende Worker-Jobs und ist konzeptionell nah am bestehenden
`ask_user`/`questions`.

Dass die Änderung sofort live ist, bleibt bestehen – abgefedert durch Versionierung und Verlauf, die es
je Eintrag ohnehin gibt.

### 1.12 „Wie Claude Cowork, nur mit Sammlungen“ ist kein Phasenziel

Was zu diesem Anspruch fehlt, ist kein Feature, sondern eine Reihe: Websuche, Dateiuploads in den Chat,
Artefakte/Dokumenten-Ausgabe, Kontext-Kompaktierung bei langen Threads, Sub-Agenten, Sandbox.
Als Zielbild richtig, als Abnahmekriterium für den ersten Wurf unbrauchbar. Der Schnitt in Abschnitt 5
setzt deshalb bewusst mit „Lesen + Schreiben in Sammlungen“ auf und lässt den Rest als benannte Phasen
stehen.

---

## 2. Zielbild

- **Menüpunkt „KI-Agenten“** in der Seitenleiste, eigener Abschnitt (wie Sammlungen und Meeting-Bereiche),
  darin der System-Agent für alle Mitglieder; später Agenten der Nutzenden.
- **Chat-Oberfläche** unter `/agents/<slug>`: Thread-Liste links, Chat in der Mitte, Konfigurations-Panel
  rechts (ein-/ausklappbar) – dieselbe Sprache wie der Messenger (`messages-shell.tsx`).
- **Admin bestimmt** Name, Avatar, Provider/Modell und Basis-Systemprompt des System-Agenten.
- **Nutzer bestimmen je Thread**: Arbeitsmodus, welche Sammlungen gelesen, welche beschrieben werden
  dürfen, und welche Sammlung als *Instruktion* gilt.
- **Agentischer Loop** mit Werkzeugen im Worker, Streaming in die UI, Abbruch möglich.

### Die zwei Aspekte, klar getrennt

Die von dir gewünschte Trennung wird ein **Arbeitsmodus je Thread**:

| Modus | „Sammlungen pflegen“ (`curate`) | „Arbeiten“ (`assist`) |
|---|---|---|
| Werkzeuge | lesen **und** schreiben | nur lesen |
| Ziel | Einträge anlegen/überarbeiten | Antwort, Text, Dokument im Chat |
| Schreiben | Freigabe je Vorgang (abschaltbar) | – |
| Ergebnis | Versionen in der Sammlung | Chat-Ausgabe, später Export |

### Sammlungen als Konfiguration

Zwei getrennte Einstellungen im rechten Panel – das ist der Kern deiner Idee und verdient die
Unterscheidung:

**a) Zugriff (auf Sammlungsebene).** Je ausgewählte Sammlung `read` oder `write`. Bestimmt, was die
Werkzeuge sehen und anfassen dürfen. `write` nur im Curate-Modus.

**b) Instruktionen (auf Eintragsebene).** *Entscheidung (06.09.2026): beliebige Einträge, keine eigene
Vorlage.* Der Nutzer wählt einzelne Einträge aus beliebigen Sammlungen aus; ihr `body_markdown` wird in
den Systemprompt gerendert. Genau das CLAUDE.md-Muster: ein Eintrag „Schreibstil“, einer
„Bewertungsmaßstab“, einer „Dokumentvorlage“.

Eintragsebene statt Sammlungsebene ist die bessere Wahl: Eine Sammlung hat schnell 50 Einträge, von
denen genau einer die Anweisung ist. Für den Nutzer wird das ein Auswahldialog mit Suche über
`listContents({ query })`, gruppiert nach Sammlung – die vorhandene ILIKE-Suche reicht dafür.

Budget: Instruktionen zusammen auf 40.000 Zeichen gedeckelt, Reihenfolge frei sortierbar. Wird der
Deckel überschritten, zeigt das Panel es an, statt still zu kürzen.

**Ohne Auswahl** greift ein mitgelieferter Standard-Systemprompt (siehe Abschnitt 7), damit ein frischer
Thread sofort brauchbar ist.

## 3. Datenmodell

Neue Tabellen (Drizzle, `src/server/db/schema.ts`, Spalten snake_case):

```
ai_agents
  id uuid pk
  slug text unique                     -- /agents/<slug>
  name text
  description text null
  avatar_media_id uuid null            -- media_files, purpose "avatar"
  provider_id uuid null → llm_providers  (null = Standard-Provider)
  model text null                        (null = Standard-Modell)
  system_prompt text                     -- Basis, vom Admin
  temperature / max_tokens / reasoning_effort
  max_steps int default 12
  is_system bool default false
  bot_user_id text null → users.id     -- nur beim System-Agenten: "system-bot"
  owner_id text null → users.id        -- null = für alle; später: Besitzer
  enabled bool default true
  timestamps

agent_threads
  id uuid pk
  agent_id uuid → ai_agents
  user_id text → users.id              -- Eigentümer des Threads
  title text                           -- aus der ersten Nachricht abgeleitet
  mode text: curate | assist
  write_approval text: always | never  -- default always
  archived_at / timestamps

agent_thread_collections            -- Zugriff, Sammlungsebene
  thread_id uuid → agent_threads
  area_id uuid → knowledge_areas
  access text: read | write
  unique (thread_id, area_id)

agent_thread_instructions           -- Instruktionen, Eintragsebene
  thread_id uuid → agent_threads
  content_id uuid → contents
  sort_order int
  unique (thread_id, content_id)

agent_messages
  id uuid pk
  thread_id uuid → agent_threads
  role text: user | assistant | tool
  content text                          -- Markdown bzw. Tool-Ergebnis
  tool_calls jsonb null                 -- [{id, name, arguments}]
  tool_call_id text null                -- bei role=tool
  status text: complete | streaming | awaiting_approval | error | cancelled
  usage jsonb null                      -- {promptTokens, completionTokens, cost} – Basis fürs Wochenkontingent
  step_no int
  created_at
```

Bewusst **nicht** gebaut: kein Draft-Zustand für Einträge, keine Embeddings, keine eigene
Agenten-Rechtematrix (siehe 1.4 – es gelten die Rechte des Nutzers), keine eigene Verbrauchstabelle
(das Wochenkontingent aggregiert später über `agent_messages.usage`; ein Index auf
`(thread_id, created_at)` genügt vorerst).

Migration für den System-Agenten: eine Zeile mit `is_system = true`, `slug = "assistent"`,
`bot_user_id = 'system-bot'`, `name` aus `app_settings.bot_name`, `avatar_media_id` aus der Bot-`users`-Zeile.

---

## 4. Module

```
src/server/agents/
  agents.ts        Domäne: CRUD Agenten, System-Agent laden/sicherstellen
  threads.ts       Threads, Nachrichten, Thread-Konfiguration
  context.ts       Systemprompt bauen (Basis + app.purpose + Instruktions-Sammlungen, mit Budget)
  loop.ts          agentischer Loop: Schritt, Tool-Calls, Abbruch, Limits
  queue.ts         BullMQ-Jobs (kind: "agent-turn" / "agent-continue")
  tools/index.ts   Registry (zod + doc + run), Tools s. u.
src/server/actions/agents.ts     Server Actions (Thread anlegen, senden, abbrechen, Konfiguration)
src/app/(app)/agents/[slug]/…    Seiten
src/components/agents/…          Shell, Thread-Liste, Chat, Konfig-Panel, Tool-Anzeige
src/app/admin/agents/…           Admin: Name, Avatar, Provider/Modell, Systemprompt, Limits
```

`src/server/agents/**` läuft im Worker → **keine `next/*`- und React-Imports**, Tools rufen die
Domänenschicht (`src/server/domain/*`), niemals die Server Actions (`saveContentAction` ist Next-spezifisch).
BullMQ-Job-Ids ohne `:` (bestehende Regel).

### Werkzeuge (erste Ausbaustufe)

| Tool | Modus | Domäne |
|---|---|---|
| `list_collections` | beide | `listAreas` |
| `list_entries` | beide | `listContents` (auf erlaubte `area_id` gefiltert) |
| `search_entries` | beide | `listContents({query})` |
| `get_entry` | beide | `getContent` + `bodyMarkdown`, gedeckelt |
| `list_templates` / `get_template` | curate | `src/server/domain/templates.ts` |
| `create_entry` | curate | `buildStructuredVersionInput` + `createContent` |
| `update_entry` | curate | `buildStructuredVersionInput` + `addContentVersion` |
| `read_webpage` | beide | `src/server/webreader/read-webpage.ts` (SSRF-Schutz vorhanden) |

Später: `web_search`, `create_workflow` (nur Admin), `list_meetings`/Transkripte, Dateiausgabe.

### Loop (ein Turn)

1. Server Action legt `agent_messages`-Zeile (role `user`) an, reiht `agent-turn` ein.
2. Worker baut Systemprompt (Basis + `{{ app.purpose }}` + Instruktions-Sammlungen) und
   Nachrichtenverlauf, ruft `chatCompletion` mit `tools` und `stream: true`.
3. Token-Deltas gebündelt per `publishToUser` → `agent.message.delta`.
4. Tool-Calls: erlaubte Tools ausführen, Ergebnis als `role: "tool"` speichern, nächster Schritt.
   Schreibende Tools bei `write_approval = always`: Nachricht mit Status `awaiting_approval`, Turn endet.
5. Abbruch: Redis-Key `aiup-agent-cancel-<threadId>`, zwischen Schritten geprüft.
6. Ende bei Antwort ohne Tool-Call, `max_steps`, Token-Deckel oder Fehler; Usage wird gespeichert.

### Realtime

Neu in `src/lib/realtime-events.ts`:
`agent.message.delta` (threadId, messageId, text – gebündelt), `agent.message.completed`,
`agent.tool.started` / `agent.tool.finished`, `agent.turn.finished` (Status, Usage).
Nur an den Thread-Eigentümer (`publishToUser`).

---

## 5. Phasen

| Phase | Inhalt | Abnahme |
|---|---|---|
| **A** Fundament ✅ *(06.09.2026)* | `ai_agents` + Migration des System-Bots, Admin-Seite (Name, Avatar, Provider/Modell, Systemprompt, Limits), `ensureBotUser` liest den Agenten; Messenger-Bot auf Empfang umstellen (UI + Server-Guard), Trigger `bot.message.received` entfernen | Admin konfiguriert den Standard-Agenten; an den Bot lässt sich nicht mehr schreiben, an Mitglieder schon |
| **B** LLM-Client ✅ *(06.09.2026)* | Tool-Calling + Streaming in `client.ts`, `tools` in `modelCapabilities`, Modell-Auswahl gefiltert | Unit-Tests für Wire-Format und Stream-Parser (`client.test.ts`); der erste echte Tool-Call kommt mit Phase C |
| **C** Threads + Chat ✅ *(06.09.2026)* | Tabellen, Menüpunkt, Thread-Liste, Chat-UI, Konfig-Panel (Zugriff + Instruktions-Einträge), Standard-Systemprompt, Loop im Worker, Streaming, Abbruch, Lese-Tools, `max_steps`/Token-Deckel je Turn, Usage-Erfassung | Nutzer chattet mit dem Agenten; ein ausgewählter Eintrag steuert nachweislich das Verhalten |
| **D** Schreiben ✅ *(06.09.2026)* | Schreib-Tools, Freigabe-Fluss + Icon-Umschalter, `origin: agent`, `includeAgentOrigin`, Evaluations-Bündelung | Agent legt nach Freigabe einen Eintrag an; kein Workflow läuft ungewollt mit |
| **E** Kosten & Betrieb | Wochenkontingent je Nutzer (gewichtete Summe), Admin-Übersicht, Fehlerbilder | Ein Nutzer kann das Wochenkontingent nicht überschreiten |
| **F** Ausbau | Websuche, Dateien im Chat, lange Threads (Kompaktierung), eigene Agenten der Nutzenden | – |
| **G** Retrieval | pgvector, Embeddings über `content_versions`, semantische Suche als Tool | – |

Phasen A und B sind unabhängig und können parallel laufen. C ist der größte Brocken. Die
Verbrauchs­erfassung steckt bewusst schon in C, obwohl das Limit erst in E greift – ohne Zahlen aus dem
echten Betrieb lässt sich kein sinnvoller Deckel wählen.

---

## 6. Sprache und Konventionen

- UI-Texte in `messages/de.json` **und** `messages/en.json` (Abschnitt `agents`), keine `{{ }}`/`<tag>` in
  ICU-Strings.
- Tool-Ids, Tool-Beschreibungen, Systemprompts, Code und Kommentare: **Englisch**; sichtbare Labels als
  `{ de, en }` wie in der Workflow-Registry.
- Nach Schemaänderung: `npm run db:generate` (Migration committen) und `npm run db:migrate`.
- Vor Abschluss: `npm run typecheck && npm run lint && npm run build && npm run worker:build`.
- Dokumentation: eigener Abschnitt in `docs/workflows.md` (Tool-Registry, Abgrenzung zu MCP) und
  Ergänzung von `CLAUDE.md`.

---

## 7. Getroffene Entscheidungen (06.09.2026)

1. **Messenger-Bot wird empfangsseitig.** Kein Senden an den Bot mehr, Unterhaltungen mit Mitgliedern
   unverändert. Trigger `bot.message.received` entfällt (keine Workflows in Produktion betroffen).
   Details in 1.1.
2. **Freigabe beim Schreiben: Icon-Umschalter im Thread.** `agent_threads.write_approval` bleibt
   Standard `always`; umgeschaltet wird nicht im rechten Panel, sondern über ein kleines Icon im
   Chat-Kopf – zwei Zustände, sichtbar ohne Klick:
   - `ShieldCheck` „Immer nachfragen“ (Standard)
   - `Zap` „Automatisch ausführen“

   Nur im Curate-Modus sichtbar, im Assist-Modus gibt es nichts freizugeben. Der Zustand steht am
   Thread, nicht am Agenten – wer einmal „automatisch“ wählt, tut das für diese eine Arbeit.
3. **Workflows bei Agenten-Änderungen: Standard aus, je Trigger einschaltbar** (neues Feld
   `includeAgentOrigin` analog zum vorhandenen `includeWorkflowOrigin`). Details in 1.5.
4. **Wochenkontingent je Nutzer, Eingabe/Ausgabe getrennt gezählt und gewichtet zusammengeführt.**
   Durchsetzung nach v1, Erfassung ab v1. Details in 1.7.
5. **Instruktionen auf Eintragsebene, beliebige Einträge, keine eigene Vorlage.** Ohne Auswahl greift
   der Standard-Systemprompt (siehe unten). Details in Abschnitt 2.

### Standard-Systemprompt

Englisch wie alle LLM-Instruktionen im Projekt (Muster: `SYSTEM_PROMPT` in
`src/server/domain/evaluation.ts:69`), mit ausdrücklicher Anweisung, in der Sprache des Nutzers zu
antworten. Liegt als Konstante in `src/server/agents/context.ts` und ist vom Admin je Agent
überschreibbar.

```
You are the assistant of "{{ app.name }}", a community workspace.
{{ app.purpose }}

Answer in the language the user writes in – German unless they switch.
Be concise and concrete: no filler, no restating the question, no announcing what you are about to do.

The community's knowledge lives in collections of structured entries. When a question touches that
knowledge, look it up with your tools instead of guessing – list_entries and search_entries find
entries, get_entry reads one in full. Say plainly when the collections do not cover something.

When you use an entry, name it, so people can check and improve the source.
Never invent entries, authors or facts about the community.
```

Bei ausgewählten Instruktions-Einträgen wird deren Markdown unter der Überschrift
`## Instructions from the collections` angehängt – der Basis-Prompt bleibt immer davor stehen.

---

## 8. Offene Punkte

- Titelbildung für Threads: erste Nachricht kürzen oder per LLM zusammenfassen (Kosten je Thread).
- Verhalten bei sehr langen Threads (Kontext-Kompaktierung) – Phase F.
- Ob der System-Agent abschaltbar sein soll (Admin-Flag `enabled` ist vorgesehen, UI noch offen).
