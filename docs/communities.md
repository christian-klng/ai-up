# Unter-Communities (Planung, Stand 16.09.2026)

Planungsdokument für das Feature „Unter-Communities“: Mitglieder dürfen – wenn der Admin es erlaubt –
eigene Communities anlegen, werden dort Admin und haben alle Funktionen einer „normalen“ Community außer
*Integrationen* (Call-Server und Speicher kommen von der Mutter-Community). Nutzer sind in mehreren
Communities Mitglied und wechseln über ein Modal am Community-Namen oben links.

Das Dokument enthält (1) die Antwort auf die Frage „lässt sich das mit dem Datenmodell umsetzen?“,
(2) die kritische Prüfung gegen den Bestand, (3) das Ziel-Datenmodell samt Migration, (4) die
Kontext-Architektur, (5) den Schnitt in Phasen, (6) die Entscheidungen, die vor Phase A fallen müssen,
und (7) die Ergänzung „eigene Domain je Unter-Community“ mit ihrer Infrastruktur-Seite.

---

## 0. Kurzantwort

**Ja, aber die App kennt heute keinen Mandanten.** Es gibt genau eine Community, und das steckt nicht in
einer Tabelle, sondern in der *Abwesenheit* eines Schlüssels: `app_settings` ist ein Singleton
(`id = "default"`), `users.role`/`users.status` gelten global, `integrations`/`llm_providers`/
`workflows`/`knowledge_areas`/`meeting_spaces`/`ai_agents` haben keinen Besitzer, Slugs sind global
eindeutig, der Realtime-Broadcast-Kanal geht an alle, und die Zählung „alle aktiven Nutzer“ (Workflow-
Audiences, Fragen, Mitgliederliste) meint die ganze Datenbank.

Nichts davon ist ein struktureller Widerspruch – die Tabellen sind sauber normalisiert, IDs sind UUIDs
(LiveKit-Raumnamen `m-<meetingId>` bleiben also über Communities hinweg eindeutig), Medien werden nie
überschrieben, Versionen sind append-only. Das Feature ist deshalb **kein Umbau des Datenmodells,
sondern eine Erweiterung um eine Achse**: eine Tabelle `communities`, eine Tabelle `community_members`,
und eine Spalte `community_id` auf rund 20 Tabellen. Der eigentliche Aufwand liegt nicht in der
Migration, sondern darin, dass jede Domänenfunktion die Community **explizit** als Parameter bekommt
und jeder Slug-, Audience- und Broadcast-Zugriff darauf eingeschränkt wird.

Größenordnung (gezählt am 16.09.2026):

| Was | Anzahl |
|---|---|
| DB-Zugriffe (`db.select/insert/update/delete/query`) | 226 in 32 Dateien |
| Aufrufer von `getAppSettings()`/`loadAppSettings()` | 33 |
| Dateien mit `requireAdmin()`/`assertAdmin()` | 34 |
| Global eindeutige Slugs, die je Community eindeutig werden müssen | 3 (`knowledge_areas`, `meeting_spaces`, `ai_agents`) |

Das ist ein Umbau von der Größe der Phasen 1+2 aus `PLAN.md`, nicht ein Feature wie „Einladungslink“.
Er lohnt sich nur, wenn er in einem Stück bis zur Mitgliedschafts-Tabelle durchgezogen wird – halbe
Mandantenfähigkeit (nur `community_id`, aber `users.role` bleibt global) erzeugt genau die Sicherheits-
lücken, die man später nicht mehr findet.

---

## 1. Kritische Prüfung gegen die bestehende App

Vierzehn Punkte, an denen die Idee auf den Bestand trifft. Zu jedem eine Empfehlung; die offenen
Entscheidungen sind in Abschnitt 6 gesammelt.

### 1.1 Rolle und Status hängen am Nutzer, nicht an der Mitgliedschaft

Bestand: `users.role` (`member|admin`) und `users.status` (`pending|active|suspended`) sind Spalten der
`users`-Tabelle (`src/server/db/schema.ts:51`). `requireAdmin()` prüft `user.role === "admin"`
(`src/server/auth/session.ts:45`), die Freigabe (`approveUser`) setzt `status`, `approvedAt`, `approvedBy`
und `registrationMessage` direkt am Nutzer.

Mit „Nutzer ist in Community A Admin und in B Mitglied“ ist das nicht darstellbar. Die Rolle **muss** in
eine Mitgliedschaftstabelle wandern, und mit ihr der Freigabe-Zustand: Jemand kann in A freigegeben und
in B noch `pending` sein.

**Empfehlung:** Tabelle `community_members` mit `role`, `status`, `approved_at`, `approved_by`,
`registration_message`, `invited_via_id`, `invite_landed_at`, `last_seen_at`. `users.status` bleibt
als **Kontostatus** (`active` = darf sich einloggen, `suspended` = plattformweit gesperrt, `pending` =
noch nirgends freigegeben); `users.role` wird ersatzlos aus der Autorisierung entfernt (Spalte bleibt
vorerst, markiert `@deprecated` wie `app_settings.bot_name`). Der Magic Link wird weiterhin nur an
Konten mit `users.status = active` geschickt (`src/server/auth/auth.ts:57`).

### 1.2 `app_settings` ist ein Singleton – daraus wird die `communities`-Tabelle

Bestand: Name, Logo, Favicon, Theme, Zweck, Standardsprache, Agenten-Kontingent und die drei
Webseiten-Schalter liegen in **einer** Zeile `app_settings` (`schema.ts:133`), gelesen an 33 Stellen.

**Empfehlung:** `app_settings` wird zu `communities` (umbenannt, nicht neu gebaut – die Migration
benennt die Tabelle um, ergänzt `slug`, `parent_id`, `allow_member_subcommunities`, `created_by`,
`deleted_at` und macht die bestehende Zeile `"default"` zur **Root-Community**). Die Root-Community ist
die heutige Installation; ihre `parent_id` ist `null`. Damit bleibt jede Lese-Stelle inhaltlich
gleich, nur der Aufruf wechselt von `getAppSettings()` zu `getCommunity(communityId)`.

Webseiten (`landing_enabled`/`imprint_enabled`/`privacy_enabled`, `landing_page_versions`): Ohne
eigene Domain hat eine Unter-Community keinen öffentlichen Einstiegspunkt – auf `ai-up.club/` liegt
die Landing der Root. **Mit** eigener Domain (Abschnitt 7) zeigen `/`, `/imprint` und `/privacy` die
Seiten der Community, die zum Host gehört; `landing_page_versions` bekommt deshalb `community_id`.
Der Admin-Menüpunkt „Webseiten“ erscheint in einer Unter-Community erst, wenn sie eine Domain hat;
„Integrationen“ bleibt in Unter-Communities immer ausgeblendet.

### 1.3 Integrationen werden vererbt – und zwar nur von der Root

Bestand: `integrations` ist nach `id` (`"livekit"`) geschlüsselt (`schema.ts:859`), `getLiveKitConfig()`
liest ohne Kontext (`src/server/domain/integrations.ts:62`). Aufzeichnungen laufen Egress → S3 → Import
in `media_files`, Uploads liegen in `UPLOAD_DIR/<purpose>/<jahr>/<monat>/`.

Der Auftrag sagt „selber Call-Server und Speicher-Logik wie die Mutter“. Das ist **die einfachste
Variante**: `integrations` bleibt global, `getLiveKitConfig()` bleibt wie es ist, Unter-Communities
zeigen die Seite nicht. Es gibt keine Vererbungskette, die man auflösen müsste.

**Konsequenz:** Unter-Communities haben **genau eine Ebene** (Root → Sub). Sub-of-Sub wäre mit
`parent_id` darstellbar, bringt aber sofort Fragen (wer darf die Erlaubnis weitergeben, wer löscht
was mit), die v1 nicht braucht. Empfehlung: `parent_id` als Spalte anlegen, aber `createCommunity()`
lehnt eine Mutter ab, die selbst eine Mutter hat. Siehe Entscheidung 6.1.

### 1.4 LLM-Provider: eigener Schlüssel je Community, keine Vererbung

Bestand: `llm_providers` global, `getDefaultProvider()` nimmt die `is_default`-Zeile
(`src/server/llm/providers.ts:41`). Agenten, Vorlagen-Bewertung und Workflow-Aktion `llm` lösen darüber
auf. `llm_model_capabilities` ist bewusst providerübergreifend nach Modell-Id geschlüsselt.

Der Auftrag will, dass der Sub-Admin „LLM verbinden“ kann. Die Frage ist, was passiert, wenn er es
**nicht** tut: Erbt die Unter-Community den Provider der Root? Dann zahlt der Betreiber die Token
fremder Communities, deren Inhalte er nicht kennt – und das Wochenkontingent (`agentWeeklyTokenBudget`)
ist je Community, schützt also nicht.

**Empfehlung:** `llm_providers.community_id` (NOT NULL), **keine Vererbung**. Ohne Provider laufen in
der Unter-Community weder Agent noch `llm`-Aktion noch Bewertung – mit derselben Fehlermeldung, die
heute eine Root ohne Provider bekommt. `llm_model_capabilities` bleibt global (gilt für alle, wird
vom Root-Admin per MCP gepflegt, Sub-Admins sehen die Lese-Ansicht). Siehe Entscheidung 6.2.

### 1.5 System-Bot und System-Agent gibt es einmal – gebraucht werden sie je Community

Bestand: `BOT_USER_ID = "system-bot"` ist **eine** `users`-Zeile, `SYSTEM_AGENT_ID` **eine**
`ai_agents`-Zeile; `ensureBotUser()` spiegelt Name und Avatar des Agenten auf den Bot
(`src/server/domain/bot.ts:23`). Die Entscheidung aus `docs/ki-agenten.md` 1.2 hat den Agenten bereits
vom Bot-Nutzer entkoppelt (`ai_agents.bot_user_id`).

