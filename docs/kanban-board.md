# Kanban-Board als Element-Typ (Planung, Stand 27.09.2026)

Ein neuer Element-Typ `kanban` für Vorlagen in Sammlungen: Karten in Spalten nach dem Vorbild von Trello,
gedacht für gemeinsames Planen, etwa von Anforderungen. Karten haben Titel, Beschreibung und Farbe,
Spalten haben Titel. UI-Name in beiden Sprachen: „Kanban-Board“ / „Kanban board“.

Stand: **Phase A umgesetzt** (27.09.2026), B–D offen.

---

## 1. Entscheidungen

| Frage | Entscheidung |
|---|---|
| Wo wird bearbeitet? | **Direkt in der Eintragsansicht**, wie bei Trello – Karten ziehen, anlegen, ändern ohne „Bearbeiten“. |
| Wer darf bearbeiten? | Schalter `collaborative` je Element, **Standard an** (wie beim Whiteboard): alle aktiven Mitglieder dürfen das Board bearbeiten, nicht aber den Rest des Eintrags. Aus = nur Autor und Admins. |
| Live-Technik | **Die Live-Schicht des Whiteboards wird verallgemeinert** (`docs/whiteboard.md` 5) statt eines zweiten, parallelen Mechanismus. |
| Versionen | **Eine Version je gebündelter Änderung** – gebündelt so wie beim Whiteboard: nach 60 s Ruhe, spätestens alle 10 min, sofort wenn die letzte Person geht. Append-only bleibt, Verlauf und Wiederherstellen funktionieren unverändert. |

---

## 2. Ausgangslage

### 2.1 Vorbilder `process` und `whiteboard`

