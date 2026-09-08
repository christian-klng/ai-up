# Modell-Fähigkeiten (Planung, Stand 08.09.2026)

Eine vom Admin gepflegte Tabelle, welche Fähigkeiten jedes LLM-Modell hat – Werkzeuge, Reasoning-Stufen,
strukturierte Ausgabe, Kontextgröße –, pflegbar über MCP.

Stand: **Phasen A–C umgesetzt** (08.09.2026), Phasen D und E offen.

---

## 1. Das Problem

Die App rät. `modelCapabilities()` (`src/server/llm/client.ts:410`) liest `supported_parameters` aus der
Modell-Liste – das ist eine **OpenRouter-Eigenheit**, kein OpenAI-Standard. Scaleway liefert das Feld nicht
(geprüft am 07.09.2026: alle 15 gelisteten Modelle ohne). Dann greift der Rückfall auf den Provider-Typ,
und für `generic` heißt das: Reasoning aus, Werkzeuge optimistisch an.

Drei beobachtete Folgen:

- Der Thinking-Level des Agenten steht in der Datenbank auf `medium`, wird aber **nie gesendet**
  (`caps.reasoning` ist `false`, `src/server/agents/loop.ts:152`). Die Einstellung ist sichtbar und wirkungslos.
- Der feste Satz `Aus/Niedrig/Mittel/Hoch` passt auf kein Scaleway-Modell zuverlässig: `glm-5.2` kennt
  `none|high|max`, `mistral-medium-3.5-128b` nur `none|high`, `gpt-oss-120b` kein `none`.
- `LlmModelSelect` kann Modelle ohne Werkzeug-Unterstützung nicht ausblenden, weil `modelToolSupport`
  für alle `undefined` liefert.

Es gibt bei Scaleway **keinen** Endpunkt für Fähigkeiten – `GET /v1/models` gibt die schlichte OpenAI-Form
zurück. Die Daten stehen nur in einer Doku-Tabelle. Also muss sie jemand eintragen.

---

## 2. Ziel und Abgrenzung

Eine Fähigkeitstabelle in der Datenbank, die der Admin **per MCP** aktuell hält: Claude liest die
Hersteller-Doku und schreibt die Tabelle, die App liest sie und richtet Modellauswahl und Aufrufe danach.

**Nicht** Teil davon: Die App holt nichts selbst aus dem Netz. Kein Scraper, kein Zeitplan, keine
Anbieter-Logik im Code. Der MCP-Server stellt Lesen und Schreiben bereit – recherchieren tut der Agent auf
der anderen Seite. Das hält vendor-spezifisches Wissen aus dem Repo heraus, wo es ohnehin veralten würde.

---

## 3. Entwurfsentscheidungen

### 3.1 Eigene Tabelle, nicht `availableModels`

Naheliegend wäre, `LlmModelInfo.supportedParameters` von Hand zu füllen. Geht nicht: `syncModels()`
**ersetzt** `availableModels` durch die frische Liste (`src/server/llm/providers.ts:131`; erhalten bleiben
nur manuell ergänzte Modelle, die der Endpunkt nicht kennt). Der nächste Abgleich löscht jede Handarbeit.
Eine eigene Tabelle überlebt das und ist die einzige Stelle, die Pflege verträgt.

### 3.2 Reasoning ist eine Liste, kein Schalter

Die erlaubten Stufen unterscheiden sich je Modell (siehe oben). Ein Boolean plus fester Enum würde genau
den Fehler zementieren, der gerade aufgefallen ist. Gespeichert wird deshalb `reasoning_levels` als Liste;
leer = kein Reasoning.

### 3.3 Keine Sammlung

Bei euch sind Sammlungen das Mittel für gepflegtes Wissen, der Gedanke liegt also nahe. Trotzdem: Das hier
ist Maschinenkonfiguration mit striktem Schema, die der **Worker** liest. Sie über einen Eintrag zu parsen
wäre eine Fehlerquelle ohne Gewinn. Die Transparenz stellt stattdessen eine Lese-Ansicht im Admin her.

### 3.4 Was ein LLM hier anrichten kann

