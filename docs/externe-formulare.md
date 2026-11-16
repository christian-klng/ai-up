# Externer Kanal für Sammlungen („Formular")

Stand: 16.11.2026 – alle vier Phasen umgesetzt.

Eine Sammlung kann per Schalter einen Kanal nach außen öffnen: Nicht-Mitglieder senden über ein
Formular Einträge ein („erstellt von Extern"). Gedacht für Ideen, Feature Requests und
Support-Anfragen von Kunden.

## 1. Grundentscheidungen

- **Ein Formular je Sammlung**, nach dem Muster von `meeting_invites`: Zufallstoken, `enabled`
  standardmäßig aus, Zähler, Token bleibt beim Ab- und Anschalten stabil. Wer ein zweites Formular
  braucht, legt eine zweite Sammlung an.
- **Das Formular ist eine Vorlage der Sammlung.** Der Admin wählt die Vorlage und hakt an, welche
  Felder öffentlich sind. Nicht freigegebene Felder (z. B. „Kategorie", „Status") bleiben leer und
  werden vom Team oder vom Workflow gefüllt.
- **Geprüft wird nur gegen den öffentlichen Teil der Vorlage** (`publicDefinition()` in
  `src/lib/collection-forms.ts`): Ein internes Feld darf für Mitglieder Pflicht sein, ohne Externe
  zu blockieren. Gespeichert wird trotzdem der volle Vorlagen-Snapshot; wer den Eintrag später
  bearbeitet, muss die internen Pflichtfelder füllen. Einschalten geht nur mit Vorlage und
  mindestens einem ausfüllbaren Feld. Ein freigegebenes Feld, dessen `showIf` auf ein internes
  zeigt, erscheint nie.
- **Jede Einsendung hat einen Titel** (Pflichtfeld über den Vorlagenfeldern, Beschriftung
  einstellbar) – Einträge brauchen einen.
- **Erlaubte Feldtypen:** `info`, `text`, `textarea`, `select`, `chips`, `checkbox`, `link`,
  `markdown` (als einfaches Textfeld, nicht `multiple`) und `image` (nur Upload). Whiteboard,
  Kanban, Prozess, QA und Video bleiben draußen.
- **Einbettung per iframe auf unsere eigene Seite**, nicht als fremd gerendertes Markup: isolierte
  Styles, kein CORS, der Spam-Schutz bleibt auf unserem Origin.
- **Gehört der Community**, nicht dem Betreiber – wie Workflows und Vorlagen.

## 2. Datenmodell

- **`collection_forms`** (eine Zeile je Sammlung, entsteht beim ersten Speichern oder Einschalten):
  `areaId` (unique), `token`, `enabled`, `enabledBy`, `submissionCount`, `templateId`,
  `fieldKeys[]`, Texte (Titel, Einleitung, Button), `contact` (`off | optional | required`),
  `success` (JSON, Abschnitt 5), `dailyLimit`.
- **`form_submissions`**: `formId`, `contentId`, gehashter Abruf-Schlüssel, Kontakt (Name, E-Mail,
  Mail-Einwilligung), einbettende Seite, `response` (`pending | ready | fallback`, Stil, Titel,
  Markdown).
- **Kontaktdaten stehen nur in `form_submissions`**, nie im `bodyMarkdown` – also nicht in Suche,
  Agenten-Kontext oder auf öffentlichen Seiten. Nur Admins sehen sie.
- **Eintrag:** `contents.authorId = null` plus `EventOrigin`
  `{ kind: "external", formId, submissionId }` und Spalte `contents.external` – daran hängt das
  Badge „Extern" (ohne Join in den Listen). Die Kontaktzeile auf der Eintragsseite sehen nur Admins.

## 3. Öffentliche Oberflächen

| Variante | Umsetzung |
|---|---|
| Link | Seite `/f/<token>` in der Route-Gruppe `(public)` |
| Im Text, extern | `<aiup-form token="…">` lädt ein iframe auf `/f/<token>?embed=1`, Höhe per `postMessage` |
| Schwebender Button, extern | dasselbe Skript mit `mode="button"`: fixer Button plus Overlay mit iframe |
| Link/Button auf beliebigem Element | Attribut `data-aiup-form="<token>"` öffnet dasselbe Overlay |
| Eigene Webseite | Sektion `form` in `landing-schema.ts` (`collectionId`, `display: inline \| button \| floating`), nativ gerendert |

- **Sektion `form`:** Die Seiten-Definition nennt nur die Sammlung (`collectionId`, wie bei
  `posts`), nie Token oder URL. Aufgelöst wird auf dem Server (`resolveSectionForms`, in
  `LandingView` und im Admin-Editor); ist das Formular aus, bleibt die Sektion unsichtbar und
  `landingWarnings()` meldet es. Im Editor `inert`; `floating` erscheint dort an Ort und Stelle
  statt fixiert. Angelegt wird die Sektion wie alle anderen über die Seiten-Definition (MCP,
  Regeln in `aiup://docs/pages`).
- **Skript:** `/api/forms/embed.js` (Quelle `src/lib/form-embed-script.ts`, schlichtes ES2017 ohne
  Abhängigkeiten). Es setzt nur das iframe, öffnet das Overlay und hört auf drei Nachrichten der
  Formularseite (`src/components/forms/embed-bridge.tsx`): `aiup-form:height` (iframe so hoch wie
  der Inhalt – gemessen wird `<main>`, weil `<body>` sich auf die Rahmenhöhe streckt),
  `aiup-form:submitted` (wird als gleichnamiges DOM-Event am einbettenden Element ausgelöst) und
  `aiup-form:redirect` (die Weiterleitung nach dem Absenden kann nur die äußere Seite ausführen;
  nur https). Nachrichten zählen nur vom Origin des Skripts und von einem iframe, das es selbst
  gesetzt hat. Attribute von `<aiup-form>`: `token`, `mode` (`inline | button | link`), `label`,
  `color`, `position="left"`.
- **Im iframe** behält die Formularseite ihren deckenden Hintergrund: ein durchsichtiges Formular
  wäre auf einer dunklen Fremdseite unlesbar, sobald App-Theme und Seite nicht zusammenpassen.
- **Snippets** zum Kopieren stehen im Dialog „Externer Kanal" unter „Einbetten".
- **API:** `POST /api/forms/<token>/submissions`, `GET /api/forms/<token>/submissions/<id>?key=…`.
- **Proxy:** `/f` und `/api/forms` in `PUBLIC_PREFIXES`, `f` in `RESERVED_PAGE_SLUGS`.
- **Hosts:** Das Token löst die Community auf; die Seite funktioniert auf Haupthost, Subdomain und
  eigener Domain. Snippets im Admin baut `communityUrl()`.

## 4. Schutz gegen Missbrauch

Ein anonymer Schreibpfad ist neu in der App.

- **Spam:** Honeypot-Feld und Mindest-Ausfüllzeit (signierter Zeitstempel der Seite, mindestens
  3 s, höchstens 24 h), Rate-Limit in Redis je IP und je Formular,
  Tageslimit je Formular, harte Größenlimits. Die IP wird nicht gespeichert (nur gehasht als
  Redis-Schlüssel mit Ablauf). Kein Fremd-CAPTCHA; bei Bedarf später ALTCHA.
- **Bewertung:** `queueEvaluation` überspringt `origin.kind === "external"`, sonst löst jede
  Spam-Einsendung LLM-Aufrufe aus.
- **Link-Felder:** für Externe nur `assertPublicUrl`, kein Preview-Abruf – sonst ließe sich unser
  Server von Anonymen zum Abrufen beliebiger URLs benutzen.
- **Bestehende Content-Trigger:** `content.created` ignoriert externe Einsendungen, solange
  `includeExternalOrigin` aus ist.
- **Datenschutz:** Hinweis mit Link auf `/privacy` unter dem Formular. Aufbewahrungsfrist für
  Kontaktdaten ist noch festzulegen.

### Bild-Upload für Externe

- `/api/upload` bekommt einen zweiten Zugang über das Formular-Token statt einer Sitzung
  (`purpose: "form"`); Magic-Bytes-Prüfung wie gehabt.
- Nur Rasterbilder (kein SVG), 5 MB je Bild, drei Bilder je Einsendung, Rate-Limit je IP.
- Der Upload liefert `mediaId` plus HMAC-Ticket, das die Einsendung vorlegen muss – niemand kann
  fremde `mediaId`s an einen Eintrag hängen.
- Mit der Einsendung wechselt der Zweck des Bildes von `form` auf `content`: Es ist dann normaler
  Inhalt, und dasselbe Bild lässt sich kein zweites Mal anhängen. Ein Bild per URL nehmen wir von
  außen nicht an.
- Täglicher Worker-Job `{kind:"cleanup-form-uploads"}` löscht Uploads, die nach 24 h noch
  `purpose: "form"` tragen, also nie eingesandt wurden.
- Die Bilder sind nicht öffentlich: `/api/files` liefert sie nur an Mitglieder der Community.

## 5. Erfolgsmeldung

- **Statisch:** Titel und Markdown-Text, Design `plain | card | celebrate`. Optional Knopf
  „Weitere Einsendung" und Weiterleitungs-URL (nur https).
- **Dynamisch:** Schalter „Antwort vom Workflow abwarten" mit Timeout (Standard 20 s, höchstens 60).
  Gewartet wird nur, wenn es einen aktiven Workflow mit Trigger `form.submitted` für die Sammlung
  gibt (`hasFormWorkflow`) – sonst erscheint die statische Meldung sofort.
  Die Einsendung antwortet sofort mit `submissionId` und Abruf-Schlüssel; das Formular zeigt
  „Wird bearbeitet…" und fragt per Polling ab (die Realtime-Kanäle sind nutzer- und
  communitygebunden). Kommt nichts rechtzeitig oder scheitert der Workflow, erscheint die statische
  Meldung.
