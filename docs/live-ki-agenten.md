# Live-KI-Agenten in Meetings (Planung, Stand 27.09.2026)

KI-Agenten hören in laufenden Meetings mit und schreiben in kurzen Abständen Vorschläge in den Call –
sichtbar für alle Teilnehmenden. Wer ein Meeting anlegt, legt pro Meeting beliebig viele Agenten an, jeder mit
eigener Aufgabe („mache laufend Vorschläge für Verbesserungen", „prüfe laufend, ob wir wichtige Aspekte
übersehen haben") und eigenem Zugriff auf Sammlungen. Grundlage ist ein **Live-Transkript**, das ein
serverseitiger Zuhörer (LiveKit-Agent) aus den Tonspuren aller Teilnehmenden erzeugt.

Stand: **Phase 0–B teilweise umgesetzt** – Live-Transkript läuft Ende-zu-Ende bis in die Datenbank, Meeting-Agenten (Phase C) fehlen noch; Mistral-Test in Produktion steht aus (Abschnitt 14). Nachträgliche Transkription (`transcribe` → `set_meeting_transcript`)
bleibt unverändert bestehen.

---

## 1. Entscheidungen (Christian, 27.09.2026)

1. **Antworten sind für alle sichtbar.** Zustellung über den Datenkanal des LiveKit-Raums.
2. **Agenten mit Sammlungszugriff, pro Meeting.** Wer das Meeting bearbeiten darf (`canEditMeeting`: Host,
   Ersteller, Admin), legt Agenten mit Name, Aufgabe und Sammlungsauswahl an.
3. **Die Community zahlt.** Transkriptions- und LLM-Kosten laufen über die Zugangsdaten, die der Admin der
   jeweiligen Community hinterlegt – nicht über den Betreiber, nicht über das Wochenkontingent einzelner Nutzer.
4. **Aufnahme-Hinweis.** Sind KI-Agenten aktiv, zeigt der Call denselben Hinweis „wird aufgenommen" wie bei einem
   Audio-Mitschnitt.
5. **Das Live-Transkript wird gespeichert**, auch wenn es vorerst nur den Agenten dient.

---

## 2. Kritische Prüfung gegen die bestehende App

### 2.1 Es gibt kein Live-Audio auf dem Server

Heute verlässt Ton den Media-Server nur als fertige Datei (Egress → Bucket → Import nach dem Meeting). Für
Live-Transkripte muss ein Teilnehmer **im Raum** sitzen, der alle Tonspuren abonniert. Das ist ein neuer,
dauerhaft laufender Dienst – der eigentliche Kern dieses Plans (Abschnitt 4).

### 2.2 Scaleway kann kein Streaming

Scaleway bietet nur `/audio/transcriptions` für ganze Dateien (Beta, 25 MB, 30-s-Stücke; Voxtral dort seit
01.08.2026 abgeschaltet). Ein Stückeln über Scaleway-Whisper wäre möglich, aber kein echtes Streaming und hätte
20–40 s Verzögerung. Für den Zuhörer braucht es einen **Streaming-Anbieter mit EU-Hosting** (Abschnitt 5).
Für die Vorschläge selbst (LLM) bleibt Scaleway.

### 2.3 LiveKits Agenten-Vorlage hört nur einer Person zu

Eine `AgentSession` aus `@livekit/agents` bindet sich an **einen** Teilnehmenden. LiveKits Muster für
„alle transkribieren" (eine Session pro Person) gibt es nur als Python-Beispiel, und es gibt ein offenes Issue,
dass Transkripte nur für die erste Person ankommen (livekit/agents#3657). Wir nutzen deshalb **keine
`AgentSession`**, sondern abonnieren im Job jede Tonspur selbst (`AudioStream` aus `@livekit/rtc-node`) und
füttern je Spur einen eigenen STT-Stream. Das Agents-Framework dient nur als Hülle für Dispatch und
Job-Verwaltung (Abschnitt 4.2).

### 2.4 Der KI-Agenten-Loop ist an Threads gebunden

`runTurn(threadId)` (`src/server/agents/loop.ts`) lädt Thread, Nachrichten und Konfiguration, streamt per
`publishToUser` an eine Person und zählt Verbrauch über `agent_messages` → `agent_threads.userId`. Nichts davon
passt auf „ein Meeting, viele Agenten, Ausgabe an alle". Wiederverwendbar sind die Bausteine:
`listTools("read")`, `toolDefinitions()`, `getTool()`, `buildSystemPrompt()`, `resolveModel()`/`clientConfigFor()`,
`streamChatCompletion()`. `runTool()` und `roleInCommunity()` sind privat und werden exportiert. Daraus entsteht
ein **zweiter, schlanker Loop** `runMeetingAgentTick()` (Abschnitt 6.2) – kein Umbau von `runTurn`.

### 2.5 Sammlungen haben keine Zugriffsrechte – gut für „für alle sichtbar"

Jedes aktive Mitglied darf jede Sammlung lesen (`docs/ki-agenten.md` 1.4). Dass Agenten-Antworten aus Sammlungen
zitieren und alle im Call sie sehen, gibt also nichts preis, was die Teilnehmenden nicht ohnehin lesen dürften.
Gäste über den Meeting-Einladungslink sind ebenfalls Mitglieder. **Sollte es später Sammlungs-Rechte geben**,
muss die Agenten-Auswahl auf Sammlungen beschränkt werden, die *alle* Teilnehmenden lesen dürfen – als Merkposten
in `docs/ki-agenten.md` vermerken.

### 2.6 Budget hängt heute an Personen

`communities.agentWeeklyTokenBudget` begrenzt je Nutzer und Woche, gezählt über Threads. Live-Agenten gehören
keiner Person, sondern der Community (Entscheidung 3). Sie bekommen deshalb eine **eigene Verbrauchstabelle und
eigene Grenzen** (Abschnitt 7) und belasten das Wochenkontingent niemandes.

### 2.7 Ein Teilnehmer, der nicht als Kachel erscheinen darf

Der Zuhörer ist technisch ein Teilnehmer. `participant_joined` ignoriert bereits Nicht-STANDARD-Teilnehmende
(`livekit.ts:135`), zählt ihn also nicht mit. Offen ist, ob `VideoConference` einen Agenten-Teilnehmer ohne
Kamera als leere Kachel zeigt – im Spike prüfen und notfalls im Grid nach `participant.kind` filtern.

### 2.8 Der App-VPS ist zu klein, das Alpine-Image passt nicht

Der App-Server hat 2 vCPU / 3,8 GB und braucht schon für `next build` Swap. Sprachpausen-Erkennung (Silero VAD)
kostet CPU pro Tonspur. Außerdem liefert `@livekit/rtc-node` native Rust-Binaries, voraussichtlich nur für glibc –
das App-Image ist `node:24-alpine` (musl). Der Zuhörer bekommt daher ein **eigenes, schlankes Debian-Image** und
läuft auf dem **Media-VPS** (4 vCPU / 7,6 GB, derzeit fast leer, im selben Rechenzentrum wie LiveKit).

### 2.9 Kein privates Netz zwischen den Servern

Der Media-VPS erreicht Postgres und Redis der App nicht (und soll es nicht). Der Zuhörer spricht deshalb
**nur über eine interne, signierte HTTP-Schnittstelle** mit der App (Abschnitt 4.4) – kein Datenbankzugriff,
keine Zugangsdaten zur App-Datenbank auf dem Media-Server.

### 2.10 Reliable-Datenpakete sind klein

`RoomServiceClient.sendData` (Server-SDK, braucht roomAdmin) schickt Pakete bis ca. **15 KiB**. Agenten-Vorschläge
sind kurz; längere Antworten werden gekürzt bzw. nur als Verweis geschickt und vom Client nachgeladen.
Text-Streams (`sendText`) gingen nur über eine Teilnehmer-Verbindung, also über den Zuhörer.

---

## 3. Überblick

```
Browser (alle)        LiveKit (Media-VPS)          Zuhörer (Media-VPS)         App (web + worker)
──────────────        ───────────────────          ───────────────────         ──────────────────
Ton ──────────────▶   Raum m-<id>  ──Tonspuren──▶  je Spur: VAD → STT-Stream
                                                   (Mistral/Deepgram, EU)
                      ◀── lk.transcription ──────  finale Segmente ──POST──▶   /api/internal/live/segments
Live-Untertitel                                                                 → meeting_transcript_segments
(optional)                                                                      → Job meeting-agent-tick (je Agent,
                                                                                  gedrosselt)
                                                                                worker: Transkript-Fenster +
                                                                                Aufgabe + Lese-Tools → LLM
                      ◀── sendData(topic aiup.agent) ─────────────────────────  → meeting_agent_messages
Panel „KI-Agenten"
```

Start: Beim `room_started`-Webhook (oder wenn während eines laufenden Meetings der erste Agent eingeschaltet
wird) ruft die App `AgentDispatchClient.createDispatch(room, "aiup-listener", { metadata })` auf. Ende: beim
`room_finished` bzw. wenn der letzte Agent ausgeschaltet wird, verlässt der Zuhörer den Raum.

---

## 4. Der Zuhörer (`listener/`)

### 4.1 Aufgabe – und nur diese

Tonspuren abonnieren, Sprache erkennen, finale Segmente an die App melden und als `lk.transcription` in den Raum
schreiben. **Kein LLM, keine Datenbank, keine Fachlogik.** Alles Denken passiert in der App.

### 4.2 Framework: Agents-Hülle, eigene Audio-Verarbeitung

- `@livekit/agents` (Node, v1.9.x) für Registrierung am LiveKit-Server, **expliziten Dispatch**
  (`agentName: "aiup-listener"`) und Job-Lebenszyklus. LiveKit v1.13.5 unterstützt das (Agent-Protokoll v2
  seit v1.7.2).
- Im Job **keine `AgentSession`** (siehe 2.3). Stattdessen: bei `TrackSubscribed` (Audio) eine `AudioStream`
  öffnen (16 kHz, mono), Silero-VAD (`@livekit/agents-plugin-silero`) davorschalten und nur bei Sprache an den
  STT-Stream des Plugins senden (`stt.stream()`).
- **Warum VAD vor dem Anbieter:** Streaming-STT wird pro Audiominute und **pro Spur** abgerechnet. Ohne Sprachpausen
  kostet ein Meeting mit 30 Personen × 60 Minuten 1.800 Minuten; mit VAD ungefähr die tatsächliche Sprechzeit
  (≈ 60–90 Minuten). Das ist der größte Kostenhebel des ganzen Vorhabens.
- Sprecherzuordnung ergibt sich aus der Spur: Identität = `user.id`, Name aus dem Token.
- Rückfall, falls die Agents-Hülle im Spike Probleme macht: nur `@livekit/rtc-node` mit einem Token mit
  `hidden: true` und eigener Job-Verwaltung (Webhook → App → Zuhörer).

### 4.3 Ausgaben

- **Transkript an den Raum:** Text-Stream auf Topic `lk.transcription` mit `lk.transcribed_track_id` und
  `lk.transcription_final`, Absender = transkribierte Person. So funktioniert `useTranscriptions()` aus
  `@livekit/components-react` ohne Eigenbau (Live-Untertitel, Abschnitt 8.3).
- **Transkript an die App:** finale Segmente gebündelt alle ~5 s per POST (Abschnitt 4.4). Bei Fehlern
  puffern und wiederholen; jedes Segment hat eine vom Zuhörer vergebene Id, die App speichert idempotent.

### 4.4 Interne Schnittstelle App ↔ Zuhörer

Zwei Routen unter `src/app/api/internal/live/`, nicht öffentlich verlinkt, signiert per HMAC mit einem eigenen
Geheimnis (`LISTENER_SHARED_SECRET`, in beiden Coolify-Ressourcen), Zeitstempel gegen Wiederholung:

| Route | Zweck |
|---|---|
| `GET config?meetingId=` | beim Job-Start: Community, STT-Anbieter + Schlüssel (entschlüsselt, nur über TLS), Sprache, Wortliste (Namen, Fachbegriffe aus Meeting-Titel/-Beschreibung), ob Agenten aktiv sind |
| `POST segments` | Stapel finaler Segmente `{segmentId, participantIdentity, name, trackSid, startedAt, endedAt, text, language}` + Verbrauch (Audio-Sekunden je Spur) |

Die STT-Zugangsdaten liegen damit nur in der App-Datenbank (verschlüsselt, pro Community) und werden je Job
abgeholt – nicht im Dispatch-Metadatenfeld, das über den LiveKit-Server läuft.

### 4.5 Betrieb

- Code im Repo unter `listener/` (TypeScript, importiert **nur** reine Module aus `src/lib/`, nichts aus
  `src/server/`), Bundle per esbuild wie der Worker.
- Eigenes `deploy/listener/Dockerfile` (`node:24-slim`), eigene Coolify-Ressource auf dem Media-VPS, Env:
  `LIVEKIT_URL` (intern `ws://livekit:7880` bzw. `wss://meet…`), `LIVEKIT_API_KEY/SECRET`, `APP_URL`,
  `LISTENER_SHARED_SECRET`.
- Kapazität laut LiveKit: 4 Kerne / 8 GB für 10–25 gleichzeitige Jobs; wir teilen die Maschine mit SFU und Egress.
  Grenze über `numIdleProcesses`/Lastschwelle der Agents-Hülle; im Spike pro Spur messen.

---

## 5. Transkriptionsanbieter

Pro Community wählbar, Schlüssel hinterlegt der Community-Admin (Entscheidung 3). Kandidaten mit EU-Hosting und
Node-Plugin:

| Anbieter | EU | Deutsch | Preis (Pay-as-you-go) | Node-Plugin |
|---|---|---|---|---|
| **Mistral Voxtral Realtime** | ja, Standard | ja (13 Sprachen) | ca. 0,006 $/min | `mistralai` |
| **Deepgram Nova-3** | ja, `api.eu.deepgram.com` | ja (multilingual) | ca. 0,006–0,009 $/min | `deepgram` (`baseUrl`) |
| AssemblyAI Universal-Streaming | ja, `streaming.eu.assemblyai.com` | ja | ca. 0,15 $/h | `assemblyai` (`baseUrl`) |

Speechmatics und Gladia haben kein Node-Plugin; OpenAI-Realtime braucht für EU-Residency ein freigeschaltetes
EU-Projekt. **Vorschlag: Mistral als Standard, Deepgram EU als zweite Option** – beide im Spike mit deutscher
Testaufnahme vergleichen (Genauigkeit, Latenz, Namen). Preise sind Anbieterangaben vom 27.09.2026.

Grobe Kosten pro Meeting-Stunde mit VAD: Transkription ≈ 0,40–0,80 $, dazu LLM (Abschnitt 6.3).

---

## 6. Meeting-Agenten

### 6.1 Datenmodell

| Tabelle | Inhalt |
|---|---|
| `meeting_agents` | `id`, `communityId`, `meetingId`, `name`, `task` (Aufgabe, Freitext, max. 4.000 Zeichen), `intervalSeconds` (Takt, Standard 120, min. 60), `enabled`, `createdBy`, Zeitstempel |
| `meeting_agent_collections` | `(meetingAgentId, areaId)` – leer = alle Sammlungen, wie beim Handlungsradius |
| `meeting_transcript_segments` | `id` (vom Zuhörer), `meetingId`, `session` (Raum-Sid, trennt wiedereröffnete Meetings), `userId`, `speakerName`, `startedAt`, `endedAt`, `text`, `language` |
| `meeting_agent_messages` | `id`, `meetingAgentId`, `meetingId`, `body` (Markdown), `basedOnSegmentId` (bis wohin das Transkript berücksichtigt ist), `usage` (Tokens), `status` (`posted`/`skipped`/`error`), Zeitstempel |
| `meeting_live_usage` | je Meeting und Tag: Audio-Sekunden (STT) und gewichtete Tokens (LLM) – Grundlage für Grenzen und Übersicht |

`meetings` bekommt `liveStatus` (`off`/`starting`/`listening`/`failed`) für Hinweis und Admin-Anzeige.
Alle Tabellen hängen per Cascade am Meeting bzw. an der Community (Soft-Delete/Purge funktionieren wie gehabt).

### 6.2 Ablauf eines Agenten-Takts (Worker)

1. `POST segments` speichert und reiht je aktivem Agenten einen Job `{kind:"meeting-agent-tick", meetingAgentId}`
   ein – **gedrosselt** über die Job-Id `magent-<agentId>-<Zeitfenster>` (Fenster = `intervalSeconds`), also höchstens
   ein Takt pro Fenster und nie zwei gleichzeitig für denselben Agenten.
2. Der Takt läuft nur, wenn seit `basedOnSegmentId` der letzten Nachricht genug Neues gesagt wurde
   (Mindestwortzahl, z. B. 40).
3. `runMeetingAgentTick()` baut den Kontext:
   - System-Prompt: fester Rahmen für Live-Agenten („kurz, konkret, keine Wiederholung, antworte `NOTHING`, wenn
     es nichts Neues gibt") + Meeting-Titel, -Beschreibung, Protokoll-Stand + **Aufgabe des Agenten**.
   - Transkript: die letzten ~10 Minuten wörtlich, davor eine laufende Kurzfassung (alle ~15 Minuten per LLM
     fortgeschrieben, in Redis) – sonst wächst jeder Aufruf mit der Meeting-Länge.
   - Die eigenen bisherigen Nachrichten (gegen Wiederholungen).
   - Werkzeuge: nur `listTools("read")`, `readAreaIds` = Sammlungsauswahl, handelnd als `createdBy` des Agenten.
     Harte Grenze z. B. 4 Schritte pro Takt. **Keine Schreib-Werkzeuge** im Live-Betrieb.
4. Antwort `NOTHING` → `status: skipped`, nichts wird gesendet. Sonst speichern und per
   `RoomServiceClient.sendData(room, …, { topic: "aiup.agent" })` an alle im Raum; über ~12 KiB wird gekürzt und
   ein Verweis mitgeschickt.
5. Verbrauch in `meeting_live_usage`, Grenzen prüfen (Abschnitt 7).

Seiteneffekte tragen `origin: { kind: "agent" }`. Der Takt schickt nichts per `publishToUser`; wer später
beitritt, lädt den bisherigen Verlauf beim Öffnen des Calls vom Server.

### 6.3 LLM-Kosten

Pro Agent und Stunde bei 120-s-Takt höchstens 30 Aufrufe; mit Kurzfassung ca. 4–8 k Eingabe-Tokens je Aufruf.
Bei Scaleway-Preisen ist das klein gegenüber der Transkription, wächst aber linear mit der Zahl der Agenten.
Deshalb Obergrenze **Agenten pro Meeting** (Standard 3).

### 6.4 Oberfläche zum Anlegen

- Meeting-Seite, Bereich „KI-Agenten" (für `canEditMeeting`): Liste, anlegen/bearbeiten/löschen, Schalter an/aus –
  auch **während** des laufenden Meetings.
- Formular: Name, Aufgabe (mit zwei, drei Beispielen als Vorlage), Takt (1/2/5 Minuten), Sammlungen über
  `collection-tree.tsx` wie im Handlungsradius.
- Nur sichtbar, wenn die Community Live-KI eingerichtet hat (Abschnitt 7) und der Betreiber den Dienst anbietet.

---

## 7. Einrichtung, Kosten, Grenzen

**Betreiber (Root, *Verwaltung → Integrationen → LiveKit*):** Schalter „Live-KI-Dienst verfügbar" + Prüfknopf
(Zuhörer registriert?). Der Zuhörer ist geteilte Infrastruktur wie LiveKit selbst.

**Community-Admin (*Verwaltung → KI-Agenten*, neuer Abschnitt „Live in Meetings"):**
- Schalter „Live-KI in Meetings erlauben" (Standard aus).
- Transkriptionsanbieter: neue Provider-Arten in `llm_providers` (`mistral`, `deepgram`) – Mistral ist für Chat
  zugleich OpenAI-kompatibel und damit auch als LLM nutzbar. Schlüssel verschlüsselt wie bisher; **kein Erben**
  zwischen Communities.
- LLM-Anbieter/-Modell für die Vorschläge (Standard: der des System-Agenten).
- Grenzen: Transkriptionsminuten und gewichtete Tokens **pro Monat** für die Community, dazu pro Meeting
  (z. B. 180 Minuten, 3 Agenten). Ist eine Grenze erreicht, verstummen die Agenten mit Hinweis im Panel; der
  Zuhörer beendet den Job.
- Übersicht: Verbrauch des laufenden Monats, teuerste Meetings.

Die Kosten tragen damit die Konten, deren Schlüssel der Community-Admin eingetragen hat (Entscheidung 3).

---

## 8. Call-Oberfläche

### 8.1 Hinweis „wird aufgenommen"

- Das Abzeichen in `meeting-call.tsx` hängt heute an `recordingEnabled`, der Mini-Player an `useIsRecording()`.
  Neu: gemeinsames `isBeingCaptured = Mitschnitt aktiv || liveStatus !== "off"` (bzw. Agenten-Teilnehmer im Raum)
  in **allen drei** Stellen (Call, Mini-Player, Call-Aktionen).
- Text unterscheidet: „Aufzeichnung" / „KI hört mit" / beides.
- **Vor dem Beitreten** (Meeting-Seite, Beitreten-Knopf, Einladungsseite): Hinweis, dass das Meeting transkribiert
  und von KI-Agenten ausgewertet wird, mit Namen der aktiven Agenten.

### 8.2 Panel „KI-Agenten"

- Seitenleiste neben dem LiveKit-Chat, ein- und ausklappbar; auf dem Handy als Tab.
- Nachrichten aller Agenten chronologisch, mit Agentenname und Zeit, Markdown gerendert; neue Nachricht = kleiner
  Hinweis, wenn das Panel zu ist.
- Empfang über `useDataChannel("aiup.agent")`, Verlauf beim Öffnen vom Server.

### 8.3 Live-Untertitel (Beifang, optional)

Da der Zuhörer ohnehin `lk.transcription` sendet, sind Untertitel über `useTranscriptions()` fast kostenlos.
Standardmäßig aus, pro Person einschaltbar. Kann auch in eine spätere Phase.

---

## 9. Gespeichertes Live-Transkript

- Segmente bleiben in `meeting_transcript_segments` (Entscheidung 5). Lesbar für alle, die das Meeting sehen
  dürfen; gelöscht mit dem Meeting bzw. der Community.
- Vorerst keine Anzeige und kein Zusammenführen mit `meetings.transcriptMarkdown`. Naheliegende spätere Nutzung:
  Transkript nach dem Meeting ohne Mitschnitt und ohne 25-MB-Grenze, Sprecher sind bekannt.
- Workflow-Trigger `meeting.live_transcript.finished` (beim `room_finished`) als kleine Ergänzung, damit sich
  Zusammenfassungen daran hängen lassen.

---

## 10. Datenschutz

- Ton aller Teilnehmenden geht laufend an einen externen Transkriptionsdienst → Auftragsverarbeitung mit dem
  Anbieter (AVV), Anbieter mit EU-Hosting (Abschnitt 5), Datenschutzerklärung ergänzen (v1 ist noch deaktiviert).
- Hinweis vor und während des Calls (Abschnitt 8.1). Ob ein Hinweis genügt oder eine aktive Bestätigung nötig ist,
  vor dem Livegang rechtlich klären.
- Das gespeicherte Transkript ist personenbezogen: Aufbewahrungsfrist gemeinsam mit der für Aufzeichnungen festlegen
  (PLAN.md Phase 7).

---

## 11. Phasen

| Phase | Inhalt | Ergebnis |
|---|---|---|
| **0 – Spike** (1–2 Tage) | Zuhörer als Debian-Container gegen lokales LiveKit und `meet.ai-up.club`: Dispatch, `AudioStream` je Spur, Silero-VAD, Mistral vs. Deepgram EU mit deutscher Testaufnahme, `lk.transcription` + `useTranscriptions`, `sendData` vom Server, Agenten-Kachel in `VideoConference`, CPU/RAM pro Spur | Go/No-Go, Anbieterwahl, Framework-Hülle ja/nein |
| **A – Grundlagen** | Tabellen + Migration, Provider-Arten `mistral`/`deepgram`, Community-Einstellungen + Grenzen, Betreiber-Schalter, interne Routen mit HMAC | einrichtbar, noch ohne Zuhörer |
| **B – Zuhörer** | `listener/` + Image + Coolify-Ressource, Dispatch bei `room_started`/Agent an, Segmente speichern, `liveStatus`, Hinweis „wird aufgenommen" überall | Live-Transkript wird gespeichert |
| **C – Agenten** | `meeting_agents`-Verwaltung auf der Meeting-Seite, `meeting-agent-tick` im Worker, `sendData`, Panel im Call, Verlauf beim Beitreten | Vorschläge für alle sichtbar |
| **D – Kosten & Abrundung** | Verbrauchsübersicht, harte Grenzen, MCP-Tools (`list_meeting_agents`/`set_meeting_agent`, `get_live_transcript`, Scope `meetings:write`), Doku-Resource, Workflow-Trigger, Live-Untertitel optional | betriebsfertig |
| **E – Last** | Lasttest mit 30 Teilnehmenden und 3 Agenten (PLAN.md 4f um Zuhörer erweitern) | Kapazitätsgrenze bekannt |

Nach jeder Phase: `npm run typecheck && npm run lint && npm run build && npm run worker:build` (+ Listener-Build).

---

## 12. Offene Entscheidungen

1. **Transkriptionsanbieter:** Mistral (Vorschlag) oder Deepgram EU – nach dem Spike.
2. **Takt und Ton der Agenten:** Standard 2 Minuten und „nur melden, wenn es etwas Neues gibt" – passt das?
3. **Direkt ansprechen:** Sollen Teilnehmende einem Agenten im Call eine Frage stellen können (z. B. Eingabefeld
   im Panel)? Nicht im Plan, wäre eine Erweiterung von Phase C.
4. **Live-Untertitel:** in Phase D mitnehmen oder weglassen?
5. **Hinweis oder Einwilligung** beim Beitreten (Abschnitt 10).
6. **Wer sieht das gespeicherte Transkript** nach dem Meeting: alle Mitglieder, die das Meeting sehen, oder nur
   Teilnehmende?

## 13. Risiken

- `@livekit/rtc-node` ist erst seit 10.09.2026 in Version 1.0; das Multi-Personen-Muster gibt es offiziell nur in
  Python (livekit/agents#3657). → Spike vor jeder weiteren Arbeit.
- Kosten ohne funktionierende Sprachpausen-Erkennung steigen mit der Zahl der Teilnehmenden (Faktor bis 30).
  → VAD ist Pflicht, Grenzen pro Meeting greifen hart.
- Media-VPS teilt sich CPU zwischen SFU, Egress und Zuhörer. → Lasttest (Phase E), notfalls eigener VPS für den
  Zuhörer – ohne Codeänderung, da er nur über HTTP mit der App spricht.
- Deutsche Erkennung von Namen und Fachbegriffen. → Wortliste aus Meeting-Daten an den Anbieter (4.4).

---

## 14. Spike-Ergebnisse (27.09.2026)

Code in `listener/` (eigenes Paket, eigenes `tsconfig`, vom App-Typecheck und -Lint ausgenommen), gemeinsames
Protokoll mit HMAC-Signatur in `src/lib/live-listener.ts` (+ Tests). Lokal gegen `livekit-server:v1.13.5`:

- **Dispatch und Job-Verwaltung funktionieren.** Der Zuhörer registriert sich als `aiup-listener`, `createDispatch`
  startet einen Job, der Job endet von selbst, sobald der Raum leer ist (~20 s nach dem letzten Teilnehmer).
- **Alle Personen, getrennte Spuren.** Zwei Test-Sprecher (macOS-Stimmen, deutsch) wurden je eigener Spur erkannt,
  Segmente korrekt zugeordnet. Das Ein-Personen-Problem der `AgentSession` (2.3) tritt so nicht auf.
- **Untertitel:** Die `lk.transcription`-Text-Streams mit `senderIdentity` = sprechende Person kommen bei den
  Teilnehmenden an.
- **Das Mistral-Plugin taugt nicht für die Kostenbremse.** `@livekit/agents-plugin-mistralai` schickt **jede**
  Audio-Frame an Mistral; die VAD nutzt es nur fürs Satzende. Deshalb spricht `listener/src/transcriber.ts`
  direkt mit `@mistralai/mistralai/extra/realtime` und sendet nur, solange Silero Sprache erkennt (+0,8 s Vorlauf).
  Im Trockenlauf gingen ~40 s Audio an den Erkenner bei ~60 s Spurlänge zweier Sprecher.
- **Sprachhinweis und Wortliste** (`language`, `contextBias`) nimmt die Realtime-Schnittstelle des SDK (2.7.0)
  beim Verbinden nicht entgegen – bleiben vorerst ungenutzt.
- **Speicher:** ein Job-Prozess mit geladenem Silero-Modell ≈ 250 MB RSS (lokal, macOS). Auf dem Media-VPS
  (7,6 GB) sind damit mehrere gleichzeitige Meetings möglich; CPU unter Last in Phase E messen.
- **Native Bindings nur für glibc** (`@livekit/rtc-ffi-bindings-linux-x64-gnu`) – eigenes Debian-Image bestätigt.
- Trockenlauf: `LISTENER_DRY_RUN=1` meldet statt Text nur die Länge jeder Sprechpassage.

Offen im Spike: Erkennungsqualität und Latenz von Voxtral Realtime auf Deutsch, Verhalten von `transcription.done`
nach `flushAudio()` (ein `done` je Äußerung oder erst am Ende?), Agenten-Kachel in `VideoConference`,
`sendData` vom Server.

### Phase A, erster Teil (27.09.2026)

- **Einstellungen je Community in eigener Tabelle** `community_live_settings` (Schalter, Anbieter, Modell,
  verschlüsselter Schlüssel, letzte Prüfung) statt neuer Arten in `llm_providers` – ein Transkriptionsdienst ist
  kein Chat-Anbieter, und der Admin trägt den Schlüssel so an einer Stelle ein. Oberfläche: *Verwaltung →
  KI-Agenten → Live-Transkription in Meetings*, „Schlüssel prüfen" fragt die (kostenlose) Modellliste bei Mistral ab.
  Vorerst nur Mistral; ein zweiter Anbieter (z. B. Deepgram) braucht einen Enum-Wert und eine Anbindung im Zuhörer.
- Tabellen `meeting_transcript_segments` und `meeting_live_usage` (Migration 0027).
- Interne Routen `GET /api/internal/live/config` und `POST /api/internal/live/segments`, HMAC über
  `LISTENER_SHARED_SECRET` (App und Zuhörer), ohne Geheimnis antworten sie 503.
- Noch offen aus Phase A: Grenzen je Monat/Meeting. Als Betreiber-Schalter dient vorerst `LISTENER_SHARED_SECRET`:
  ohne das Geheimnis in der App wird kein Zuhörer geschickt und die internen Routen antworten 503.

### Phase B, erster Teil (27.09.2026)

- **Dispatch:** `ensureListener()` (`src/server/meetings/listener.ts`) bei jedem `participant_joined`, sofern
  die Community die Live-Transkription an und einen Schlüssel hat; ein vorhandener Dispatch für den Raum macht den
  Aufruf wirkungslos. Solange es noch keine Meeting-Agenten gibt, werden damit **alle** Audio-/Video-Meetings der
  Community transkribiert.
- **Hinweis:** im Call (`capture-badge.tsx`, rotes Abzeichen „Live-Transkript" bzw. „Aufzeichnung + Live-Transkript",
  auch im Mini-Player) – ausgelöst durch einen Agenten-Teilnehmer im Raum, also genau dann, wenn der Zuhörer da ist.
  Vor dem Beitreten auf Meeting- und Einladungsseite („Wird live transkribiert").
- **Keine leere Kachel:** `video-conference.tsx` baut LiveKits `VideoConference` nach und blendet Agenten aus.
  Ohne eigenen `RoomAudioRenderer` – den hat `CallProvider` schon, das Prefab hätte jede Stimme doppelt abgespielt.
  `AudioConference` (nur noch ältere Audio-Meetings) zeigt den Zuhörer weiterhin als Teilnehmer.
- **Image:** `deploy/listener/Dockerfile` (`node:24-slim`, Build-Kontext = Repo-Wurzel), lokal gebaut (1,06 GB)
  und im Trockenlauf unter Linux getestet: Registrierung, Dispatch, Erkennung, ~630 MB RAM mit einem Job.

### Betrieb: Zuhörer in Coolify einrichten

1. **App-Ressource** (`ai-up-web`): Umgebungsvariable `LISTENER_SHARED_SECRET` setzen (`openssl rand -hex 32`),
   neu deployen.
2. **Neue Ressource auf dem Media-VPS:** *+ New Resource → Docker Compose*, Quelle dieses Repo, Branch `main`,
   *Base Directory* `/`, Compose-Datei `deploy/listener/docker-compose.yml`. Keine Domain.
3. Umgebungsvariablen der neuen Ressource:

   | Variable | Wert |
   |---|---|
   | `LIVEKIT_URL` | `wss://meet.ai-up.club` |
   | `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | dieselben wie in der LiveKit-Ressource |
   | `APP_URL` | `https://ai-up.club` |
   | `LISTENER_SHARED_SECRET` | derselbe Wert wie in Schritt 1 |

4. Deployen. Im Log: `registered worker` mit `agentName: aiup-listener`.
5. In der App: *Verwaltung → KI-Agenten → Live-Transkription in Meetings* einschalten, Mistral-Schlüssel eintragen.
6. Test: Meeting betreten und sprechen. Im Call erscheint „Live-Transkript", die Segmente landen in
   `meeting_transcript_segments`.