Ein Agent, der diese Tabelle schreibt, kann Fähigkeiten erfinden. Die Folge wäre unangenehm konkret: ein
Modell wird als tool-fähig geführt, ist es nicht, und jeder Zug bricht ab. Gegenmittel:

- `source` (i. d. R. die Doku-URL) und `checked_at` sind **Pflichtfelder** beim Schreiben.
- Die Lese-Ansicht zeigt beides – wer die Angabe wann woher hat, ist damit nachprüfbar.
- Validierung gegen bekannte Stufen (`none|low|medium|high|max`).
- Die Auflösung bleibt konservativ: **unbekannt ist nicht dasselbe wie „kann es nicht"**. Ohne Zeile gilt
  weiter die heutige Heuristik, das Feature ist rein additiv.

### 3.5 Neuer Scope nötig

`llm:write` existiert nicht (`API_SCOPES`, `src/server/domain/api-keys.ts:10`). Er muss ergänzt werden –
und bestehende API-Schlüssel bekommen ihn **nicht** rückwirkend. Für die Pflege braucht es einen neuen
Schlüssel oder eine erweiterte Auswahl beim Anlegen.

---

## 4. Datenmodell

```
llm_model_capabilities
  id uuid pk
  provider_id uuid null → llm_providers (null = gilt für jeden Provider mit dieser Modell-Id)
  model_id text
  tools boolean null                -- null = unbekannt (nicht "nein")
  structured_outputs boolean null
  vision boolean null
  reasoning_levels jsonb not null default '[]'   -- [] = kein Reasoning, sonst ["none","high","max"]
  context_length integer null
  notes text null
  source text not null              -- Beleg, i. d. R. die Doku-URL
  checked_at timestamptz not null
  updated_by text null → users (set null)
  timestamps
```

Eindeutigkeit braucht **zwei** Indizes: `unique (provider_id, model_id)` greift in Postgres nicht für
Zeilen mit `provider_id is null` (NULL ist nie gleich NULL). Dazu also ein partieller
`unique (model_id) where provider_id is null`.

---

## 5. Auflösung

Neu in `src/server/llm/providers.ts`:

```
resolveModelCapabilities(providerId, modelId, info) →
  { tools, structuredOutputs, reasoningLevels, contextLength, origin: "manual" | "provider" | "guess" }
```

Reihenfolge:

1. Zeile mit exakt `(providerId, modelId)`
2. Zeile mit `(null, modelId)`
3. `info.supportedParameters` (OpenRouter beschreibt sich selbst)
4. heutige Heuristik nach Provider-Typ

`resolveModel()` gibt das Ergebnis mit zurück. Die drei Aufrufer übernehmen es unverändert im Muster
`const { provider, model, caps } = await resolveModel(...)`:
`src/server/workflows/actions/index.ts:78`, `src/server/agents/loop.ts:102`,
`src/server/domain/evaluation.ts:102`. `modelCapabilities()` bleibt als reiner Rückfall bestehen (Schritte 3–4).

---

## 6. MCP-Oberfläche

Scope `llm:read` zum Lesen, neuer `llm:write` zum Schreiben.

| Tool | Zweck |
|---|---|
| `list_model_capabilities` | Alle Zeilen mit `checkedAt`, `source` und Herkunft; optional auf einen Provider gefiltert. Listet zusätzlich die **freigeschalteten Modelle ohne Zeile** – das ist die Arbeitsliste. |
| `set_model_capabilities` | Bulk-Upsert: `models: [{ modelId, tools?, structuredOutputs?, vision?, reasoningLevels?, contextLength?, notes? }]`, dazu gemeinsame `source` und optional `providerId`. Antwortet mit angelegt / geändert / unverändert. |
| `delete_model_capabilities` | Einzelne Zeile entfernen (z. B. Modell abgekündigt). |

Dazu die Resource `aiup://docs/model-capabilities`: Format, erlaubte Reasoning-Stufen und die Regel
**lieber weglassen als raten** – ein Feld, das man nicht belegen kann, bleibt `null`.

### Der Pflege-Ablauf

Was Christian tatsächlich tut – ein Satz in Claude mit angebundenem AI-Up-Konnektor:

> „Aktualisiere die Modell-Fähigkeiten für Scaleway aus
> https://www.scaleway.com/en/docs/generative-apis/reference-content/supported-models/"

Claude ruft `list_model_capabilities` (was fehlt?), liest die Doku-Tabelle, schreibt
`set_model_capabilities` mit der URL als `source` und berichtet den Unterschied. Bulk-Upsert und die
Arbeitsliste im Read-Tool sind genau auf diesen Ablauf zugeschnitten.

---

## 7. Folgeänderungen

- `ChatRequest.reasoningEffort` um `"max"` erweitern (`src/server/llm/client.ts:39`).
- Agenten-Formular: Stufen aus den Fähigkeiten des gewählten Modells statt festem Vierer-Satz
  (`src/app/admin/agents/agent-form.tsx:131`). `ai_agents.reasoning_effort` bleibt Text, validiert gegen die Liste.
- `LlmModelSelect`: `supportsTools` speist sich aus der Auflösung statt aus `modelToolSupport`
  (`src/server/llm/providers.ts:175`).
- Workflow-Aktion `llm`: dasselbe Feld dynamisch (`src/server/workflows/actions/index.ts:66`) – kann
  bewusst später kommen, siehe Phasen.
- Lese-Ansicht unter *Verwaltung → LLM*: je Modell Werkzeuge / Reasoning / Kontext, mit Stand und Quelle;
  ohne Zeile ein sichtbares „unbekannt, geraten".

---

## 8. Phasen

| Phase | Inhalt | Abnahme |
|---|---|---|
| **A** Fundament ✅ *(08.09.2026)* | Tabelle, `mergeCapabilities` (+ Tests), `resolveModel` liefert `caps`, drei Aufrufer und MCP-Anzeige umgestellt, `normalizeReasoningLevel` verwirft ungültige Stufen | Verhalten unverändert, Fähigkeiten kommen aus einer Quelle |
| **B** MCP ✅ *(08.09.2026)* | Scope `llm:write`, drei Tools, Resource `aiup://docs/model-capabilities`, Merge-Semantik als reine Funktion getestet | Ein Satz in Claude pflegt Scaleway vollständig |
| **C** Reasoning ✅ *(08.09.2026)* | `max` ergänzt, Stufen je Modell im Agenten-Formular, serverseitige Validierung, Hinweis statt Schein-Auswahl bei unbekanntem Modell | Thinking-Level wirkt und bietet nur Gültiges an |
| **D** Sichtbarkeit | Lese-Ansicht im Admin, Werkzeug-Filter aus der Auflösung | Admin sieht, was die App über jedes Modell weiß |
| **E** Weitere Anbieter | nichts zu bauen – nur pflegen | OpenRouter bleibt selbstbeschreibend, andere werden eingetragen |

A und B sind der Kern; C bringt den eigentlichen Nutzen (der Thinking-Level funktioniert dann).

---

## 9. Offene Entscheidungen

1. ~~Global oder je Provider?~~ **Entschieden (08.09.2026): global.** Die Tabelle trägt nur `model_id`,
   kein `provider_id` – eine Spalte und der partielle Index entfallen.
2. ~~Workflow-Aktion in Phase C mitziehen?~~ **Nein (08.09.2026).** Nur der Agent hat die dynamische
   Auswahl bekommen; die Workflow-Aktion `llm` behält vorerst ihren festen Satz im Editor. Gefährlich ist
   das nicht: `normalizeReasoningLevel` verwirft eine ungültige Stufe schon zur Laufzeit (seit Phase A),
   die Auswahl im Editor kann nur mehr anbieten als wirkt. Nachziehen, sobald das Feldsystem des
   Workflow-Editors dynamische Optionen trägt.
3. **Veraltung anzeigen?** Soll `list_model_capabilities` Zeilen ab einem Alter (z. B. 90 Tage) als
   „prüfen" markieren?
4. **Kein Seed** – die Tabelle startet leer, bis du sie einmal füllst. Einverstanden, oder willst du einen
   Startbestand für Scaleway im Repo (mit dem Nachteil, dass er dort veraltet)?
