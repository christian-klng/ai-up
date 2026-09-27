# Whiteboard als Element-Typ (Planung, Stand 27.09.2026)

Ein neuer Element-Typ `whiteboard` für Vorlagen in Sammlungen: eine freie Fläche, auf der Mitglieder
Haftnotizen, Text, Boxen und Bilder platzieren – nach dem Vorbild von Miro. Freier als das
Prozess-Diagramm (`process`), gedacht für Kreativität und gemeinsames Brainstorming.
Die Bezeichnung ist in beiden Sprachen „Whiteboard".

Stand: **Phasen A–C umgesetzt** (27.09.2026), Phase D offen. Abweichungen vom Plan stehen in Abschnitt 8.

---

## 1. Kritische Prüfung gegen die bestehende App

### 1.1 Das Prozess-Diagramm ist die Blaupause – aber nur für den Einzelbetrieb

`process` hat genau den Weg, den ein Whiteboard braucht: Typ in `src/lib/structures/types.ts`, zod-Schema in
`validate.ts`, Markdown in `markdown.ts`, Editor auf `@xyflow/react` (`process-graph-editor.tsx`), per
`dynamic(..., { ssr: false })` in Vorlagen-Editor, Ausfüllformular und Ansicht eingebunden, `seed` als
Vorbelegung aus der Vorlage. Das Whiteboard folgt diesem Muster Schritt für Schritt (Abschnitt 4).

Was `process` **nicht** kann und das Whiteboard braucht: mehrere Menschen gleichzeitig. Daraus ergeben sich
die folgenden Punkte.

### 1.2 Bearbeiten dürfen nur Autor und Admins

`canEditContent()` (`src/server/domain/knowledge.ts:391`) lässt nur den Autor und Admins an einen Eintrag.
Für eine Brainstorming-Runde ist das zu eng – die anderen Teilnehmenden könnten nur zusehen. Das Whiteboard
bekommt deshalb ein **eigenes, schmaleres Recht**: Ist das Element als `collaborative` markiert, darf jedes
aktive Mitglied der Community **dieses eine Element** bearbeiten, nicht aber Titel oder übrige Felder des
Eintrags. Die Grenze liegt beim Element, nicht beim Eintrag.

### 1.3 Jede Speicherung ist eine neue Version

Einträge sind append-only (`addContentVersion`): jeder Save legt eine `content_versions`-Zeile mit vollem
Definitions-Snapshot an, emittiert `content.updated` (→ Workflows) und reiht die LLM-Evaluation ein. Live-Edits
direkt so zu speichern, hieße hunderte Versionen, Workflow-Läufe und LLM-Calls pro Sitzung.
Deshalb: **Live-Zustand in Redis, Version erst beim „Sichern"** (gebündelt, Abschnitt 5.4).

### 1.4 Keine optimistische Sperre beim Speichern

`addContentVersion` prüft keine Basis-Version – wer zuletzt speichert, gewinnt, und zwar für den **ganzen**
Eintrag. Speichert jemand das Formular, während eine Whiteboard-Sitzung läuft, würde der eine den anderen
überschreiben. Lösung: Das Sichern der Sitzung ersetzt nur den eigenen Schlüssel in den Antworten der
*aktuellen* Version (neuer Helfer, Abschnitt 5.4); das Formular übernimmt für kollaborative Whiteboards den
Wert aus der laufenden Sitzung statt aus dem Browser.

### 1.5 Realtime ist nur Server → Client und nur pro Nutzer/Community

Die SSE-Route (`src/app/api/events/route.ts`) abonniert beim Verbindungsaufbau genau zwei Redis-Kanäle:
Nutzer und aktive Community. Es gibt keinen Kanal pro Dokument und keinen Rückkanal außer HTTP.
Ein Whiteboard braucht beides. Plan: **eigener SSE-Stream pro geöffnetem Board** plus ein schlanker
**POST-Endpunkt für Operationen** – beides Route-Handler, keine Server Actions (Next reiht Server Actions
eines Clients nacheinander ein, das kostet bei schnellen Zügen spürbar Latenz).

### 1.6 Typ-Erkennung per Form ist fragil