Jede Community hat ihren eigenen Assistenten (Name, Bild, Modell, Prompt mit *ihrem* Zweck). Also
`ai_agents.community_id` und **ein System-Agent je Community** (`is_system = true`, unique auf
`(community_id, is_system)`). Der Bot-Nutzer, der im Messenger spricht, muss dann auch je Community
existieren, weil Name und Avatar differieren.

**Empfehlung:** Je Community eine Bot-`users`-Zeile (`id = "system-bot"` für die Root bleibt, neue
Subs bekommen `"system-bot-<communityId>"`, `is_bot = true`, E-Mail `bot+<id>@system.local`). Alle
Stellen, die heute `BOT_USER_ID` vergleichen, prüfen stattdessen `users.is_bot` oder
`agent.botUserId` – das ist ohnehin die robustere Prüfung. `ensureSystemAgent(communityId)` und
`ensureBotUser(communityId)` bekommen den Parameter; `createCommunity()` ruft beide auf.

### 1.6 Messenger und Kontakte: je Community oder global?

Bestand: `contact_requests`, `conversations`, `messages` verbinden **Nutzer** – keine Community. Die
Ungelesen-Zahl (`unreadMessagesCount`) ist je Nutzer.

Zwei Personen, die in Community A *und* B sind: eine gemeinsame Unterhaltung oder zwei? Beide Modelle
gehen. Da der Auftrag später **Profil und E-Mail je Community** will (Abschnitt 1.14), ist der
Messenger ein Community-Feature: Die Person in B sieht mich mit meinem B-Profil, und die Kontakt-
anfrage gilt in B. Ein globaler Messenger würde das Profil-Ziel unterlaufen.

**Empfehlung:** `conversations.community_id`, `contact_requests.community_id`; unique auf
`(community_id, requester_id, addressee_id)`. Bot-Unterhaltungen gehören automatisch zur Community
ihres Bots. Ungelesen-Badge zählt nur die aktive Community. Siehe Entscheidung 6.3.

### 1.7 Medien: gemeinsamer Speicher, aber getrennter Zugriff

Bestand: `media_files` hat `purpose` und `uploaded_by`, keinen Besitzer. `/api/files/:id` liefert
nicht-öffentliche Dateien an **jeden aktiven Nutzer** (`src/app/api/files/[id]/route.ts:22`) – heute
richtig, weil jeder aktive Nutzer Mitglied der einzigen Community ist.

Mit Unter-Communities wäre jede Datei mit bekannter UUID für jedes Mitglied jeder Community lesbar.
UUIDs sind nicht erratbar, aber Links werden weitergegeben.

**Empfehlung:** `media_files.community_id` (nullable: `null` = plattformweit, z. B. generierte
Avatare des Kontos). `/api/files` prüft für nicht-öffentliche Zwecke die Mitgliedschaft in
`media.community_id`. Speicherpfad und S3-Bucket bleiben gemeinsam (Auftrag). Beim Löschen einer
Community werden ihre Dateien physisch entfernt (1.13).

Öffentliche Zwecke (`logo`, `favicon`, `avatar`, `landing`, `meeting`) bleiben öffentlich; das
Logo einer Unter-Community ist damit ebenfalls öffentlich – nötig für das Wechsel-Modal und Mails.

### 1.8 Workflows, Trigger, Audiences und der Dispatcher

Bestand: `workflows` global; Domain-Events (`src/server/events/bus.ts`) tragen `origin`, aber keine
Community; der Dispatcher matcht jedes Event gegen **alle** aktiven Workflows; Audiences `all`/`admins`
laden alle aktiven Nutzer bzw. alle Admins (`src/server/workflows/engine.ts:47,174`); der Template-
Kontext `app.name`/`app.purpose` kommt aus `app_settings`; Schedule-Jobs werden beim Worker-Start aus
allen aktiven Workflows synchronisiert.

**Empfehlung:**
- `workflows.community_id`; `workflow_runs` erben sie über den Workflow (keine eigene Spalte nötig,
  aber für Listen/Statistik praktisch – Empfehlung: denormalisiert mitführen).
- Jeder `DomainEvent` bekommt `communityId` in den Umschlag (`emitDomainEvent(type, payload,
  { communityId })`). Der Dispatcher lädt nur Workflows dieser Community. Ein Event ohne Community
  ist ein Programmierfehler – TypeScript erzwingt das Feld.
- Audiences lösen über `community_members` auf. `notify_user`-Ziel `admins` = Admins der Community.
- `app.*` im Liquid-Kontext wird aus `communities` gefüllt (Name bleibt `app`, damit bestehende
  Workflows und MCP-Doku weiterlaufen).
- Schedule-Sync ist unverändert (Job-Id `sched-<workflowId>` ist bereits global eindeutig).

### 1.9 Realtime: Broadcast geht heute an alle

Bestand: `publishBroadcast()` schreibt auf `aiup:rt:broadcast`, jede SSE-Verbindung abonniert diesen
Kanal (`src/app/api/events/route.ts:55`). Sechs Aufrufer (Meeting-Status, Workflow-Toasts, …).

Mit zwei Communities sähe Mitglied von A die Live-Punkte und Toasts von B.

**Empfehlung:** `publishBroadcast(communityId, type, payload)` → Kanal `aiup:rt:c:<communityId>`.
Die SSE-Route abonniert `user:<id>` **und** den Kanal der aktiven Community (die steckt im Cookie,
siehe Abschnitt 4). Ein Community-Wechsel lädt die Seite neu, die Verbindung wird ohnehin neu
aufgebaut. `publishToUser` bleibt, weil Nutzer-Events (Nachricht, Benachrichtigung) den Nutzer
erreichen sollen – die Payload trägt zusätzlich `communityId`, damit der Client Badges der aktiven
Community zählt und andere nur als „Hinweis in anderer Community“ zeigt (Phase C).

### 1.10 Slugs und Eindeutigkeit

Bestand: `knowledge_areas.slug`, `meeting_spaces.slug`, `ai_agents.slug` sind global unique;
`content_templates.system_key` ebenfalls (System-Vorlagen).

**Empfehlung:** Unique-Indizes auf `(community_id, slug)`. `content_templates.community_id` nullable:
`null` + `is_system` = geseedete System-Vorlagen (gelten für alle Communities, wie heute ohne
Zuweisung). `knowledge_area_templates` darf nur Vorlagen derselben Community oder System-Vorlagen
verknüpfen – Prüfung in `setCollectionTemplates`. `meeting_invites.token` bleibt global unique (der
Token identifiziert die Community).

### 1.11 API-Schlüssel und MCP handeln je Community

Bestand: `api_keys.user_id` + `scopes`; der MCP-Server läuft „als dieser Nutzer“ (`src/app/api/mcp/
route.ts`). Ein Root-Admin-Schlüssel dürfte heute alles.

**Empfehlung:** `api_keys.community_id` (NOT NULL). Ein Schlüssel wird unter *Verwaltung → API-
Schlüssel* der jeweiligen Community angelegt und handelt nur dort; `authenticateApiKey` liefert
`{ key, user, community, membership, scopes }` und prüft, dass die Mitgliedschaft noch `active` und
`admin` ist. Alle MCP-Tools bekommen die Community aus dem Auth-Objekt – kein neuer Parameter an
den Tools, keine Änderung an den Ressourcen-Texten außer einem Satz „this key acts in community X“.
Ein Root-Admin, der per MCP mehrere Communities pflegen will, legt je Community einen Schlüssel an.

### 1.12 Wer darf eine Unter-Community anlegen – und wie kommt man hinein?

Der Auftrag: Root-Admin schaltet frei, dann dürfen Mitglieder anlegen, der Anleger wird Admin.

Offen ist der **Beitritt anderer**. Heute gibt es zwei Wege in die App: Registrierung mit Freigabe
(`registerUser` → `pending` → Admin) und Meeting-Einladungslink (sofort aktiv). Beide sind
Community-Vorgänge und lassen sich 1:1 übertragen:
- Registrierung landet als `community_members`-Zeile mit `status = pending` in **einer** Community
  (Root über `/register`, Sub über `/c/<slug>/register` – die Sub-Registrierung ist nur erreichbar,
  wenn die Sub das erlaubt; Standard: aus).
- Meeting-Einladungslinks bleiben wie sie sind und aktivieren die Mitgliedschaft in der Community des
  Meetings.
- **Neu und für Subs der Hauptweg:** ein Community-Einladungslink (`community_invites`, gleicher
  Mechanismus wie `meeting_invites`: Token, `enabled`, Zähler). Ein bestehender Nutzer, der ihn
  öffnet, wird sofort Mitglied; ein neuer registriert sich darüber. Damit braucht die Sub-Community
  kein eigenes Verzeichnis und keine Suche. *Umgesetzt in Phase B*: `/join/<token>`,
  `src/server/domain/community-invites.ts`, Schalter unter *Verwaltung → Mitglieder*. Der Beitritt
  ist idempotent, und eine **gesperrte** Mitgliedschaft lebt darüber nicht wieder auf – sonst käme
  jeder Hinausgeworfene über eine aufgehobene URL zurück.
- Ein bereits angemeldeter Nutzer, der eine Sub anlegt, ist automatisch Admin **dieser** Sub und
  bleibt in der Root, was er war.

Ein „Verzeichnis aller Unter-Communities zum Beitreten“ ist bewusst **nicht** in v1
(Entscheidung 6.4).

### 1.13 Löschen einer Community