`process` liefert das Muster für Definition, `seed`, Markdown, Migration und Formular. Das Whiteboard
(PR #2) hat darüber hinaus alles für gemeinsames Bearbeiten gebaut: Redis-Zustand je Board mit
Lua-Skripten, Ops-Endpunkt und SSE-Stream je Board, kurzlebiger Board-Token, Präsenz, weiche Sperren,
Ratenbegrenzung, Sichern als Version per Worker-Job (`whiteboard-flush`) mit optimistischer Sperre über
`expectedVersionCount`, Rückgabe an laufende Sitzungen bei Schreibvorgängen von außen (`syncLiveBoards`).

### 2.2 Was das Whiteboard schon gelöst hat

- **Bearbeitungsrecht:** eigenes, schmaleres Recht je Element (`boardAccess`), `canEditContent` bleibt.
- **Speichern ist teuer:** Live-Zustand in Redis, Version erst beim Sichern; Bewertung nur am Sitzungsende.
- **Rennen in `addContentVersion`:** `expectedVersionCount` + Wiederholung bei Unique-Verletzung.
- **`isMediaLikeAnswer`:** schließt Objekte mit `items` aus – für Boards jetzt zusätzlich `columns` (Phase A).

### 2.3 Was für Kanban anders ist

Das Whiteboard kennt nur Items mit Koordinaten; die Reihenfolge ergibt sich aus der Lage. Ein Kanban-Board
lebt von **Reihenfolge** – in Spalten und von Spalten. Die Redis-Schicht speichert aber eine Map
(Item-Id → JSON), last writer wins je Item. Deshalb hat das Board zwei Formen (Abschnitt 3).

---

## 3. Datenmodell

Keine Schemaänderung an der Datenbank – das Board lebt wie alle Antworten in
`content_versions.meta.structure.answers`.

### 3.1 Gespeicherte Form (Antwort, Seed, MCP, Agenten)

```ts
// src/lib/structures/types.ts
export const KANBAN_COLORS = ["red", "orange", "yellow", "green", "blue", "purple", "brown", "gray"] as const;
export type KanbanCard = { id: string; title: string; description?: string; color?: KanbanColor };
export type KanbanColumn = { id: string; title: string; cards: KanbanCard[] };
export type KanbanBoard = { columns: KanbanColumn[] };

| (StructureElementBase & { type: "kanban"; seed: KanbanBoard; lockColumns?: boolean; collaborative?: boolean })
```

- **Reihenfolge = Array-Position.** Lesbar für Menschen und LLMs, stabil im Diff.
- **Ids** teilen sich einen Namensraum über Spalten und Karten (die Live-Form hält beide in einer Map).
  Eingaben ohne Id (MCP, Agenten, Seed) bekommen deterministische Ids (`col1`, `card1`, …), die keine
  vorhandene Id treffen. Der Editor erzeugt eigene Ids clientseitig (`newKanbanId`).
- **Feste Farbpalette** statt Hex: Hell- und Dunkelmodus, validierbar, eindeutig für ein LLM.
- **Grenzen:** 1–20 Spalten, 500 Karten gesamt; Kartentitel 200, Beschreibung 5.000 (Markdown),
  Spaltentitel 100 Zeichen. Leere Karten (ohne Titel und Beschreibung) werden verworfen; eine Karte mit
  Beschreibung, aber ohne Titel ist ungültig.
- **`seed` ist Pflicht** (mindestens eine Spalte); Standard im Editor „Offen / In Arbeit / Erledigt“.
  Unberührte Boards übernehmen den Seed (`fillSeeds`).
- **`lockColumns`:** Die Spalten kommen allein aus der Vorlage. Karten finden ihre Spalte per Id, dann per
  Titel; Karten fremder Spalten landen in der ersten – beim Speichern **und** beim Vorlagen-Upgrade, damit
  nie eine Karte verloren geht.
- **Pflichtfeld** heißt: mindestens eine Karte. Ein optionales Board ohne Karten behält seine Spalten.

### 3.2 Live-Form (nur innerhalb einer Sitzung)

```ts
type KanbanLiveItem =
  | { id; kind: "column"; order: string; title; locked? }
  | { id; kind: "card"; order: string; columnId; title; description?; color? };
type KanbanOp = { op: "upsert"; item: KanbanLiveItem } | { op: "delete"; id: string };
```

- **Sortierschlüssel** `order`: Bruch-Schlüssel über Base-62-Ziffern, als Zeichenkette verglichen, nie mit
  der Null-Ziffer am Ende – zwischen zwei Schlüsseln ist immer Platz (`orderKeyBetween`). Anhängen und
  Voranstellen zählen eine Ziffer weiter statt zu halbieren, damit Schlüssel kurz bleiben.
- Schlüssel leben **nur in der Sitzung**: Laden vergibt frische, gleichmäßig verteilte Schlüssel
  (`initialOrderKeys`), Sichern macht daraus wieder Array-Positionen (`liveItemsToKanban`).
- **Verschieben ist ein `upsert`** mit neuer `columnId` und neuem `order`. Zwei Leute, die verschiedene Karten
  bewegen, kommen sich nie in die Quere; bei derselben Karte gewinnt der letzte. Gleiche Schlüssel (zwei
  Einfügungen an derselben Stelle) entscheidet die Id.
- **Karten einer inzwischen gelöschten Spalte** landen beim Sichern am Ende der ersten Spalte.
- **`lockColumns`** setzt `locked` auf die Spalten-Items – das Lua-Skript lehnt Änderungen an gesperrten
  Items bereits ab. Neue Spalten weist der Ops-Endpunkt ab (Phase C).
- Spalten löschen nur, wenn leer und nicht die letzte (`deleteColumnOp`).

---

## 4. Reine Logik (`src/lib/structures/`, ohne `next/*`) – Phase A, umgesetzt

| Datei | Inhalt |
|---|---|
| `kanban.ts` | Eingabe-Schema, `normalizeKanbanBoard` (Ids, Trimmen, Grenzen, `lockColumns`), `kanbanHasContent`, Markdown und Suchtext, Sortierschlüssel, Live-Form (`kanbanToLiveItems`/`liveItemsToKanban`), `applyKanbanOps` und Absichts-Helfer (`addCardOp`, `moveCardOp`, `addColumnOp`, `moveColumnOp`, `deleteColumnOp`) |
| `types.ts` | Typen, `isKanbanBoard`, `isMediaLikeAnswer` schließt `columns` aus, `fillSeeds` |
| `validate.ts` | Element-Schema, Seed-Normalisierung (Ids), Seed-Prüfung, Antwort-Prüfung |
| `markdown.ts` | `## Label`, je Spalte `### Titel`, Karten als `- 🟢 **Titel**`, Beschreibung eingerückt; ohne Karten kein Abschnitt. Farben als Emoji – sprachneutral, Agenten und Bewertung sehen die Farbbedeutung. Suchtext in `flattenAnswersText` |
| `visibility.ts` | beantwortet ab einer Karte |
| `migrate.ts` | gleicher Typ wird übernommen, bei `lockColumns` auf die neuen Spalten eingerastet |
| `agents/tools/describe.ts` | Antwortform inkl. fester Spalten |
| `kanban.test.ts` | 23 Tests: Guards, Normalisierung, Sperre, Validierung, Markdown, Migration, Sortierschlüssel, Live-Form inkl. gleichzeitiger Züge |

Der Vorlagen-Editor kennt den Typ bereits (Icon `SquareKanban`, Startwert), bietet ihn aber noch **nicht** an –
das kommt mit Phase B. Per MCP (`save_template`) validiert eine Kanban-Vorlage schon jetzt; die Doku-Resource
nennt den Typ erst, wenn Formular und Ansicht ihn darstellen.

---

## 5. Bearbeitung in der Ansicht (Phase C)

### 5.1 Live-Schicht verallgemeinern

`src/server/whiteboards/` wird zur gemeinsamen Schicht für beide Typen. Was dafür nötig ist:

- **Board-Art als Parameter:** `boardAccess` akzeptiert `whiteboard` und `kanban`; `isCollaborativeWhiteboard`
  wird zu einer Prüfung für beide Typen (`collaborative !== false`).
- **Item-Grenze je Art:** das Lua-Skript bekommt `maxItems` schon als Argument – Kanban nutzt
  `KANBAN_MAX_LIVE_ITEMS` (520).
- **Umrechnung an den Rändern:** Laden `kanbanToLiveItems(answer, { lockColumns })`, Sichern
  `liveItemsToKanban(items)` vor `buildStructuredVersionInput`; `boardHash`, `syncLiveBoards` und
  `resetLiveBoard` arbeiten auf der Live-Form.
- **Ops-Prüfung im Endpunkt** je Art: Kanban-Items per zod (inkl. `KANBAN_ORDER_REGEX`), neue Spalten bei
  `lockColumns` abweisen, `columnId` muss eine vorhandene Spalte sein (sonst wie „übersprungen“).
- **Sichern:** Änderungsnotiz „Kanban-Board „…“: n Personen“, sonst unverändert (Entprellung, Bewertung am
  Sitzungsende, Formular übernimmt den Live-Stand).
- `createdBy` stempelt das Lua-Skript mit; die gespeicherte Form verwirft es bisher. Soll eine Karte ihre
  Autorin zeigen, kommt `createdBy` in `KanbanCard` (wie `stampWhiteboardAuthors`).
- Redis-Schlüssel und Kanal behalten ihr Präfix `aiup:wb:` – sie sind je `contentId:key` ohnehin eindeutig.

### 5.2 Client

- Ein Hook für die Sitzung (Snapshot, Ops senden, Echo per `clientId`, Lücken → Neuaufbau), aus
  `live-whiteboard.tsx` herausgelöst und von beiden Oberflächen genutzt.
- Optimistisch: jede Geste wird zur Op, sofort lokal angewendet (`applyKanbanOps`), gebündelt gesendet.
- Während eines Drag werden eingehende Ops gepuffert und danach eingespielt.
- Präsenz in der Kopfleiste, weiche Sperre im Kartendialog („Anna schreibt …“).

### 5.3 Workflows

`content.updated` kommt nur einmal je Sicherung, nicht je Verschieben – ein eigener Schalter
`includeBoardChanges` ist damit nicht nötig. Die Payload bekommt `source: "live"`, damit ein Workflow
Live-Sicherungen bei Bedarf herausfiltern kann (gilt dann auch fürs Whiteboard).

---

## 6. UI (Phase B)

- Komponente `src/components/structures/kanban-board.tsx` mit Modi `readOnly` / `form` / `live`.
- **Drag and Drop** mit `@dnd-kit/core` + `@dnd-kit/sortable` (neue Abhängigkeit): Maus, Touch, Tastatur,
  Screenreader-Ansagen. Dazu im Kartenmenü „Verschieben nach …“ für Mobilgeräte.
- Spalten fester Breite (~272 px), horizontal scrollbar; Spaltentitel direkt editierbar, Kartenzahl im Kopf,
  „+ Karte“ am Spaltenende, „+ Spalte“ rechts (entfällt bei `lockColumns`).
- Karte: Farbstreifen, Titel, Symbol bei Beschreibung. Klick öffnet einen Dialog mit Titel, Beschreibung
  (Markdown mit Vorschau), Farbwahl, Verschieben-nach und Löschen.
- Die Eintragsseite ist `max-w-3xl`: das Board scrollt darin horizontal, dazu „Vollbild“ als Overlay
  (wie beim Whiteboard).
- Eingebunden an drei Stellen: Vorlagen-Editor (in `ELEMENT_TYPES` aufnehmen, Seed-Board, Schalter
  „Spalten festlegen“ und „Alle Mitglieder dürfen bearbeiten“), Formular, Ansicht.
- i18n in `messages/de.json` und `messages/en.json`: Typname, Farbnamen, Editor- und Dialog-Labels.
  Keine `{{ }}`/`<tag>` in Strings.

---

## 7. MCP und Agenten (Phase D)

- `create_entry`/`update_entry` funktionieren über die volle Antwort; die Element-Doku in
  `src/server/mcp/server.ts` (Resource `aiup://docs/collections`) bekommt den Typ `kanban`.
- Neues MCP-Tool `update_board` (Scope `knowledge:write`): `{ entryId, key, ops }` mit Absichten
  (`addCard`, `moveCard`, `updateCard`, …) statt Sortierschlüsseln – der Server übersetzt sie mit den
  Helfern aus `kanban.ts` und schreibt in eine laufende Sitzung, sonst als neue Version.
- Gleichnamiges Agenten-Werkzeug in `src/server/agents/tools/`, Modus `curate`, Freigabe je Aufruf wie
  andere Schreibwerkzeuge; `origin: { kind: "agent" }`.

---

## 8. Phasen

| Phase | Inhalt | Stand |
|---|---|---|
| A | Typen, `kanban.ts`, Validierung, Markdown, Migration, `describe.ts`, Tests | **umgesetzt** 27.09.2026 |
| B | `kanban-board.tsx` (`form`/`readOnly`), Vorlagen-Editor, Formular, Ansicht, i18n, `@dnd-kit` | offen |
| C | Live-Schicht verallgemeinern (5.1), Modus `live`, Session-Hook, Präsenz, Sperre im Dialog | offen |
| D | MCP-Doku, `update_board`, Agenten-Werkzeug, Absatz in `CLAUDE.md` unter „Sammlungen“ | offen |

Vor Abschluss jeder Phase: `npm run typecheck && npm run lint && npm run build && npm run worker:build`
und `npm test`. Phase C mit zwei Identitäten testen (`localhost:3000` und `127.0.0.1:3000`), das Whiteboard
danach erneut (gemeinsame Schicht).

---

## 9. Offene Punkte

- Karten-Zuständige, Fälligkeitsdaten, Kommentare an Karten: bewusst nicht Teil dieser Planung.
- Autorenname an Karten (5.1, `createdBy`).
- Versions-Kompaktierung, falls der Speicher je Board spürbar wächst.