Antworten werden teils nach **Form** statt nach Element-Typ unterschieden. `isMediaLikeAnswer()` hält jedes
Objekt ohne `nodes` für ein Medium – ein Board `{ items: [...] }` wäre danach „ein Bild ohne URL",
`hasValue()` liefert `false`, `flattenAnswersText()` verschluckt den Text. Muss beim Einbau zuerst gefixt
werden: eigener Guard `isWhiteboardBoard()` und `isMediaLikeAnswer()` schließt `items` aus.

### 1.7 Der App-VPS ist klein

2 vCPU / 3,8 GB. Live-Cursor aller Teilnehmenden per HTTP (30 Personen × 4/s) wären eine Dauerlast, die
über Next und die Session-Prüfung läuft. Deshalb in der ersten Live-Stufe **keine Live-Cursor**, sondern
Präsenz (wer ist da) und Auswahl-Anzeige (wer bearbeitet welche Notiz) – beides ändert sich selten.
Cursor kommen in Phase D und werden dann gemessen.

### 1.8 Neue Einträge haben noch keine Id

Im Formular „Neuer Eintrag" gibt es noch keinen `contentId`, also keinen Raum für eine Sitzung. Das Board
wird dort allein bearbeitet (wie `process`); gemeinsam geht es erst nach dem ersten Speichern.
Das passt zum Ablauf: Moderatorin legt den Eintrag an, teilt den Link, die Runde arbeitet darauf.

---

## 2. Bibliothek: React Flow statt Excalidraw oder tldraw

| | React Flow (`@xyflow/react`) | Excalidraw | tldraw |
|---|---|---|---|
| Schon im Projekt | ja (Prozess-Editor) | nein, großes Bundle | nein |
| Lizenz | MIT | MIT | eigene Lizenz, Produktivbetrieb mit Lizenzschlüssel bzw. Wasserzeichen |
| Datenmodell | unseres | Excalidraw-Szene, Bilder als eingebettete Dateien | tldraw-Store |
| Look | unser Design-System | Handzeichnungs-Stil | eigener |
| Freihand-Zeichnen | nein (später selbst) | ja | ja |

**Entscheidung: React Flow.** Pan/Zoom, Auswahlrahmen, Mehrfachauswahl, Drag, `NodeResizer`, MiniMap und
Tastatur sind vorhanden; Knoten sind React-Komponenten mit Tailwind (Dark Mode, Theme-Farben). Vor allem
bleibt das **Datenmodell unseres** – wichtig, weil daraus Markdown, Suche, Evaluation, MCP und Agenten
lesen und schreiben. tldraw scheidet an der Lizenz aus, Excalidraw an Bundle, Stil und fremdem Szenenformat.
Freihand-Zeichnen fehlt; es ist für Brainstorming mit Notizen verzichtbar und bleibt eine Option für Phase D.

---

## 3. Datenmodell

Alles pure TS in `src/lib/structures/` (Worker-tauglich, keine `next/*`-Imports).

```ts
export type WhiteboardColor = "yellow" | "orange" | "green" | "blue" | "purple" | "pink" | "gray" | "white";

export type WhiteboardItem = {
  id: string;                       // ^[A-Za-z0-9_-]{1,40}$, vom Client erzeugt (nanoid)
  kind: "sticky" | "text" | "shape" | "image";
  x: number; y: number;             // Weltkoordinaten, |v| <= 100_000
  w: number; h: number;             // 20..4000
  z: number;                        // Stapelreihenfolge
  text?: string;                    // Klartext mit Zeilenumbrüchen, max. 2000 (sticky/text/shape)
  color?: WhiteboardColor;          // Token, kein Hex – Dark Mode bleibt lesbar
  shape?: "rect" | "ellipse";       // nur kind "shape"
  fontSize?: "s" | "m" | "l" | "xl";
  mediaId?: string; url?: string; alt?: string; // nur kind "image", Regeln wie ImageAnswer
  locked?: boolean;                 // aus der Vorlage: Gerüst, beim Ausfüllen nicht verschieb-/löschbar
  createdBy?: string;               // User-Id, vom Server gesetzt – zeigt, von wem eine Idee stammt
};

export type WhiteboardBoard = { items: WhiteboardItem[] };

// Element:
| (StructureElementBase & { type: "whiteboard"; seed?: WhiteboardBoard; collaborative?: boolean })
```

- **Farben als Token**: Die Palette wird in der Komponente auf Tailwind-Klassen abgebildet, je mit
  Dark-Mode-Variante. Hex-Werte in den Daten würden im dunklen Theme unlesbar.