Der Sub-Admin darf löschen. `ON DELETE CASCADE` von `communities` reißt Sammlungen, Einträge,
Meetings, Workflows, Läufe, Agenten, Threads, Nachrichten, Mitgliedschaften und API-Schlüssel mit –
das ist erwünscht. Nicht per Cascade erledigt: physische Dateien in `UPLOAD_DIR`, Aufzeichnungen
(bereits importiert, also ebenfalls Dateien), Schedule-Jobs in BullMQ, laufende LiveKit-Räume.

**Empfehlung:** Soft-Delete (`communities.deleted_at`) mit sofortiger Sperre (kein Zugriff, Wechsel-
Modal zeigt sie nicht), endgültige Löschung durch einen Worker-Job `{kind:"purge-community"}` nach
einer Frist (Vorschlag 14 Tage; in dieser Zeit kann der Root-Admin wiederherstellen). Der Job beendet
Räume, entfernt Schedule-Jobs, löscht Dateien und dann die Zeile. Die Root-Community ist nicht
löschbar (Guard in der Domäne, nicht nur in der UI).

Wer die Sub löschen darf: ihre Admins **und** die Admins der Root (Betreiber-Pflicht, z. B. bei
Missbrauch). Die Root-Admins sehen dafür eine Liste aller Unter-Communities unter *Verwaltung →
Communities* (Name, Anleger, Mitgliederzahl, Speicherverbrauch, Löschen/Wiederherstellen).

### 1.14 Später: Profil und E-Mail je Community

Der Auftrag stellt das zurück; das Datenmodell muss es aber jetzt zulassen. Mit `community_members`
ist das eine Sache von nullbaren Override-Spalten (`display_name`, `bio`, `avatar_media_id`), die die
`PublicUser`-Auflösung (`getPublicUser`, `listActiveMembers`) mit dem Konto zusammenführt.

**Eine Warnung zur E-Mail:** Der Magic Link identifiziert das Konto über `users.email` (unique, Better
Auth). Eine „E-Mail je Community“ kann deshalb nur eine **Kontakt-/Anzeigeadresse** sein, keine
zweite Login-Identität – sonst gäbe es zwei Konten. Wenn Christian wirklich getrennte Logins will,
ist das ein anderes Feature (Konto-Verknüpfung), nicht ein Feld an der Mitgliedschaft. Siehe
Entscheidung 6.6.

### Subdomains: was die Umsetzung anders macht, und was lokal nicht prüfbar ist

**Keine Tabelle `community_domains` für Stufe A.** Der Plan sah sie für beide Stufen vor; für
Subdomains ist sie überflüssig, weil die Subdomain der Slug *ist* – und der ist bereits eindeutig,
als DNS-Label validiert und unveränderlich. Eine zweite Stelle mit derselben Information wäre nur
etwas, das auseinanderlaufen kann. Die Tabelle kommt mit Stufe B, wo Hosts beliebig sind und
verifiziert werden müssen.

**Der Feature-Schalter `COMMUNITY_SUBDOMAINS` ist Absicht.** Ohne Wildcard-DNS und Wildcard-Zertifikat
(Abschnitt 7.5) lösen die Adressen nicht auf; die App dürfte dann keine Links darauf erzeugen. Ist
er aus, bleibt alles beim `/c/<slug>`-Präfix aus Phase C.

**Lokal nicht prüfbar: die geteilte Session.** Browser lehnen ein Cookie mit `Domain=.localhost` ab,
weil `localhost` ein Public Suffix ist. Host-Auflösung, Branding, öffentliche Seiten und der
Magic-Link-Versand funktionieren auf `lesekreis.localhost:3000`, die Anmeldung wird dort aber nicht
erkannt. Auf einer echten Domain (`.ai-up.club`) greift die Regel nicht. Die App **warnt beim ersten
Aufruf im Log**, wenn der Schalter auf einem einteiligen Host aktiv ist. Wer es lokal vollständig
sehen will, braucht einen Eintrag in `/etc/hosts` (`127.0.0.1 aiup.test lesekreis.aiup.test`) und
`APP_URL=http://aiup.test:3000` – das ist eine Systemänderung und deshalb Christians Aufgabe.

**Zwei Fehler, die dabei aufgefallen sind:**

1. **Der Magic-Link-Versand war seit Phase A kaputt.** Beim mechanischen Umbenennen von
   `getAppSettings()` war in `auth.ts` der *Seiten*-Guard `requireCommunity()` gelandet, der ohne
   Session einen Redirect wirft – mitten im Mailversand, der daran mit HTTP 500 scheiterte. Aufgefallen
   erst beim Anmeldetest dieser Phase. Jetzt nutzt er `getPublicCommunity()`, und die Mail trägt den
   Namen der Community, deren Host die Anmeldeseite ausgeliefert hat.
2. **Das Wildcard-Muster in `trustedOrigins` braucht den Port.** `http://*.localhost` passt nicht auf
   `http://lesekreis.localhost:3000`; Better Auth antwortete mit „Invalid origin". Das Muster wird
   jetzt aus `new URL(APP_URL).host` gebaut, der den Port mitbringt.

Damit `auth.ts` die Host-Auflösung nutzen kann, ohne einen Importzyklus zu schließen
(`session` → `auth` → `session`), liegt sie in `src/server/community-context.ts`.

### Was nicht getestet ist (Stand 17.09.2026)

Die Testsuite des Projekts läuft ohne Datenbank, deshalb sind aus Phase E nur die Entscheidungen
abgedeckt, die sich als reine Funktion formulieren lassen: die Wahl der aktiven Community
(`pickActiveCommunity`), der Medien-Zugriff (`mediaAccess`), Slug-Regeln und der `/c/<slug>`-Präfix.

**Ohne Integrationstests bleiben** der Dispatcher-Filter, `isLastAdmin`, die Sichtbarkeit von
Vorlagen und die Migration selbst – alles SQL-nah. Sie wurden von Hand gegen die
Entwicklungsdatenbank geprüft (siehe die Abnahmen in der Phasentabelle), aber nichts hält eine
Regression davon ab. Eine Testbasis mit echter Datenbank gehört in `PLAN.md` Phase 7 (Härtung) und
wäre der nächste sinnvolle Schritt, bevor weitere Communities produktiv entstehen.

### Abweichungen, die sich in der Umsetzung ergeben haben (16.09.2026)

Aus Phase B, vorgezogen aus Phase D, weil es ein Rechteproblem war und kein Schönheitsfehler:
**Zwei Verwaltungsbereiche gehören dem Betreiber, nicht einer Community.** *Integrationen* (die
LiveKit-Zugangsdaten und der Aufzeichnungs-Speicher, die sich alle teilen) und *Webseiten* (die
öffentlichen Seiten der Hauptdomain) sind über `requireRootAdmin()`/`assertRootAdmin()` abgesichert
und aus dem Menü einer Unter-Community entfernt. Ohne das hätte jeder Sub-Admin die Zugangsdaten des
Betreibers lesen und ändern können. Dieselbe Regel gilt per MCP für die plattformweite Tabelle der
Modell-Fähigkeiten: lesen darf jede Community, schreiben nur die Root.

Aus Phase D, zwei Dinge, die der Fremdschlüssel bzw. das Cascade nicht von selbst erledigen:

1. **Bot-Nutzer vor System-Agent.** `ai_agents.bot_user_id` zeigt auf `users`, also muss der
   Bot-Nutzer zuerst existieren. `ensureBotUser(communityId)` legt ihn an und ruft danach
   `ensureSystemAgent()` – die umgekehrte Reihenfolge scheitert am Fremdschlüssel. Genau so macht es
   auch der Seed seit jeher; beim Anlegen einer Community war es beim ersten Versuch falsch herum.
2. **Der Purge muss drei Dinge von Hand aufräumen**, die kein Cascade erreicht: die hochgeladenen
   Dateien auf der Platte (vorher einsammeln, nachher löschen), die wiederkehrenden BullMQ-Jobs der
   Workflows (`syncSchedules()`) und den Bot-Nutzer der Community, der als `users`-Zeile nur über
   seine Mitgliedschaft an ihr hing. Kontobezogene Avatare (`community_id` null) bleiben bewusst.

Der Sweep selbst ist ein Job-Scheduler mit dem Präfix `sys-`, damit `syncSchedules()` ihn nicht für
einen verwaisten Workflow hält und entfernt.

Aus Phase C: **Persönliche Events müssen im Client gefiltert werden.** Der Broadcast-Kanal ist seit
Phase A je Community, aber `publishToUser` erreicht das Konto überall – eine Nachricht oder
Benachrichtigung aus Community B hätte sonst den Zähler von A bewegt, während man in A sitzt. Die
Events tragen deshalb `communityId`, und der `RealtimeProvider` verwirft, was nicht zur aktiven
Community gehört. Die Zahl im Event ist ohnehin die der *anderen* Community und wäre schlicht falsch.

Ebenfalls aus Phase B: **Der Meeting-Einladungslink ist ein Beitrittslink in die Community.** Das war
er immer (Registrierung darüber machte sofort aktiv), fiel aber erst mit mehreren Communities auf:
Wer eingeloggt war und den Link einer fremden Community öffnete, landete auf einer Meeting-Seite, die
er nicht sehen durfte. Jetzt bekommt er dasselbe Angebot wie ein neuer Gast, und ein Mitglied wird
über `/invite/<token>/open` samt richtig gesetzter aktiver Community weitergeleitet.

Drei Punkte sind bei der Umsetzung von Phase A bewusst anders gelöst worden als oben geplant:

1. **`requireAdmin()` bleibt bestehen** statt entfernt zu werden. Der Plan wollte es löschen, damit der
   Compiler jede der 34 Prüfstellen anzeigt. Stattdessen trägt `CurrentUser` jetzt ein `role`, das die
   Rolle **in der aktiven Community** ist und das Konto-Feld überschattet. Damit sind alle bestehenden
   `user.role === "admin"`-Prüfungen ohne Änderung inhaltlich richtig, und der Compiler-Druck entsteht
   dort, wo er wirklich zählt: an den Domänenfunktionen, die `communityId` verlangen.
2. **Kriterien geseedeter System-Vorlagen darf nur die Root ändern.** Die Vorlagen sind geteilt
   (`community_id` null); dürfte jede Community ihre Kriterien ändern, würde sie damit die Einträge
   aller anderen neu bewerten lassen. `setTemplateEvaluation` lehnt das ab (`domain/templates.ts`).
   Eine Unter-Community mit eigenen Kriterien braucht eine eigene Vorlage.
3. **Das Branding folgt der aktiven Community**, nicht der Root: `getBrandingCommunity()` im
   Root-Layout setzt Name, Favicon und Theme nach der Community, in der man gerade ist. Ohne das
   trüge eine Unter-Community die Farben des Betreibers.

Beim Migrieren war außerdem zu beachten, dass `drizzle-kit generate` bei einem Tabellen-Rename
interaktiv nachfragt und in einer nicht-interaktiven Sitzung hängen bleibt. Die Migration wurde
deshalb über die programmatische API (`drizzle-kit/api`) gegen einen vorab umbenannten Snapshot
erzeugt und danach von Hand in eine auf Bestandsdaten anwendbare Reihenfolge gebracht: erst RENAME,
dann Spalten nullable anlegen, befüllen, auf NOT NULL setzen, dann die Mitgliedschaften aus `users`
übernehmen, zuletzt die alten Spalten entfernen.

### Was bewusst **nicht** verwendet wird: Better Auth `organization`-Plugin

Better Auth 1.7 bringt ein Organisations-Plugin mit (`organization`, `member`, `invitation`,
`session.activeOrganizationId`, Optionen `allowUserToCreateOrganization`, `creatorRole`). Es wurde
geprüft und **verworfen**: Es bringt ein eigenes Einladungsmodell per E-Mail, eigene Rollen-Strings
und einen zweiten Ort für „aktive Organisation“ (Session statt Cookie) mit. Unsere Mitgliedschaft
hat Freigabe-Workflow, Registrierungsnachricht, Meeting-Einladungslinks und bald Profil-Overrides –
das Plugin würde daneben liegen, nicht darunter. Eigene Tabellen sind hier weniger Code, nicht mehr.

---

## 2. Ziel-Datenmodell

### 2.1 Neue Tabellen

```
communities                      (aus app_settings umbenannt)
  id                text PK      ("default" = Root, sonst uuid)
  slug              text unique  (Root: "default" – wird nie in URLs gezeigt)
  parent_id         text → communities.id, null = Root
  name, tagline, purpose, logo_media_id, favicon_media_id, theme, default_locale
  agent_weekly_token_budget, agent_output_token_weight
  landing_enabled, imprint_enabled, privacy_enabled     (nur Root ausgewertet)
  allow_member_subcommunities  boolean default false     (nur Root ausgewertet)
  allow_registration           boolean default true      (Sub: Standard false)
  created_by        text → users.id
  deleted_at        timestamptz
  created_at, updated_at

community_members
  community_id      text → communities.id cascade
  user_id           text → users.id cascade
  role              member | admin
  status            pending | active | suspended
  approved_at, approved_by, registration_message
  invited_via_id    uuid → meeting_invites.id set null   (wandert von users)
  invite_landed_at  timestamptz                          (wandert von users)
  last_seen_at      timestamptz
  joined_at
  PK (community_id, user_id); index (user_id)

community_invites                (Beitrittslink, analog meeting_invites)
  id, community_id, token unique, enabled, use_count, created_by, created_at
```

### 2.2 Spalte `community_id` auf bestehenden Tabellen

| Tabelle | NOT NULL | Anmerkung |
|---|---|---|
| `knowledge_areas` | ja | unique `(community_id, slug)` |
| `content_templates` | **nein** | `null` = System-Vorlage |
| `meeting_spaces` | ja | unique `(community_id, slug)` |
| `workflows` | ja | |
| `workflow_runs` | ja | denormalisiert für Listen |
| `llm_providers` | ja | `is_default` je Community |
| `ai_agents` | ja | unique `(community_id, slug)`, ein `is_system` je Community |
| `conversations`, `contact_requests` | ja | 1.6 |
| `notifications` | **nein** | `null` = kontoweit (z. B. „Konto gesperrt“) |
| `questions` | ja | |
| `media_files` | **nein** | `null` = kontoweit (Avatar) |
| `api_keys` | ja | 1.11 |
| `audit_log` | **nein** | plattformweite Aktionen ohne Community |
| `landing_page_versions` | ja | Seiten je Community, ausgewählt nach Host (Abschnitt 7) |
| `community_domains` | ja | neu, Abschnitt 7.2 |
| `integrations`, `llm_model_capabilities` | – | global, keine Spalte |
| `users`, `sessions`, `accounts`, `verifications` | – | Konto, keine Spalte |

Ableitbar über Fremdschlüssel, daher **keine** Spalte: `contents`, `content_versions`,
`content_evaluations`, `knowledge_area_templates`, `meetings`, `meeting_*`, `workflow_versions`,
`workflow_run_steps`, `agent_threads` (über `agent_id`), `agent_messages`, `messages`,
`question_responses`, `question_dismissals`. Für Abfragen, die über zwei Joins gehen müssten
(Suche in Einträgen, Agenten-Verbrauch), kann `contents.community_id` und
`agent_threads.community_id` später denormalisiert werden – Entscheidung im Zuge von Phase A anhand
der tatsächlichen Queries.

### 2.3 Bestehende Spalten, die ihre Bedeutung ändern

- `users.role` → `@deprecated`, wird nicht mehr gelesen. Ersatz: `community_members.role`.
- `users.status` → nur noch Kontostatus. `pending` heißt „noch nirgends freigegeben“; die erste
  Freigabe in irgendeiner Community setzt es auf `active`.
- `users.invited_via_id`, `users.invite_landed_at` → wandern in `community_members`.
- `app_settings.*` → `communities.*`; `getAppSettings()` wird zu `getCommunity(id)`,
  `getRootCommunity()` für Mail-Absender, Login-Seite und Landing.
- `BOT_USER_ID` → nur noch die Id des **Root**-Bots; alle Vergleiche gehen auf `users.is_bot`.

### 2.4 Migration (eine Drizzle-Migration, in Transaktion)

1. `ALTER TABLE app_settings RENAME TO communities`; neue Spalten mit Defaults; Zeile `"default"`
   bekommt `slug = 'default'`, `parent_id = null`.
2. `community_members` anlegen und aus `users` befüllen: jede Nicht-Bot-Zeile → Mitgliedschaft in
   `"default"` mit `role`, `status`, `approved_*`, `registration_message`, `invited_via_id`,
   `invite_landed_at`, `last_seen_at`.
3. `community_id` auf alle Tabellen aus 2.2 **nullable** anlegen, mit `'default'` befüllen, dann
   `SET NOT NULL` wo vorgesehen. `content_templates`: nur `is_system = false` befüllen.
4. Unique-Indizes tauschen (`slug` → `(community_id, slug)`).
5. `users.status` von `pending` unverändert lassen (Konto ohne Freigabe), `role` bleibt stehen.

Rückwärts: Die Migration ist auf einer Installation mit genau einer Community verlustfrei umkehrbar,
solange keine zweite Community existiert. Vor dem Deploy: Backup, wie bei jeder Migration.

---

## 3. Kontext-Architektur: die Community ist ein expliziter Parameter

Das Wichtigste an dieser Umstellung ist **keine** Magie über `AsyncLocalStorage` oder einen globalen
„aktuellen Mandanten“. Der Worker hat keinen Request, der Dispatcher läuft für jede Community, MCP hat
den Kontext im API-Key. Ein impliziter Kontext ist an genau diesen Stellen falsch oder leer, und der
Fehler fällt erst in Produktion auf.

Stattdessen:

```ts
// src/server/auth/session.ts
export async function requireMembership(): Promise<{ user; community; membership }>;  // Pages
export async function requireCommunityAdmin(): Promise<…>;                            // Pages
export async function assertMembership(): Promise<…>;                                 // Server Actions
export async function assertCommunityAdmin(): Promise<…>;                             // Server Actions
```

`requireUser()`/`assertUser()` bleiben für Konto-Seiten (Profil, Sprache, `/pending`).
`requireAdmin()`/`assertAdmin()` werden **entfernt** – nicht umbenannt –, damit der TypeScript-
Compiler jede der 34 Dateien anzeigt, an der die Prüfung auf die Community umziehen muss.

Domänenfunktionen bekommen `communityId` als **ersten** Parameter (`listAreas(communityId)`,
`createWorkflow(communityId, input, actorId)`). Wo eine Funktion eine Entität per Id lädt
(`getMeeting(id)`), prüft sie nach dem Laden, dass die Entität zur übergebenen Community gehört, und
liefert sonst `undefined` – dieselbe Antwort wie „gibt es nicht“, keine Enumeration.

Die aktive Community wird in dieser Reihenfolge bestimmt (`getCurrentCommunity()`, Details in 7.3):

1. **Host.** Gehört der Hostname zu einer Community (`community_domains`), ist sie fix – das ist der
   Weg für Communities mit eigener Domain oder Subdomain.