- Das Markdown der Antwort läuft durch unseren Renderer, ohne HTML.

## 6. Workflows

Trigger in `src/server/workflows/triggers/index.ts`, Aktionen in `actions/forms.ts`, Fachlogik in
`domain/collection-forms.ts` (`setSubmissionResponse`, `getSubmissionResponse`, `replyToSubmitter`).
Das Event `form.submitted` wird erst emittiert, wenn die Zeile in `form_submissions` steht – ein
Workflow kann also sofort antworten.

- **Trigger `form.submitted`:** eigener Event-Typ, Filter nach Sammlung. Payload `content.*`,
  `submission.id`, `submission.answers.<key>`, `submission.contact`, `submission.pageUrl`.
- **Aktion `respond_to_submission`:** Stil, Titel, Text (Liquid) → `form_submissions.response`.
- **Aktion `update_entry`:** setzt einzelne Antworten eines Eintrags (`origin: workflow`, Autor der
  Version ist der Bot), damit z. B. die Kategorie im Eintrag landet und nicht nur in der Meldung.
  `answers` ist ein JSON-Objekt; die Liquid-Vorlagen darin werden **je Wert nach dem Parsen**
  gerendert – Text eines LLM oder Einsenders kann die Struktur also nicht brechen. Nur einfache
  Feldtypen (Text, Auswahl, Chips, Checkbox, Link), fehlende Pflichtfelder blockieren nicht, ein
  abgelehnter Wert oder ein per `showIf` verborgenes Feld lässt den Schritt scheitern. Für externe
  Einträge ohne Eintrags-Bewertung und ohne Link-Preview.