- **Kein Rich-Text in Notizen.** Klartext hält Markdown, Suche und LLM-Auswertung einfach. Kein `rotation`
  in v1.
- **`seed` mit `locked`-Elementen** macht Vorlagen möglich: Retrospektive (drei Spalten „Gut / Schlecht /
  Ideen" als gesperrte Boxen), SWOT-Quadranten, Lean Canvas. Die Admins bauen das Gerüst im Vorlagen-Editor.
- **`collaborative`** (Standard `true`, siehe Offene Entscheidungen): gemeinsames Bearbeiten nach 1.2.
- **Grenzen**: max. 500 Items, JSON max. ~500 kB pro Board. Liegt unter dem `bodySizeLimit` von 5 MB.
- **Positionen optional beim Schreiben über MCP/Agenten**: LLMs platzieren schlecht. Fehlende `x/y/w/h`
  füllt eine reine Funktion `layoutMissingItems()` deterministisch in einem Raster unterhalb des bestehenden
  Inhalts auf – innerhalb der Normalisierung in `validateStructureAnswers`.

---

## 4. Einbau in die Strukturen (Einzelbearbeitung)

| Datei | Änderung |
|---|---|
| `types.ts` | Typen oben, `isWhiteboardBoard()`, `isMediaLikeAnswer()` schließt `items` aus (1.6), `fillProcessSeeds()` füllt auch Whiteboard-Seeds (umbenennen in `fillSeeds()`), `emptyWhiteboard()` |
| `validate.ts` | `whiteboardItemSchema`/`whiteboardBoardSchema`; Definition: Seed prüfen (doppelte Ids, Grenzen); Antwort: Items parsen, `layoutMissingItems`, gesperrte Seed-Items gegen Veränderung absichern (sie werden aus dem Seed übernommen, nicht aus der Eingabe), `createdBy` nie aus der Eingabe übernehmen |
| `visibility.ts` | `hasValue()`: Board zählt als beantwortet, sobald es ein nicht gesperrtes Item mit Text oder Bild gibt – `required` heißt „mindestens eine eigene Idee" |
| `markdown.ts` | Renderer und `flattenAnswersText()` (siehe unten) |
| `migrate.ts` | `whiteboard` → gleicher Typ, Wert unverändert übernehmen |
| `structure-editor.tsx` | Typ in `ELEMENT_TYPES`, Icon (`presentation` o. ä.), Seed-Editor mit Schalter „gesperrt", Schalter „Gemeinsam bearbeitbar" |
| `structure-fill-form.tsx` | Board-Vorschau + „Whiteboard öffnen" (Vollbild) |
| `structured-content-view.tsx` | Nur-Lese-Ansicht mit `fitView`, Pan/Zoom, Knopf „Vollbild" |
| `agents/tools/describe.ts`, `mcp/server.ts` | Typbeschreibung und Board-Form in `aiup://docs/collections` |
| `messages/de.json`, `messages/en.json` | Namespace `knowledge.structured.whiteboard` |

### Markdown (deterministisch)

Ein Board ist räumlich, Suche, Verlauf, Diff und Evaluation brauchen Text. Regeln:

1. **Boxen sind Gruppen.** Ein Item gehört zur kleinsten `shape`, die seinen Mittelpunkt enthält (Boxen
   dürfen verschachtelt sein, gerendert bis Tiefe 3).
2. **Lesereihenfolge**: oben nach unten, links nach rechts; Items mit weniger als 40 px Höhenunterschied
   zählen als eine Zeile.
3. Ausgabe:

```markdown
## Brainstorming

- Idee ohne Box
- ![Skizze Startseite](/api/files/…)

### Was lief gut
- Schnelles Onboarding
- Gute Doku

### Was verbessern
- …
```

Freie Items stehen vorn ohne Überschrift – so braucht der Renderer keinen übersetzten Text („Weitere
Notizen"). Leere Items werden übersprungen. `flattenAnswersText()` nimmt alle Texte und `alt`-Texte auf.
Unit-Tests (`vitest`) für Gruppierung, Reihenfolge und Grenzfälle.

### Editor (`whiteboard-editor.tsx`)

- **Vollbild** (eigene Route `/knowledge/[slug]/[contentId]/board/[key]` bzw. Vollbild-Dialog im
  Formular): Ein Whiteboard in `max-w-3xl` ist nicht benutzbar.
- **Werkzeugleiste links**: Auswählen · Hand · Haftnotiz (mit Farbwahl) · Text · Box (Rechteck/Ellipse) ·
  Bild · Löschen. Unten rechts Zoom, MiniMap.
- **Schnellwege wie in Miro**: Doppelklick auf die Fläche = neue Haftnotiz, Doppelklick auf ein Item = Text
  inline bearbeiten, `Entf`, `⌘D` Duplizieren, `⌘C/⌘V` innerhalb des Boards, Pfeiltasten verschieben.
- **Bilder**: Drag & Drop, Einfügen aus der Zwischenablage, Dateiauswahl – alles über `/api/upload`
  (`purpose: "content"`, Magic-Bytes-Prüfung wie gehabt), danach Image-Item mit `mediaId`.
- **Stapelreihenfolge**: „Nach vorn / Nach hinten" im Kontextmenü.
- Nutzt dieselben Emit-nach-Commit-Regeln wie `process-graph-editor.tsx` (ReactFlow feuert Änderungen
  beim Rendern).
- **Mobil**: Ansehen, Zoomen, Haftnotiz hinzufügen. Volle Bearbeitung ist Desktop-first.

---

## 5. Live-Zusammenarbeit

### 5.1 Ablauf

1. Jemand öffnet das Board eines gespeicherten Eintrags → `GET /api/whiteboards/<contentId>/<key>/events`
   (SSE). Die Route prüft Session, Community-Zugehörigkeit und `collaborative`, lädt den Zustand (Redis,
   sonst aus der aktuellen Version) und schickt als erstes Frame `{ seq, items, participants, token }`.
2. Änderungen gehen als Stapel an `POST /api/whiteboards/<contentId>/<key>/ops` mit `token`.
3. Der Server wendet sie atomar an, vergibt eine fortlaufende `seq` und veröffentlicht sie auf
   `aiup:rt:wb:<contentId>:<key>`. Alle Streams leiten weiter; der eigene Client erkennt sein Echo an der
   `clientId`.

### 5.2 Konfliktmodell: letzter Schreiber gewinnt – pro Item

Kein CRDT. Miro arbeitet ebenfalls auf Item-Ebene. Operationen:

```ts
type WhiteboardOp =
  | { op: "upsert"; item: WhiteboardItem }   // ganzes Item, nicht Teilfelder
  | { op: "delete"; id: string }
  | { op: "select"; ids: string[] }          // nur Präsenz, wird nicht gespeichert
  | { op: "editing"; id: string | null };    // weiche Sperre beim Tippen
```

- Zustand in Redis: Hash `aiup:wb:<contentId>:<key>` (Item-Id → JSON), Zähler `…:seq`. Anwenden per
  Lua-Skript: Item-Limit prüfen, gesperrte Items ablehnen, `createdBy` setzen, `seq` hochzählen.
- **Gleichzeitiges Tippen in derselben Notiz** verhindert eine weiche Sperre: Wer tippt, meldet `editing`;
  die anderen sehen „Anna schreibt …" und können die Notiz 30 s lang nicht bearbeiten (verfällt ohne
  Heartbeat). Text wird mit 300 ms Verzögerung als `upsert` gesendet.
- **Wiederverbindung**: Das bestehende `sync`-Muster – nach Reconnect kommt ein neuer Snapshot mit `seq`,
  Lücken in der Folge lösen ebenfalls einen Neu-Abruf aus.
- Datenmodell ist bewusst eine Map von Items mit Id. Sollte später ein CRDT nötig werden (Yjs + eigener
  WebSocket-Dienst), lässt es sich 1:1 auf eine `Y.Map` abbilden.

### 5.3 Präsenz und Rechte

- Sorted Set `aiup:wb:presence:<contentId>:<key>` (User-Id → Zeitstempel), vom offenen Stream alle 15 s
  erneuert, beim Abbruch entfernt. Kopfleiste zeigt Avatare; ausgewählte Items bekommen einen farbigen Rand
  mit Namen.
- **Kurzlebiger Board-Token** (HMAC über `userId`, `communityId`, `contentId`, `key`, Ablauf 10 min, über den
  Stream erneuert): Der Ops-Endpunkt prüft nur die Signatur statt pro Zug Session und Mitgliedschaft aus der
  DB zu laden. Eine Sperre greift damit spätestens nach 10 min – vertretbar.
- Ratenbegrenzung pro Nutzer und Board (z. B. 20 Stapel/s), Größenbegrenzung pro Stapel.
- Gelöschte Einträge: Token-Ausgabe und Sichern prüfen `deletedAt`; der Redis-Zustand wird verworfen.

### 5.4 Sichern als Version

- Jede Operation (re)plant einen BullMQ-Job `{ kind: "whiteboard-flush" }` mit JobId
  `wb-flush-<contentId>-<key>` (kein `:`!) und Entprellung: **60 s nach der letzten Änderung**, spätestens
  alle **10 min** während langer Sitzungen, sofort wenn der letzte Teilnehmende geht.
- Neuer Domänen-Helfer `replaceStructuredAnswer(communityId, contentId, key, value, editorId, opts)` in
  `structured-entries.ts`: liest die **aktuelle** Version unter Zeilensperre (`SELECT … FOR UPDATE` auf
  `contents`), ersetzt nur diesen Schlüssel, baut die Version über `buildStructuredVersionInput` (gleiche
  Validierung, gleiches Markdown) und hängt sie an. Ohne Änderung seit dem letzten Sichern: keine Version.
- Autor der Version: wer zuletzt geändert hat; Änderungsnotiz mit Anzahl Beteiligter.
- **Evaluation nur beim letzten Sichern einer Sitzung** (letzter Teilnehmender weg bzw. Ruhe), nicht bei
  jedem Zwischenstand – analog zur gebündelten Evaluation bei Agenten.
- **Formular-Save** eines Eintrags mit kollaborativem Whiteboard nimmt dessen Wert aus Redis bzw. der
  aktuellen Version, nicht aus dem Formular (1.4). Das Formular zeigt das Board nur als Vorschau mit
  „Im Whiteboard bearbeiten".
- **Wiederherstellen einer alten Version** setzt den Live-Zustand zurück und schickt `whiteboard.reset`
  mit neuem Snapshot an alle offenen Boards.

---

## 6. Phasen

| Phase | Inhalt | Ergebnis |
|---|---|---|
| **A** Datenmodell | Typen, Schemas, Guards (1.6), Markdown, `layoutMissingItems`, Migration, Tests, MCP-Doku + `describe.ts` | Boards per MCP/Agent anlegbar, Markdown/Suche/Evaluation funktionieren |
| **B** Editor | `whiteboard-editor.tsx`, Vollbild-Route, Upload, Nur-Lese-Ansicht, Seed-Editor mit Sperre, i18n | Einzelbearbeitung wie beim Prozess-Diagramm |
| **C** Live | Redis-Zustand, Ops-Endpunkt, Board-SSE, Token, Präsenz, weiche Sperre, Flush-Job, Formular-Merge, Reset bei Restore | Gemeinsames Brainstorming |
| **D** Ausbau (je einzeln) | Live-Cursor (gemessen, gedrosselt), Undo/Redo der eigenen Züge, Pfeile zwischen Items, Rahmen/Frames, Freihand, PNG-Export, Agent schreibt in die laufende Sitzung („Ideen clustern"), Board im Meeting öffnen | – |

A und B sind klein und risikoarm. C ist der eigentliche Aufwand; vorher mit zwei Identitäten lokal
(`localhost` + `127.0.0.1`) und danach mit einer echten Runde von 5–10 Personen auf dem Produktiv-VPS
testen, CPU und Redis dabei beobachten.

Vor Abschluss jeder Phase: `npm run typecheck && npm run lint && npm run build && npm run worker:build`
und `npm test`.

---

## 7. Offene Entscheidungen

1. **Reihenfolge**: A + B zuerst ausliefern und C direkt danach – oder C als Bedingung für den ersten
   Release? *Empfehlung: A + B zuerst; ohne C ist das Whiteboard schon als Einzelwerkzeug und für
   Agenten-Ergebnisse nützlich.*
2. **Wer darf mitschreiben**: `collaborative` standardmäßig an (alle aktiven Mitglieder dürfen das Board
   bearbeiten) oder aus (nur Autor/Admins, andere schauen live zu)? *Empfehlung: an – das ist der Zweck.*
3. **Pfeile/Verbindungen** schon in B? *Empfehlung: nein, Boxen als Gruppen reichen fürs Clustern;
   Pfeile verwässern den Unterschied zum Prozess-Diagramm.*
4. **Namensanzeige an Notizen** (`createdBy` sichtbar) immer, nie oder schaltbar? Anonymes Brainstorming
   kann offener sein. *Empfehlung: gespeichert immer, angezeigt per Schalter in der Kopfleiste.*

---

## 8. Umsetzung (27.09.2026)

Entscheidungen aus Abschnitt 7: A–C in einem Zug, `collaborative` standardmäßig an, keine Pfeile,
Namen an Notizen gespeichert und per Schalter (Person-Symbol oben rechts) einblendbar, Standard aus.

| Baustein | Datei |
|---|---|
| Typen, Guards, `fillSeeds` | `src/lib/structures/types.ts` |
| Schema, Layout, Sperren, Autorenschaft, Markdown, Ops | `src/lib/structures/whiteboard.ts` (+ `whiteboard.test.ts`) |
| Editor (React Flow), Formularfeld | `src/components/structures/whiteboard-editor.tsx` |
| Anzeige im Eintrag + Einstieg in die Sitzung | `src/components/structures/whiteboard-section.tsx` |
| Live-Client | `src/components/structures/live-whiteboard.tsx`, Wire-Format `src/lib/whiteboard-live.ts` |
| Redis-Zustand (Lua), Präsenz, Sperren, Token | `src/server/whiteboards/state.ts` |
| Zugriff, Autorennamen | `src/server/whiteboards/access.ts` |
| Sichern als Version (Worker-Job `whiteboard-flush`) | `src/server/whiteboards/flush.ts`, `worker/index.ts` |
| Event-Stream / Ops | `src/app/api/whiteboards/[contentId]/[key]/events|ops/route.ts` |

Abweichungen und Präzisierungen:

- **Vollbild als Overlay statt eigener Route.** Die Sitzung öffnet sich über „Whiteboard öffnen" auf der
  Eintragsseite; eine eigene Route hätte nichts gebracht außer einem zweiten Seitenaufbau.
- **Bestehende Einträge bearbeiten ihre Boards nur live** – auch nicht-kollaborative (dann dürfen nur Autor
  und Admins hinein). Das Formular zeigt das Board nur an; `saveStructuredEntryAction` übernimmt den Stand
  der laufenden Sitzung bzw. der aktuellen Version und markiert die Sitzung danach als gesichert, damit am
  Sitzungsende keine doppelte Version entsteht. Beim Anlegen wird das Board lokal im Formular gefüllt.
- **Entprellung ohne BullMQ-Deduplizierung:** ein Job je Board (`wb-<contentId>-<key>`), der sich per
  `moveToDelayed` selbst verschiebt, solange die Sitzung aktiv ist (60 s Ruhe, spätestens 10 min).
  Letzte Person geht → Job wird auf 5 s vorgezogen. Sicherheitsnetz im Heartbeat des Streams.
- **Schreibzugriffe von außen** (Wiederherstellen, MCP, Agent) ersetzen eine laufende Sitzung nur, wenn sie
  das Board tatsächlich ändern – verglichen per Hash gegen den Stand, auf dem die Sitzung aufsetzt
  (`resetLiveBoard`). Ein reiner Titelwechsel per MCP verwirft also keine ungesicherten Live-Änderungen.
- **Reihenfolge:** Das Lua-Skript veröffentlicht die Ops selbst, dadurch ist die Kanal-Reihenfolge gleich der
  `seq`-Reihenfolge. Eine Lücke löst beim Client einen Neuaufbau aus.
- Toasts im Whiteboard erscheinen unten mittig – oben rechts verdeckten sie den Schließen-Knopf.

Getestet lokal mit zwei Identitäten (`localhost` + `127.0.0.1`): Synchronisierung von Anlegen, Text und
Verschieben, Präsenz, weiche Sperre inkl. Ablehnung des Verschiebens, Reset bei Wiederherstellen,
Formular-Speichern während der Sitzung, Sichern nach Sitzungsende, Aufräumen des Redis-Zustands.

**Noch nicht erprobt:** eine echte Runde mit 5–10 Personen auf dem Produktiv-VPS (Last, Traefik und SSE).