2. **Cookie `aiup_community`** (Muster wie `aiup_locale`, `src/i18n/config.ts`) auf der Hauptdomain.
   Mitgliedschaft wird geprüft (`status = active`, Community nicht gelöscht), sonst Rückfall auf die
   erste aktive Mitgliedschaft (Root bevorzugt). Kein Cookie und keine Mitgliedschaft → `/pending`.

**Warum Cookie statt URL-Präfix auf der Hauptdomain:** Ein Präfix `/c/<slug>/…` vor jeder Route wäre
die sauberere Lösung (zwei Tabs, zwei Communities; Links sind eindeutig), aber er ändert jede `href` in
Navigation, Redirects, Benachrichtigungen (`data.href` in der DB), Workflow-Ausgaben, MCP-Antworten
und Mail-Templates. Das ist ein zweiter Umbau derselben Größe. Und sobald eine Community eine eigene
Domain hat, ist der Host der Präfix – der Cookie ist nur die Lösung für Communities **ohne** Domain.
Kompromiss für v1:

- Cookie trägt die aktive Community auf der Hauptdomain; alle Routen bleiben wie heute.
- Eine Route `/c/<slug>/<rest>` (Route-Gruppe `(public)`, in `PUBLIC_PREFIXES`) leitet auf die
  Domain der Community um, wenn sie eine hat; sonst prüft sie die Mitgliedschaft, setzt das Cookie
  und leitet auf `/<rest>` weiter. Damit sind **teilbare Links** möglich:
  `/c/lesekreis/knowledge/bücher`. Neue Deep-Links aus Benachrichtigungen und Mails werden über
  `communityBaseUrl()` erzeugt (Domain, sonst Präfix); bestehende bleiben gültig, solange man in der
  richtigen Community ist.
- Ein späterer Umzug auf den echten Präfix ist möglich, ohne Daten anzufassen: Die `/c/`-Route
  wird dann zur echten Route statt zum Redirect.

Siehe Entscheidung 6.5.

---

## 4. Oberfläche

- **Wechsel-Modal** am Community-Namen oben links (`AppShell` `brand`): Liste der aktiven
  Mitgliedschaften mit Logo, Name, Rolle, Ungelesen-Hinweis; Klick setzt Cookie (Server Action
  `switchCommunity`) und lädt `/home`. Darunter, wenn erlaubt: „Neue Community anlegen“. Root-
  Admins sehen zusätzlich den Link *Verwaltung → Communities*. Bei nur einer Mitgliedschaft und
  ohne Anlege-Recht bleibt der Name ein statischer Schriftzug wie heute.
- **Anlegen** (Dialog aus dem Modal, Route `/communities/new`): Name (Pflicht), Zweck (Pflicht –
  wie bei Sammlungen, fließt in den System-Prompt), Slug (aus Name, editierbar), Sprache. Nach dem
  Anlegen: Cookie auf die neue Community, Redirect nach `/admin/general` mit Hinweis „LLM verbinden,
  Mitglieder einladen“.
- **Verwaltung** der Unter-Community = die heutige Verwaltung ohne *Integrationen* und *Webseiten*;
  zusätzlich *Allgemein → Community löschen* (Bestätigung mit Namen tippen) und *Mitglieder →
  Beitrittslink*.
- **Root-Verwaltung** bekommt *Allgemein → „Mitglieder dürfen Unter-Communities anlegen“* und den
  Menüpunkt *Communities* (Liste, Wiederherstellen, Löschen).
- **Registrierung** `/register` bleibt Root; `/c/<slug>/register` nur, wenn die Sub
  `allow_registration` hat. `/pending` zeigt, in welcher Community man wartet.
- Alle Texte in `messages/de.json` **und** `messages/en.json`.

---

## 5. Phasen

| Phase | Inhalt | Abnahme |
|---|---|---|
| **A – Datenmodell & Kontext** ✅ 16.09.2026 | Migration `0024_communities`; `communities`/`community_members`/`community_invites`; `getActiveCommunity()`, `getAccount()`, `assertMemberOf()`; `communityId` durch alle Domänenfunktionen, Server Actions, Pages, MCP-Tools, Worker; Slug-Indizes je Community; Domain-Event-Umschlag; Broadcast-Kanal je Community; `/api/files`-Prüfung; `users.role` aus der Autorisierung entfernt. **Verhalten für die Root unverändert.** | Erledigt: Typecheck/Lint/Build/Worker/Tests grün; Migration auf Bestandsdaten geprüft; Root-Abläufe unverändert; eine per SQL angelegte zweite Community bleibt in Sammlungen, Meetings, Sidebar und MCP unsichtbar. |
| **B – Mitgliedschaft in der Oberfläche** ✅ 16.09.2026 | *Verwaltung → Mitglieder* arbeitet auf `community_members`; Freigabe/Sperre/Rolle je Community; Mitglied aus einer Community entfernen (Konto bleibt) mit Schutz des letzten Admins; Community-Beitrittslink (`/join/<token>`) samt Registrierung und Ein-Klick-Beitritt; Meeting-Einladung lässt Fremde derselben Logik folgen; Mitgliederliste/Profile zeigen nur Mitglieder der aktiven Community; *Integrationen* und *Webseiten* sind auf den Betreiber beschränkt. | Erledigt: Ein Konto ist in der Root Mitglied und in einer zweiten Community Admin; beide Verwaltungen zeigen die richtigen Mitglieder, Rollen und Zahlen. Beitritt über Link getestet (neu, bestehend, doppelt), Entfernen lässt Konto und andere Mitgliedschaft unberührt, letzter Admin ist geschützt. |
| **C – Wechsel** ✅ 16.09.2026 | `switchCommunityAction` + Wechsel-Modal am Community-Namen (ab zwei Mitgliedschaften), `/c/<slug>/…`-Redirect für teilbare Links, SSE-Abo je Community (schon Phase A), Badges je Community, Client filtert persönliche Events fremder Communities heraus, Mail-Links mit Präfix. | Erledigt: Beide Communities im Modal mit Rolle und Logo, Wechsel tauscht Marke, Navigation, Sammlungen und Zähler ohne Fehlseite. `/c/<slug>/…` funktioniert in beide Richtungen, ein unbekannter Slug landet auf `/home`. Eine Benachrichtigung der anderen Community bewegt weder Zähler noch Toast, die der eigenen beides. |
| **D – Anlegen & Löschen** ✅ 17.09.2026 | Root-Schalter *Unter-Communities erlauben*, Anlege-Formular `/communities/new` (Kurzname wird aus dem Namen abgeleitet), `createCommunityWithSetup()` (Admin-Mitgliedschaft, Bot + System-Agent, Start-Sammlung und Meeting-Bereich), Löschen der eigenen Community unter *Allgemein* mit Namenseingabe, Soft-Delete mit 14 Tagen Frist, täglicher Purge-Sweep im Worker, Root-Verwaltung *Communities* mit Wiederherstellen. | Erledigt: Community über die Oberfläche angelegt, vollständig eingerichtet (Sammlung, Meeting-Bereich, eigener Assistent mit Bot), eigenes Theme; Löschen mit Namensbestätigung führt zurück in die Root, die Betreiber-Liste zeigt Löschdatum und Endfrist; der Purge entfernt Zeilen, Bot-Konto **und** die Dateien von der Platte, das Gründer-Konto bleibt. |
| **E – MCP, Doku, Tests** ✅ 17.09.2026 | `api_keys.community_id` + Auth-Objekt mit Community (beides schon Phase A), MCP-Instruktionen und Ressourcen nennen die Community und was dem Betreiber gehört, `docs/entwicklung.md`/`CLAUDE.md`/`PLAN.md`/`README.md`, Auswahl der aktiven Community und der Medien-Zugriff als reine, getestete Funktionen (81 Tests). | Erledigt: Ein Schlüssel der Unter-Community sieht per `list_collections` nur ihre Sammlung, die Instruktionen nennen ihre Community, und `set_model_capabilities` wird von dort abgelehnt, während Lesen funktioniert und der Root-Schlüssel schreiben darf. |
| **F – später** | Profil-Overrides je Mitgliedschaft; Kontakt-E-Mail je Community (keine Login-Identität); ggf. echter URL-Präfix; Sub-Verzeichnis. | – |

Phase A ist die größte und lässt sich nicht sinnvoll teilen: Sobald `community_id` existiert, muss jede
Abfrage filtern, sonst ist die Root bis zur zweiten Community zwar korrekt, aber der Zustand
„halb mandantenfähig“ wäre unsichtbar falsch. A wird deshalb auf einem Branch entwickelt und erst
gemergt, wenn die Abnahme steht.

---

## 6. Zu treffende Entscheidungen

| # | Frage | Empfehlung |
|---|---|---|
| 6.1 | Nur eine Ebene (Root → Sub) oder beliebige Tiefe? | Eine Ebene; `parent_id` bleibt generisch. |
| 6.2 | Erbt eine Sub ohne eigenen LLM-Provider den der Root? | Nein – Kosten und Datenhoheit. |
| 6.3 | Messenger/Kontakte je Community oder global? | Je Community (wegen Profil je Community). |
| 6.4 | Gibt es ein Verzeichnis der Unter-Communities zum Beitreten? | Nicht in v1; Beitritt nur per Link oder Registrierung, wenn die Sub sie erlaubt. |
| 6.5 | Cookie + `/c/<slug>`-Redirect (v1) oder sofort URL-Präfix? | Cookie in v1; Communities mit Domain werden über den Host erkannt (Abschnitt 7). |
| 6.6 | „E-Mail je Community“: Kontaktadresse oder eigene Login-Identität? | Kontaktadresse; Login bleibt am Konto. |
| 6.7 | Löschfrist vor dem endgültigen Purge? | 14 Tage, Root-Admin kann wiederherstellen. |
| 6.8 | Dürfen Sub-Admins Meeting-Einladungslinks einschalten (öffentliche URL unter der Root-Domain)? | Ja – es ist ihre Community; das OpenGraph-Bild zeigt ihr Titelbild. |
| 6.9 | Bekommt eine neue Sub eine Start-Sammlung und einen Start-Meeting-Bereich? | Ja, je eine (wie eine frische Installation), damit die Seite nicht leer ist. |