- **Aktion `reply_to_submitter`** (Mail an Einsender):
  - Kein freier Empfänger – nur `submissionId`, Adresse kommt aus `form_submissions`.
  - Eigener Schalter am Formular „Antwort per E-Mail erlauben" (Standard aus); verlangt das
    Kontaktfeld E-Mail und eine Einwilligungs-Checkbox. Ohne Häkchen: `skipped`.
  - Limits: eine Mail je Einsendung, drei je Adresse und Tag über alle Formulare, Tageslimit des
    Formulars.
  - Betreff/Text als Liquid; der Text geht als schlichte Absätze hinaus (kein HTML, kein
    Markdown-Rendering), fester Fußtext (Community, Formular, Anlass). Sprache = Standardsprache
    der Community.
  - Greift eine Leitplanke, endet der Schritt erfolgreich mit `sent: false` und `reason`
    (`disabled | noConsent | alreadySent | addressLimit`).
  - **Restrisiko:** Trägt jemand eine fremde Adresse ein und gibt der Workflow die Eingaben
    wieder, bekommt ein Dritter fremden Text über unsere Domain. Limits begrenzen das, verhindern
    es nicht; ganz schließen würde es nur ein Double-Opt-in (nachrüsten bei Missbrauch).

## 7. Verwaltung und MCP

- **Admin:** *Verwaltung → Sammlungen → Sammlung*, Abschnitt „Externer Kanal": Schalter, Vorlage,
  Feldauswahl, Texte, Erfolgsmeldung, Zähler, kopierbarer Link (Snippets ab Phase 3).
- **MCP:** `get_collection_form` (`knowledge:read`: Einstellungen, Adresse, Zähler, Vorlagen mit
  Feldern, Einbett-Code) und `update_collection_form` (`knowledge:write`, Merge-Semantik:
  weggelassene Felder behalten ihren Wert; schaltet nie ein oder aus). Der Schalter
  `set_collection_form_enabled` hat den **eigenen Scope `knowledge:forms`** – analog zu
  `meetings:invite`, weil ein geöffnetes Formular jede Person im Internet in die Community
  schreiben lässt. Regeln für Clients stehen in `aiup://docs/collections` (Abschnitt „External
  channel"). Der Schlüssel-Dialog wählt beim Anlegen weiterhin alle Scopes vor, auch diesen.

## 8. Reihenfolge

1. **Kern:** Migration, Domäne `domain/collection-forms.ts`, `/f/<token>`, Einsende-API mit
   Schutz, Bild-Upload samt Aufräum-Job, Admin-Abschnitt, statische Erfolgsmeldung, Badge „Extern",
   Origin `external`.
2. **Workflows:** Trigger, die vier Aktionen, dynamische Erfolgsmeldung mit Polling.
3. **Einbettung:** `embed.js` mit den drei Modi, Landing-Sektion `form`.
4. **Abrundung:** MCP-Tools, Doku, Tests.

## 9. Später

- Öffentliche Ideenliste mit Voting (auf Basis von `public_on_site`).
- ALTCHA (selbst gehosteter Proof-of-Work).
- Allgemeine Dateianhänge (neuer Elementtyp).
- Double-Opt-in für Mail an Einsender.