---

## 7. Eigene Domain je Unter-Community (Ergänzung 16.09.2026)

Nachtrag zum Auftrag: Der Admin einer Unter-Community soll eine Domain oder Subdomain festlegen können,
unter der **die App und – falls aktiviert – die Webseite** seiner Community erscheinen. Magic Links und
Links in Benachrichtigungen dürfen auf der Hauptdomain bleiben.

### 7.0 Kurzantwort

**Realisierbar – in zwei klar verschieden teuren Stufen.**

| Stufe | Beispiel | Selbstbedienung durch Sub-Admin | Infrastruktur | Login |
|---|---|---|---|---|
| **A – Subdomain** | `lesekreis.ai-up.club` | ja, sofort wirksam | einmalig: Wildcard-DNS + Wildcard-Zertifikat per DNS-Challenge (IONOS) | Session-Cookie auf `.ai-up.club`, kein Umweg |
| **B – Eigene Domain** | `community.verein-xy.de` | ja, nach DNS-Nachweis | je Domain ein Zertifikat; Proxy muss unbekannte Hosts lernen | Übergabe der Session von der Hauptdomain (Handoff) |

Stufe A ist Konfigurationsarbeit in Coolify (von Christian, einmalig) plus überschaubarer App-Code.
Stufe B ist ein eigenes Teilprojekt mit einer Infrastruktur-Entscheidung (Traefik mit dynamischen
Dateien oder Wechsel auf Caddy), die vorher in einem Spike geprüft werden muss. Empfehlung: **A in v1,
B als eigene Phase danach.**

Geprüft am 16.09.2026 an Better Auth 1.7 (installiert) und den Coolify-Docs:
- `trustedOrigins` akzeptiert eine **Funktion** `(request) => string[]` – Domains aus der DB sind
  möglich (`@better-auth/core/dist/types/init-options.d.mts`).
- `baseURL` kann dynamisch sein (`{ allowedHosts: ["ai-up.club", "*.ai-up.club"], fallback }`), mit
  Wildcard-Mustern – aber `allowedHosts` ist ein **statisches Array**, keine Funktion. Beliebige
  Kundendomains lassen sich damit nicht abdecken; deshalb der Handoff in Stufe B.
- `advanced.crossSubDomainCookies` teilt den Session-Cookie über alle Subdomains.
- Coolify dokumentiert Wildcard-Zertifikate über Traefik-DNS-Challenge; lego (Traefiks ACME-Client)
  hat einen **IONOS-Provider** (`IONOS_API_KEY`).
- Traefik kennt **kein** On-Demand-TLS für unbekannte Hosts; Caddy schon (`on_demand_tls` mit
  `ask`-Endpunkt), und Coolify kann Caddy als Proxy betreiben.

### 7.1 Was sich am bisherigen Plan ändert

1. **Abschnitt 1.2 („Webseiten nur für die Root")** wird zurückgenommen: `landing_page_versions`
   bekommt `community_id`, und die drei Enabled-Schalter in `communities` gelten je Community. Die
   Seiten `/`, `/imprint`, `/privacy` entscheiden nach **Host**, welche Community sie zeigen. Der
   Menüpunkt *Webseiten* erscheint in einer Unter-Community, sobald sie eine Domain hat. Wichtig aus
   rechtlicher Sicht: Wer unter eigener Domain auftritt, braucht ein eigenes Impressum – das ist ein
   Argument **für** diese Änderung, nicht dagegen.
2. **Entscheidung 6.5 (Cookie-Wechsel)** wird zu: Die aktive Community ergibt sich **zuerst aus dem
   Host**, erst auf der Hauptdomain aus dem Cookie. Auf `lesekreis.ai-up.club` ist die Community
   fix; das Wechsel-Modal verlinkt dort auf die Domains der anderen Mitgliedschaften bzw. auf die
   Hauptdomain mit Cookie. `/c/<slug>/…` leitet auf die Domain der Community um, wenn sie eine hat.
3. **Absolute URLs** (`env.APP_URL`, 12 Stellen: Einladungslink, OpenGraph, MCP-Antworten, Mails,
   Liquid-Kontext `app.url`) werden zu `communityBaseUrl(community)` – primäre Domain der Community,
   sonst `APP_URL` (für Subs ohne Domain mit `/c/<slug>`-Präfix). Einladungslinks zeigen damit auf
   die Domain der Community; die Einladungsseite identifiziert die Community weiterhin nur über den
   Token und leitet bei Host-Mismatch auf den richtigen Host um.

### 7.2 Datenmodell

```
community_domains
  id            uuid PK
  community_id  text → communities.id cascade
  host          text unique          (kleingeschrieben, ohne Port; "lesekreis.ai-up.club")
  kind          subdomain | custom
  is_primary    boolean              (genau eine je Community; Ziel für erzeugte Links)
  verified_at   timestamptz          (custom: nach DNS-Nachweis; subdomain: sofort)
  created_by    text → users.id
  created_at
```

Subdomain-Labels werden validiert (`[a-z0-9-]{3,40}`, kein führender/abschließender Bindestrich) und
gegen eine **Sperrliste** geprüft: `www`, `meet`, `coolify`, `mail`, `api`, `admin`, `app`, `static`,
`cdn`, `smtp`, `imap`, `ns1`, `ns2`, `default`, `root` – alles, was heute oder absehbar als echter
DNS-Eintrag existiert oder Verwechslung stiftet. Ein Label ist plattformweit eindeutig (`host` unique).

Eigene Domains werden erst aktiv, wenn ein DNS-Nachweis gelungen ist: TXT-Record
`_aiup-verify.<host>` mit einem Zufallswert **oder** CNAME auf `ai-up.club`; Prüfung serverseitig per
`dns.promises.resolveTxt/resolveCname` mit Rate-Limit. Ohne Nachweis könnte jeder Sub-Admin
`ai-up.club` selbst oder die Domain eines anderen eintragen – und beim Caddy-Weg würde der Proxy dafür
ein Zertifikat beantragen.

### 7.3 Auflösung im Request

`getCurrentCommunity()` (Abschnitt 3) bekommt eine Stufe davor:

1. Host aus `headers()` lesen (`host`, ohne Port, kleingeschrieben). Ist er die Hauptdomain
   (`APP_URL`), weiter mit dem Cookie wie geplant.
2. Sonst `community_domains` nach exakt diesem Host fragen (Request-Cache über `react.cache`, dazu
   ein kurzer In-Memory-Cache von 60 s je Prozess – die Tabelle ist winzig, aber die Abfrage läuft in
   jedem Request und in jedem Layout).
3. Treffer → diese Community ist fix; der Cookie wird ignoriert. Kein Treffer → wie Hauptdomain
   behandeln (kommt nur vor, wenn der Proxy einen Host durchreicht, den die App nicht kennt).

**Nie** eine URL aus dem rohen Host-Header bauen – immer aus der gefundenen DB-Zeile. Das schließt
Host-Header-Poisoning aus (ein Angreifer fordert einen Magic Link für ein fremdes Konto mit
gefälschtem Host an; der Link in der Mail zeigt dann auf seinen Server).

Angemeldet auf einer Community-Domain, aber **nicht Mitglied** dieser Community: Seite „Kein Zugang
zu dieser Community" mit Hinweis auf die eigenen Communities; bei aktivem Beitrittslink oder
`allow_registration` das entsprechende Angebot. Nicht angemeldet: Landing der Community, falls
aktiviert, sonst `/login`.

### 7.4 Login

**Subdomains (Stufe A):** `advanced.crossSubDomainCookies: { enabled: true, domain: ".ai-up.club" }`
plus `trustedOrigins: ["https://ai-up.club", "https://*.ai-up.club"]`. Der Magic Link bleibt auf der
Hauptdomain (wie vom Auftrag erlaubt); nach der Verifikation dort ist der Cookie für alle Subdomains
gültig, `callbackURL` darf direkt `https://lesekreis.ai-up.club/home` sein (Origin ist vertraut).
Nebenwirkung, bewusst akzeptiert: Der Session-Cookie wird dann auch an `coolify.ai-up.club` und
`meet.ai-up.club` gesendet. Beide ignorieren ihn, aber er verlässt die App. Wer das nicht will,
nimmt für Subdomains ebenfalls den Handoff aus Stufe B.

**Eigene Domains (Stufe B):** Der Cookie kann nicht geteilt werden, und `allowedHosts` ist statisch.
Deshalb ein **Handoff**:

1. Login-Formular auf `community.verein-xy.de` → Server Action ruft `auth.api.signInMagicLink` mit
   `callbackURL = https://ai-up.club/auth/handoff?domain=<id>&next=/home`. Damit die Server Action
   nicht an Better Auths Origin-Prüfung scheitert, liefert `trustedOrigins` als Funktion alle
   verifizierten Hosts aus `community_domains`.
2. Verifikation läuft auf der Hauptdomain, Cookie wird dort gesetzt, Better Auth leitet auf
   `/auth/handoff` weiter.
3. `/auth/handoff` (Hauptdomain, eingeloggt) legt in Redis einen Einmal-Token ab (60 s, gebunden an
   die Session-Id und die Ziel-Domain) und leitet auf `https://community.verein-xy.de/auth/handoff/<token>`.
4. Dort konsumiert ein **eigenes Better-Auth-Plugin** (`src/server/auth/handoff-plugin.ts`, ein
   Endpoint `/handoff/consume`) den Token, lädt Session und Nutzer über `ctx.context.internalAdapter`
   und setzt den Cookie mit `setSessionCookie(ctx, { session, user })` aus `better-auth/cookies`.
   Das ist der dokumentierte Weg; den Cookie-Wert selbst zu signieren wäre versionsabhängig.
5. Abmelden auf der Community-Domain beendet dieselbe Session-Zeile – der Nutzer ist dann auch auf
   der Hauptdomain abgemeldet. Das ist erwartbar und bleibt so.

### 7.5 Infrastruktur

**Stufe A – einmalig durch Christian in Coolify und bei IONOS** (die App-Seite braucht davon nichts
zu wissen):

1. IONOS-Developer-API-Schlüssel mit DNS-Recht anlegen.
2. Coolify → *Servers → App-VPS → Proxy*: Umgebungsvariable `IONOS_API_KEY` und einen **zweiten**
   Certresolver `letsencrypt-dns` mit `dnschallenge.provider=ionos` ergänzen. Der bestehende
   HTTP-Resolver bleibt unangetastet, damit `ai-up.club`, `www` und `coolify` weiterlaufen.
3. DNS bei IONOS: `*.ai-up.club` A und AAAA auf den App-VPS, mit denselben Werten wie der
   bestehende `@`-Eintrag. Beim AAAA gilt die Falle aus `CLAUDE.local.md`: die Host-Adresse
   eintragen (**auf `::1` endend**), nicht das /64-Netz, das die Hetzner-Konsole anzeigt – sonst
   scheitert Let's Encrypt, weil ACME bei vorhandenem AAAA über IPv6 validiert. Explizite Einträge
   (`meet`, `coolify`, `www`) haben in DNS Vorrang vor dem Wildcard und bleiben unverändert.
4. *Proxy → Dynamic Configurations*: Datei mit einem Router `HostRegexp` auf `*.ai-up.club`,
   `tls.domains[0].main=ai-up.club`, `sans=*.ai-up.club`, `certResolver=letsencrypt-dns`. Coolify
   dokumentiert genau dieses Muster; Traefik nimmt die Datei ohne Neustart.
5. In `docker-compose.yml` am Service `web` Traefik-Labels für einen zweiten Router
   (`HostRegexp`-Regel, `priority` niedrig, `service` = der `web`-Service, TLS wie oben). Die Domains
   `ai-up.club`/`www` bleiben im Coolify-Domain-Feld; die exakten `Host()`-Router von `coolify` und
   `www` gewinnen gegen die Regexp-Regel.

Ein Wildcard-Zertifikat deckt **alle** Subdomains ab – neue Communities kosten keine ACME-Anfrage,
Let's-Encrypt-Limits spielen keine Rolle. Nur Subdomains erster Ebene; `a.b.ai-up.club` ist nicht
abgedeckt (und wird von der Validierung ohnehin verhindert).

**Stufe B – eine Entscheidung, die ein Spike klären muss:**

| | Traefik, dynamische Datei je Domain | Caddy mit On-Demand-TLS |
|---|---|---|
| Prinzip | Die App schreibt je verifizierter Domain eine YAML in das Dynamic-Config-Verzeichnis des Proxys (Volume-Mount in den `web`-Container); Traefik lädt sie ohne Neustart und holt per HTTP-01 ein Zertifikat. | Caddy fragt beim ersten TLS-Handshake einen `ask`-Endpunkt der App (`/api/domains/check?domain=…`), der 200 für verifizierte Hosts liefert, und holt das Zertifikat selbst. |
| Vorteil | Kein Proxy-Wechsel; nutzt den vorhandenen HTTP-Resolver. | Sauber, kein Dateisystem-Kopplung, gedacht für genau diesen Fall. |
| Nachteil | Die YAML muss den Traefik-Servicenamen bzw. Container-Hostnamen von `web` kennen – Coolify vergibt ihn, er ist nicht garantiert stabil. Verzeichnis-Mount des Proxys in einen App-Container ist eine Rechteausweitung. | Wechsel des Proxys auf dem App-VPS im laufenden Betrieb (kurze Downtime, `coolify.ai-up.club` und `ai-up.club` neu verdrahten); Coolify überschreibt manuelle Caddyfile-Änderungen, nur Labels und Dynamic-Config-Dateien überleben. `ask` läuft synchron im Handshake – muss aus Redis antworten, nicht aus Postgres. |
| Grenzen | Ein Traefik-Prozess je Server – erfüllt (nur der App-VPS terminiert die App). | dito |

Empfehlung: Spike mit Caddy auf einem **Wegwerf-VPS**, nicht auf `ai-up-web`. Erst wenn eine echte
Community eine eigene Domain braucht, wird migriert. Die Alternative „Christian trägt die Domain
manuell im Coolify-Domain-Feld nach“ ist als Zwischenlösung legitim (Zertifikat per HTTP-01 kommt
automatisch), aber keine Selbstbedienung und erzeugt bei jeder Änderung ein Redeploy.

### 7.6 Was auf einer Community-Domain sonst noch funktioniert – und was nicht

- **Realtime (SSE), Uploads, `/api/files`:** same-origin, unverändert. Dateien werden über die
  Community-Prüfung aus 1.7 ausgeliefert.
- **LiveKit:** Der Client verbindet sich per WebSocket zu `meet.ai-up.club`; LiveKit prüft keinen
  Origin, das Token stellt unsere App aus. Unverändert.
- **MCP:** `https://<domain>/api/mcp` funktioniert, der API-Schlüssel bestimmt ohnehin die
  Community. Die Admin-Seite zeigt die URL der eigenen Domain.
- **Mails:** Absender bleibt `noreply@ai-up.club` (IONOS-Mailbox). Betreff und Anrede nennen die
  Community, Links zeigen auf ihre Domain – erlaubt, aber nicht nötig.
- **Sprach-Cookie `aiup_locale`:** je Host getrennt; das ist in Ordnung.
- **Nicht möglich:** Die Community-Domain als **Absenderadresse** der Mails (kein SMTP der Community)
  und Landing-Seiten für Subs **ohne** Domain (dann gibt es keinen öffentlichen Einstiegspunkt;
  `/c/<slug>/` könnte das später übernehmen).

### 7.7 Phasen-Ergänzung

| Phase | Inhalt | Abnahme |
|---|---|---|
| **C2 – Subdomains** ✅ 17.09.2026 (App-Seite) | Host-Auflösung (`server/community-context.ts`) vor dem Cookie, **ohne** `community_domains` – die Subdomain *ist* der Slug (siehe unten), Feature-Schalter `COMMUNITY_SUBDOMAINS`, Landing/Impressum/Datenschutz je Host, `crossSubDomainCookies` + Wildcard in `trustedOrigins`, Adress-Karte unter *Allgemein*, *Webseiten* für jede Community mit eigenem Host, Wechsel verlässt den Host. **Offen: Coolify/IONOS nach 7.5 (Christian).** | Lokal geprüft: Anmeldeseite, Landing und Impressum lösen je Host die richtige Community auf, der Magic Link trägt deren Namen, `Domain=.<app host>` wird gesetzt, die Adress-Karte zeigt die Subdomain, *Webseiten* erscheint in der Unter-Community. **Nicht lokal prüfbar**: dass der Browser die Session über die Subdomains teilt – siehe Einschränkung unten. |
| **Spike – Custom Domains** ✅ 17.09.2026 (App-Seite) | Handoff-Plugin gegen Better Auth 1.7 gebaut und zwischen zwei Hosts durchgespielt, `ask`-Endpunkt gebaut und gemessen, dynamische `trustedOrigins`. Offen: Proxy auf einem Test-VPS (Christian). | **Go für die App-Seite** – Ergebnis in Abschnitt 7.9. Die Proxy-Frage bleibt, ist aber entschärft: Stufe B kann ohne Caddy starten. |
| **G – Custom Domains** ✅ 17.09.2026 (App-Seite) | `community_domains` + DNS-Nachweis (TXT oder CNAME), `isHandoffHost`/`handoffOrigins` aus der Tabelle, Weiterleitungen `/auth/handoff` und `/auth/handoff/<token>`, Admin-Karte *Eigene Domain*, `communityUrl` und *Webseiten* folgen der Domain. **Offen: Proxy (Christian)** – zunächst manueller Eintrag in Coolify, Caddy erst für Selbstbedienung. | Lokal geprüft zwischen zwei Hosts: Eintragen, Ablehnung eigener Adressen, echter DNS-Nachweis (Fehlerfall), Sperre gegen zu häufiges Prüfen, Auflösung nur für bestätigte Hosts (auch gegen gefälschten `Host`-Header), Wechsel per Handoff, Abmelden ohne Rückwirkung, Rücknahme. Ergebnis in Abschnitt 7.10. |

### 7.9 Spike-Ergebnis Stufe B (17.09.2026)

**Die Frage war**, ob eine Community auf einer fremden Domain überhaupt angemeldet sein kann: Ein
Cookie überquert keine registrierbare Domain, und Better Auths dynamisches `baseURL.allowedHosts`
ist ein **statisches Array**, nimmt also keine zur Laufzeit dazukommende Kundendomain auf. Ohne
Antwort darauf ist Stufe B tot.

**Antwort: Es geht.** Der Prototyp (`src/server/auth/handoff-plugin.ts`, hinter
`COMMUNITY_CUSTOM_DOMAINS`) wurde zwischen zwei echten Hosts mit getrennten Cookie-Speichern
durchgespielt (`localhost:3000` und `127.0.0.1:3000`):

| Geprüft | Ergebnis |
|---|---|
| Anmeldung auf dem Haupthost, Übergabe auf den zweiten | Sitzung dort aktiv, richtiger Nutzer |
| Token ein zweites Mal einlösen | abgelehnt (`GETDEL`, einmalig) |
| Token auf dem falschen Host einlösen | abgelehnt, Token danach verbrannt |
| Token für einen unbekannten Host anfordern | abgelehnt |
| Token ohne Anmeldung anfordern | abgelehnt |
| Gültigkeit in Redis | 60 s |
| Abmelden auf der Kundendomain | beendet **nur** die dortige Sitzung |
| `ask`-Endpunkt (`/api/domains/check`) | 200/403/400 korrekt, 5–9 ms |

**Zwei Dinge, die der Plan nicht vorhergesehen hatte:**

1. **`trustedOrigins` muss eine Funktion sein, nicht eine Liste.** Sonst funktioniert der Handoff
   zwar, aber Better Auths eigene Endpunkte (Abmelden, Session-Refresh) und jede Server Action
   lehnen Anfragen von der Kundendomain mit „Invalid origin" ab – man wäre dort angemeldet und käme
   nicht wieder heraus. Die Funktion liefert die verifizierten Domains zur Laufzeit.
2. **Origins tragen den Port.** Sowohl das Subdomain-Wildcard als auch die Kundendomains müssen ihn
   enthalten, sonst greifen sie in der Entwicklung nie. In Produktion (443) ist er leer.

**Eine Design-Abweichung, die sich als besser erwies:** Der Plan sah vor, dieselbe Sitzungs-Zeile zu
übernehmen („Abmelden auf der Community-Domain meldet auch auf der Hauptdomain ab"). Der Prototyp
legt stattdessen eine **eigene Sitzung je Host** an. Damit beendet das Abmelden auf der Kundendomain
nur diese – was bei zwei verschiedenen Adressen die erwartbare Wirkung ist – und die Hauptdomain
bleibt unberührt. Im Test bestätigt.

**Zur offenen Proxy-Frage (Traefik-Datei vs. Caddy) ergibt sich eine dritte, bessere Antwort für den
Anfang:** Weil die App-Seite fertig ist, braucht Stufe B den Proxy-Umbau **nicht sofort**. Für die
ersten Kundendomains genügt, dass Christian die Domain im Coolify-Domain-Feld der Ressource nachträgt
– Traefik holt das Zertifikat dann per HTTP-01, und die App funktioniert bereits vollständig. Damit
ist Stufe B ohne Risiko am Produktivsystem nutzbar. Automatisch (Selbstbedienung durch Sub-Admins)
wird es erst mit Caddys On-Demand-TLS; der `ask`-Endpunkt dafür steht und ist schnell genug. Der
Wegwerf-VPS-Test bleibt sinnvoll, ist aber kein Blocker mehr.

**Was Phase G noch braucht:** die Tabelle `community_domains` (Host, `verified_at`, `is_primary`),
den DNS-Nachweis (TXT `_aiup-verify.<host>` oder CNAME) vor der Freischaltung, `isHandoffHost` und
`handoffOrigins` auf diese Tabelle umstellen statt auf `HANDOFF_TEST_HOSTS`, die Weiterleitungsseite
`/auth/handoff/<token>` auf der Kundendomain sowie die Admin-Oberfläche zum Eintragen.

### 7.10 Phase G – Ergebnis (17.09.2026)

Der Spike hatte die Frage „geht das überhaupt" beantwortet; Phase G macht daraus ein bedienbares
Feature. Gebaut wurde:

| Teil | Wo |
|---|---|
| Tabelle `community_domains` (Host, `verify_token`, `verified_at`, `last_checked_at`, `is_primary`) | `drizzle/0025_community_domains.sql` |
| Eintragen, Prüfen, Hauptadresse setzen, Entfernen | `src/server/domain/community-domains.ts` |
| Host-Validierung und DNS-Vergleich (pur, getestet) | `src/lib/community.ts` (`checkCustomHost`, `proofMatches`, `verifyRecordName`) |
| Auflösung Host → Community | `src/server/community-context.ts` (Domain **vor** Subdomain) |
| Handoff-Weiterleitungen | `src/app/(public)/auth/handoff/` (Start und Einlösung) |
| Admin-Oberfläche *Eigene Domain* | `src/app/admin/general/domain-card.tsx` |

**Der Nachweis.** Eine Domain tut nichts, solange `verified_at` leer ist – das gilt für die
Auflösung, für die vertrauten Origins, für den Handoff und für die Zertifikatsfrage des Proxys.
Anerkannt werden zwei Wege: ein TXT-Eintrag `_aiup-verify.<host>` mit dem Token (funktioniert auch
auf einer Apex-Domain, wo CNAME nicht erlaubt ist) oder ein CNAME auf den App-Host – den kann nur
der Zoneninhaber anlegen, und er wird ohnehin gebraucht. Eine gescheiterte Prüfung ist kein Fehler,
sondern „noch nicht sichtbar"; eine Wiederholung ist 20 Sekunden lang gesperrt.

**Abweichung von 7.2:** keine Spalte `kind`. Subdomains stehen nicht in dieser Tabelle – seit C2 *ist*
die Subdomain der Slug. Die Tabelle führt ausschließlich fremde Hosts. Ebenfalls anders: Die
**Root-Community bekommt keine eigene Domain**. Sie besitzt bereits den Haupthost, und eine
„Hauptadresse" für sie würde still jeden erzeugten Link der Installation umschreiben. Wer das will,
ändert `APP_URL`, wo die Folge sichtbar ist.

**Zwei Fehler, die erst im Durchlauf auftauchten:**

1. **`NextRequest.url` trägt nicht den angefragten Host**, sondern den konfigurierten Ursprung der
   App. Die Weiterleitung nach erfolgreicher Übergabe landete damit wieder auf der Hauptdomain –
   genau die Reise, die die Route beenden soll. Beide Handoff-Routen antworten jetzt mit einem
   **relativen** `Location`; das löst der Browser gegen die Adresse auf, die er gefragt hat.
2. **`router.push` navigiert nicht zu einem Route-Handler.** Der Community-Wechsel holte die
   Weiterleitung als Daten und blieb stehen. `switchCommunityAction` sagt jetzt mit `leaveApp`, wann
   ein echter Seitenaufruf nötig ist.

**Geprüft** (zwischen `localhost:3000` und `127.0.0.1:3000`, getrennte Cookie-Speicher):

| Geprüft | Ergebnis |
|---|---|
| Eigene Adresse der Installation eintragen (`lesekreis.localhost`) | abgelehnt mit Hinweis auf den Kurznamen |
| Fremde Domain eintragen, Nachweis prüfen (echtes DNS) | „noch kein passender Eintrag sichtbar" |
| Sofort noch einmal prüfen | gesperrt, 20 s |
| Bestätigte Domain aufrufen | richtige Community, eigenes Branding |
| Unbestätigte Domain und fremder Host per gefälschtem `Host`-Header | fallen auf die Root zurück, kein Zugriff |
| `/api/domains/check` | 200 nur für bestätigt, 403 für unbestätigt und fremd |
| Community-Wechsel in die Community mit Domain | Handoff, danach angemeldet auf der Domain |
| `/c/<slug>/knowledge` | leitet über den Handoff auf die Domain, Pfad bleibt erhalten |
| Abmelden auf der Domain | nur dort abgemeldet, Haupthost unberührt |
| *Webseiten* im Admin-Menü | erscheint mit bestätigter Domain, verschwindet nach dem Entfernen |
| Adress-Karte | zeigt die Domain, nach Entfernen wieder `/c/<slug>` |
| Löschen der Community mit Domain-Zeilen | Purge läuft durch, keine Reste |

**Was nicht geprüft ist:** der erfolgreiche DNS-Nachweis gegen echtes DNS – dafür müsste eine Zone
unter unserer Kontrolle stehen. Getestet ist stattdessen die Entscheidung selbst (`proofMatches`,
vier Fälle) und die Fehlerseite gegen echte Abfragen. Ebenfalls offen: HTTPS, weil lokal alles über
HTTP läuft.

**Was noch fehlt, und zwar außerhalb der App:** Der Proxy muss den fremden Host annehmen. Bis dahin
gilt der Weg aus 7.9 – Christian trägt die Domain im Coolify-Domain-Feld nach, Traefik holt das
Zertifikat per HTTP-01, und die App funktioniert vollständig. Selbstbedienung durch Unter-Admins
braucht Caddys On-Demand-TLS; der `ask`-Endpunkt dafür steht und antwortet nur für bestätigte Hosts.

### 7.8 Zusätzliche Entscheidungen

| # | Frage | Empfehlung |
|---|---|---|
| 7.a | Stufe A jetzt, Stufe B später? | Ja. |
| 7.b | Handoff auch für Subdomains (kein Cookie an `coolify`/`meet`)? | Nein, `crossSubDomainCookies` reicht; Handoff nur für eigene Domains. |
| 7.c | Darf die Root ihre Landing weiter auf `ai-up.club` zeigen, während Subs Subdomains haben? | Ja, die Root ist die Hauptdomain. |
| 7.d | Wer darf eine Subdomain ändern oder löschen? | Sub-Admins; Root-Admins zusätzlich (Sperrliste pflegen, Missbrauch). |
| 7.e | Custom Domain per Traefik-Datei oder Caddy? | Nach Spike; Tendenz Caddy, wenn mehr als eine Handvoll Domains erwartet werden. |
