# Eigene Webseiten: Blog, Changelog, Features (Stand 24.10.2026)

Admins sollen neben Landing Page, Impressum und Datenschutz **bis zu fünf eigene öffentliche Seiten**
anlegen können, etwa „Features", „Blog" oder „Changelog". Angelegt und eingerichtet wird in der UI unter
*Verwaltung → Webseiten*, gepflegt in der UI oder per MCP. UI-Name: „Eigene Seite" / „Custom page".

Stand: **umgesetzt** (24.10.2026, Stufen A bis C in einem Zug). Abweichungen vom Plan stehen in Abschnitt 10.

---

## 1. Entscheidungen

| Frage | Entscheidung |
|---|---|
| Was ist eine eigene Seite? | Dasselbe Sektions-Schema wie die Landing Page (`src/lib/landing-schema.ts`), mit derselben Versionierung und demselben Bild-Pool. Keine zweite Seiten-Technik. |
| Adresse | **Freie Pfade** wie `/blog` oder `/features`. Ein Slug darf keinen reservierten Namen tragen (Abschnitt 4). |
| Grenze | **Fünf eigene Seiten zusätzlich** zu Landing Page, Impressum und Datenschutz (`MAX_CUSTOM_PAGES = 5` je Community). Geprüft wird in der Domänenschicht, nicht nur in der UI. |
| Blog und Changelog | Sind **keine eigene Seitenart**, sondern eine eigene Seite mit der Sektion `posts`. Die Beiträge sind Einträge einer **Sammlung** (Vorlagen, Versionen, Suche, Bewertung, MCP gibt es dort schon). |
| Freigabe von Beiträgen | **Einmal veröffentlicht, Änderungen sofort sichtbar** (`contents.published_at`). Veröffentlichen dürfen nur Admins. |
| Vorlagen für Blog/Changelog | **Beim Anlegen der Seite:** Wer eine Blog- oder Changelog-Seite anlegt, bekommt eine passende Sammlung samt Vorlage. Es gibt keine neuen System-Vorlagen. |
| Navigation | Je Seite der Schalter „In der Navigation zeigen". Der Kopf aller öffentlichen Seiten zeigt diese Links, mobil im vorhandenen Burger-Menü. Footer-Links bleiben Teil der Seiten-Definition. |
| Wer darf das? | Wie die heutigen Webseiten: `requirePagesAdmin()`, also jede Community mit eigenem Host (`canManagePublicPages`). |
| Sprache | Einsprachig wie die heutigen Seiten. |
| Löschen | Nur in der UI, mit Bestätigung. Die Versionen verschwinden mit (Cascade). MCP bekommt **kein** `delete_page`, ausschalten reicht dort. |

---

## 2. Ausgangslage

- **Versionen:** `landing_page_versions` hält die Versionen aller drei Seiten, unterschieden über die
  Text-Spalte `page` (`landing|imprint|privacy`). Eindeutig ist `(community_id, page, version)`.
- **Schalter:** drei feste Spalten in `communities` (`landingEnabled`, `imprintEnabled`,
  `privacyEnabled`), aufgelöst über `isPageEnabled`/`pageEnabledColumn` in `domain/landing.ts`.
- **Routen:** `/imprint` und `/privacy` sind eigene Dateien unter `src/app/(landing)/`, beide nach dem Muster
  „`getPublicCommunity()` → Schalter → aktuelle Version → `LandingView`, sonst `notFound()`".
- **Proxy:** `src/proxy.ts` ist ein Cookie-Gate. Pfade außerhalb von `PUBLIC_PREFIXES` leitet es ohne
  Sitzungs-Cookie nach `/login`. Autorisierung passiert dort nicht, sondern in Layouts, Actions und
  Routen.
- **Admin:** `src/app/admin/pages/` zeigt drei feste Tabs (`SITE_PAGES`, `PAGE_URLS`) mit Schalter,
  Verlauf und Inline-Editor (`landing-editor.tsx`, Klickziele über `data-ep`).
- **MCP:** `get_page`/`validate_page`/`update_page`/`list_page_versions`/`restore_page_version`/
  `set_page_enabled`, Parameter `page` als `z.enum(SITE_PAGES)`, Scopes `landing:read|write`.
- **Bilder:** `purpose: "landing"` ist öffentlich (`PUBLIC_MEDIA_PURPOSES` in `/api/files/[id]`).
  Bilder aus Sammlungs-Einträgen sind es **nicht**.

Die festen drei Seiten bleiben, wie sie sind. Eigene Seiten kommen daneben, damit `/`, `/imprint` und
`/privacy` und ihre Schalter nicht angefasst werden müssen.

---

## 3. Datenmodell

### 3.1 Neue Tabelle `site_pages`

| Spalte | Typ | Zweck |
|---|---|---|
| `id` | uuid | |
| `community_id` | FK, Cascade | wie überall (`communityScope()`) |
| `slug` | text | `^[a-z0-9]+(?:-[a-z0-9]+)*$`, max. 60, eindeutig je Community, kein reservierter Name (4.1) |
| `title` | text | Name in Admin-Tabs und Navigation (max. 40) |
| `enabled` | boolean, Standard `false` | wie die bestehenden Schalter: aus → 404 |
| `show_in_nav` | boolean, Standard `false` | Link im Kopf der öffentlichen Seiten |
| `sort_order` | integer | Reihenfolge in Tabs und Navigation |
| `created_by` | FK users, set null | |
| timestamps | | |

Unique-Index `(community_id, slug)`.

### 3.2 Versionen

`landing_page_versions` bekommt die nullbare Spalte `site_page_id` (FK auf `site_pages`, **Cascade**).
Bei eigenen Seiten ist `page = "custom"`. Den Unique-Index `(community_id, page, version)` ersetzen zwei
partielle Indizes:

- `(community_id, page, version) WHERE site_page_id IS NULL`, für die drei festen Seiten wie bisher
- `(site_page_id, version) WHERE site_page_id IS NOT NULL`

Die neue Spalte ist nullbar und bestehende Zeilen bleiben unverändert, deshalb ist die Migration einstufig.
Eine Umbenennung gibt es nicht, `drizzle-kit generate` fragt also nicht interaktiv.

### 3.3 Die Grenze von fünf

`createSitePage(communityId, …)` zählt in einer Transaktion die Seiten der Community, nachdem es die
Community-Zeile mit `SELECT … FOR UPDATE` gesperrt hat. So können zwei gleichzeitige Anfragen (UI und
MCP) nicht zusammen auf sechs Seiten kommen. Bei Überschreitung gibt es den Fehlercode `page_limit`, mit
Meldung in UI und MCP.

### 3.4 Beiträge (für Blog und Changelog)

- `knowledge_areas.public_on_site` (boolean, Standard aus): Die Sammlung darf auf öffentlichen Seiten
  erscheinen.
- `contents.published_at` (timestamptz, nullbar): Der Eintrag ist veröffentlicht. Gezeigt wird immer
  seine **aktuelle** Version.
- `contents.slug` (text, nullbar, eindeutig je Sammlung): Wird beim Veröffentlichen aus dem Titel erzeugt
  und bleibt danach stabil, auch wenn sich der Titel ändert. Bei Kollision bekommt er ein Suffix `-2`,
  `-3` usw.

Alle drei Spalten sind nullbar bzw. haben einen Standard, deshalb ist auch diese Migration einstufig.
Dazu kommt die Tabelle `public_entry_media` für die Bilderfreigabe (7.4).

---

## 4. Adressen, Proxy und Routen

### 4.1 Reservierte Namen

`RESERVED_PAGE_SLUGS` in `src/lib/site-pages.ts` (pur, ohne `next/*`) enthält jedes oberste
Pfadsegment, das die App selbst belegt:

- **App:** `home`, `knowledge`, `meetings`, `members`, `messages`, `notifications`, `profile`,
  `workflows`, `agents`, `communities`, `admin`
- **Auth und öffentliche Wege:** `login`, `register`, `pending`, `invite`, `join`, `auth`, `c`, `imprint`,
  `privacy`
- **Technik:** `api`, `_next`, `vendor`, `favicon.ico`, `robots.txt`, `sitemap.xml`
- **Seitennamen:** `landing`, damit der MCP-Parameter `page` eindeutig bleibt (6.1)
- **Vorgemerkt für später:** `settings`, `search`, `help`, `docs`, `status`

**Gegen das Auseinanderlaufen** prüft ein Test, dass jedes Verzeichnis direkt unter `src/app` (Route-Gruppen
`(…)` aufgelöst, dynamische Segmente ausgenommen) in `RESERVED_PAGE_SLUGS` steht. Wer eine neue App-Route
anlegt und die Liste vergisst, bekommt einen roten Test, keine still verschwundene Seite.

Bleibt ein Rest-Risiko: Eine neue App-Route bekommt den Namen einer Seite, die eine Community **schon
angelegt** hat. Dann gewinnt die statische App-Route, und die Seite ist nicht mehr erreichbar. Gegenmittel:
`landingWarnings()` und die Admin-Ansicht markieren Seiten, deren Slug inzwischen reserviert ist, mit
dem Hinweis „Bitte umbenennen".

### 4.2 Proxy

Heute führt jeder unbekannte Pfad ohne Cookie nach `/login`. Neu gilt: Ohne Cookie lässt der Proxy einen
Pfad durch, wenn er **ein oder zwei Segmente** hat, das erste Segment dem Slug-Muster entspricht und
**nicht** reserviert ist. Zwei Segmente sind nötig für Beiträge (`/blog/<beitrag>`).

```ts
const first = pathname.split("/")[1];
if (CUSTOM_PAGE_PATH.test(pathname) && !RESERVED_PAGE_SLUGS.has(first)) return NextResponse.next();
```

Das ist sicher, weil der Proxy ohnehin keine Autorisierung leistet. Reservierte App-Pfade bleiben
weiterhin hinter dem Cookie-Gate. Gibt es keine solche Seite, antwortet die Route mit 404 statt mit
einer Weiterleitung zum Login.

### 4.3 Routen

- `src/app/(landing)/[page]/page.tsx`: eine eigene Seite, nach dem Muster von `imprint/page.tsx`,
  inklusive `generateMetadata`. Unbekannt, reserviert oder ausgeschaltet: `notFound()`.
- `src/app/(landing)/[page]/[post]/page.tsx`: ein Beitrag (7.3).
- Statische Segmente schlagen in Next dynamische. `/home`, `/meetings` & Co. gewinnen also immer gegen
  `[page]`. Vor der Umsetzung im Next-16-Leitfaden (`node_modules/next/dist/docs/`) gegenprüfen, dass
  ein dynamisches Segment auf oberster Ebene neben Route-Gruppen und `c/[slug]` keine Konflikte erzeugt.

### 4.4 Navigation und Links

- `LandingShell` bekommt `nav: {title, href}[]` aus `listSitePages` (nur `enabled && show_in_nav`,
  sortiert). Die Navigation gilt auf allen öffentlichen Seiten, auch auf `/`, `/imprint`, `/privacy` und
  Beitragsseiten. Desktop: Links neben „Anmelden"; mobil im vorhandenen Sheet.
- `landingWarnings()` meldet interne Links auf eigene Seiten, die fehlen oder ausgeschaltet sind.
  Footer-Links sind freie hrefs und brechen sonst still, sobald jemand eine Seite umbenennt oder
  abschaltet.
- Wird ein Slug geändert, sterben alte Links. Der Dialog warnt davor, Weiterleitungen gibt es vorerst
  nicht.

---

## 5. Admin-UI

*Verwaltung → Webseiten* behält die drei festen Tabs. Dahinter kommen die eigenen Seiten als weitere
Tabs und ein Knopf **„Seite hinzufügen"**. Der Knopf ist bei fünf Seiten deaktiviert, mit dem Hinweis
„Höchstens 5 eigene Seiten".

- **Dialog „Seite hinzufügen":** Titel, Slug (aus dem Titel vorgeschlagen, editierbar, live gegen
  reservierte und vergebene Namen geprüft), Art:
  - *Leer:* eine Markdown-Sektion
  - *Features:* Hero + Features + CTA
  - *Blog:* Hero + `posts` (Layout `cards`). Legt dazu die Sammlung „Blog" an, mit Vorlage
    „Blog-Artikel" (Titelbild, Anreißer, Markdown) und `public_on_site = true`.
  - *Changelog:* Hero + `posts` (Layout `timeline`). Legt dazu die Sammlung „Changelog" an, mit Vorlage
    „Changelog-Eintrag" (Version, Datum, Änderungen als Akkordeon-Liste) und `public_on_site = true`.

  Die Startvorlagen sind Code (`src/lib/site-page-starters.ts`), die Texte stehen in `de.json`/`en.json`
  und werden in der Sprache der Community eingesetzt. Sammlung und Vorlage legt
  `createSitePageWithSetup()` an, nach dem Muster von `createCommunityWithSetup()`: Jeder Schritt ist
  einzeln gekapselt, damit ein Fehler keine halbe Seite hinterlässt.
- **Je Tab** wie bei den festen Seiten: Schalter „Veröffentlicht", Link zur öffentlichen Adresse,
  Verlauf mit Wiederherstellen, Inline-Editor. Dazu „Einstellungen" (Titel, Slug, Navigation,
  Reihenfolge per Hoch/Runter) und „Löschen". Löschen fragt, ob eine angelegte Sammlung bleiben soll
  (Standard: bleibt, nur `public_on_site` geht aus).
- **Sammlungen:** Unter *Verwaltung → Sammlungen* gibt es den Schalter „Auf öffentlichen Seiten zeigen"
  mit Warnhinweis, nur in Communities mit `canManagePublicPages`. Am Eintrag gibt es für Admins
  „Veröffentlichen" bzw. „Zurückziehen", dazu ein Abzeichen „Öffentlich" in Liste und Ansicht.
- **Code-Umbau:** Die Komponente arbeitet heute mit `Record<SitePage, PageState>`. Sie bekommt eine
  Liste `PageTab = { key, title, url, kind: "fixed" | "custom", … }`, damit feste und eigene Seiten durch
  denselben Code laufen. Die Server Actions in `admin-landing.ts` nehmen statt `SitePage` einen
  `PageRef` (`{fixed: SitePage} | {customId: string}`).

---

## 6. MCP

### 6.1 Bestehende Tools

Der Parameter `page` wird von `z.enum(SITE_PAGES)` zu einem String: `landing|imprint|privacy` **oder**
der Slug einer eigenen Seite. Alle drei Namen sind reserviert (4.1), das ist also eindeutig.
`get_page`, `validate_page`, `update_page`, `list_page_versions`, `restore_page_version` und
`set_page_enabled` funktionieren damit unverändert für alle Seiten. Ein unbekannter Slug liefert
„page not found".

### 6.2 Neue Tools

| Tool | Scope | Zweck |
|---|---|---|
| `list_pages` | `landing:read` | Alle Seiten: feste und eigene, mit Slug, Titel, Adresse, Schaltern und aktueller Version. Sagt außerdem, wie viele eigene Seiten noch frei sind. |
| `create_page` | `landing:write` | `slug`, `title`, `kind` (`blank|features|blog|changelog`), `showInNav?`, `definition?`. Hält die Grenze ein und legt die Seite **ausgeschaltet** an. Bei `blog`/`changelog` entsteht die Sammlung mit, wie in der UI. |
| `update_page_settings` | `landing:write` | Titel, Slug, `showInNav` und `sortOrder` mit Merge-Semantik (wie `set_model_capabilities`). |
| `set_entry_published` | `knowledge:write` | Eintrag veröffentlichen oder zurückziehen. Nur für Einträge in Sammlungen mit `public_on_site`, und nur, wenn der Besitzer des Schlüssels Admin ist (das gilt für jeden Schlüssel ohnehin). |

`list_entries`/`get_entry` liefern zusätzlich `publishedAt`, `slug` und die öffentliche Adresse.

Die Resource `aiup://docs/pages` bekommt einen Abschnitt „Custom pages" (Grenze, reservierte Namen,
Navigation, Löschen nur in der UI) und einen Abschnitt zur Sektion `posts`.
`aiup://docs/collections` erklärt `public_on_site` und `set_entry_published`.

---

## 7. Blog und Changelog: Sektion `posts`

### 7.1 Sektion

```json
{ "type": "posts", "title": "optional", "intro": "optional",
  "collectionId": "uuid", "layout": "cards | list | timeline", "limit": 10 }
```

- `cards` (Blog): Titel, Datum, Anreißer und Titelbild, falls die Vorlage eines hat. Ein Klick führt
  auf die Beitragsseite.
- `list`: kompakt, Titel und Datum.
- `timeline` (Changelog): Datum links, voller Inhalt rechts. Eine Beitragsseite gibt es trotzdem, damit
  einzelne Versionen verlinkbar sind.
- Sortiert nach `published_at`, neueste zuerst. Mehr als `limit` Beiträge: Knopf „Ältere Beiträge"
  (`?seite=2`, ohne JavaScript).
- `validate_page`/`landingWarnings()` melden eine Sammlung, die fehlt, nicht zur Community gehört oder
  nicht `public_on_site` ist. Die Sektion bleibt dann öffentlich unsichtbar, im Editor erscheint ein
  Hinweis (wie `WidgetNote` bei den Event-Sektionen).

### 7.2 Freigabe: zwei Schlüssel

Damit nie versehentlich etwas Internes öffentlich wird, braucht es **beides**:

1. **Die Sammlung** ist `public_on_site` (nur Admins, nur mit `canManagePublicPages`).
2. **Der Eintrag** hat `published_at` (nur Admins, per UI oder `set_entry_published`).

Was Mitglieder in eine öffentliche Sammlung schreiben, bleibt also intern, bis ein Admin es freigibt.
Danach sind Änderungen sofort sichtbar. Wer das nicht will, beschränkt die Schreibrechte der Sammlung
auf Admins.

Agenten-Schreibvorgänge (`origin: {kind:"agent"}`) dürfen **nicht** veröffentlichen. Das Agenten-Werkzeug
bekommt kein Veröffentlichen, damit ein Autopilot-Thread nichts öffentlich machen kann.

### 7.3 Beitragsseite

- **Adresse:** `/<seite>/<beitrag-slug>`, z. B. `/blog/neue-whiteboards`. Die Route sucht die `posts`-Sektion
  der Seite, dann den Eintrag mit dem Slug in deren Sammlung. Er muss veröffentlicht sein, sonst 404.
- **Darstellung:** über den vorhandenen Markdown-Renderer aus `bodyMarkdown`. Whiteboard und Kanban
  erscheinen nur in ihrer Markdown-Form, eine interaktive Board-Ansicht gehört nicht auf eine öffentliche
  Seite. Kopf und Fuß kommen von der Seite (Navigation, Footer), dazu Titel, Datum, „Zurück zur
  Übersicht".
- **Metadaten:** `generateMetadata` mit Titel und Anreißer. Hat der Beitrag ein Titelbild, wird es zum
  OpenGraph-Bild.

### 7.4 Bilder (sicherheitsrelevant)

Bilder in Einträgen haben einen nicht öffentlichen `purpose`. `/api/files/[id]` liefert sie ohne
Mitgliedschaft nur aus, wenn `isPublishedEntryMedia(mediaId)` gilt: Die **aktuelle** Version eines
veröffentlichten Eintrags in einer `public_on_site`-Sammlung referenziert das Bild.

- Diese Antworten bekommen `Cache-Control: public, max-age=300`, **nicht** `immutable`. Sonst bliebe ein
  Bild nach dem Zurückziehen über Caches abrufbar.
- Eine zentrale Tabelle mit Medien-Verweisen gibt es heute nicht. Deshalb neu:
  - Eine pure Hilfsfunktion `collectStructureMediaIds(answers)` in `src/lib/structures/` sammelt die
    `mediaId`s aus den Antworten, inklusive Whiteboard-Bildern.
  - Eine kleine Tabelle `public_entry_media (content_id, media_id)` hält das Ergebnis. Sie wird beim
    Veröffentlichen, Zurückziehen und bei jeder neuen Version eines veröffentlichten Eintrags neu
    geschrieben: im gemeinsamen Schreibpfad `addContentVersion`, in derselben Transaktion.
  - Schaltet jemand `public_on_site` an der Sammlung ab, werden die Zeilen gelöscht.

  Die Prüfung im Datei-Endpunkt ist dann ein Index-Treffer. Eine Textsuche im Markdown wäre zu
  unzuverlässig.
- Test: Ein zurückgezogener Eintrag und eine nicht mehr öffentliche Sammlung liefern dem Bild ohne
  Sitzung je 404.

### 7.5 Feed

`/<seite>/feed.xml` (RSS 2.0) für jede Seite mit `posts`-Sektion: die letzten 20 veröffentlichten
Beiträge mit Titel, Adresse, Datum und Anreißer. Die Route liegt unter `[page]/feed.xml`, also wird
`feed.xml` als Beitrags-Slug gesperrt.

---

## 8. Tests

- **Reservierte Namen:** `RESERVED_PAGE_SLUGS` deckt jedes oberste Verzeichnis unter `src/app` ab (4.1).
- **Grenze:** Zwei gleichzeitige `createSitePage` bei vier vorhandenen Seiten ergeben genau eine neue.
- **Slugs:** eindeutig je Community, reservierte Namen abgelehnt, Kollision bei Beitrags-Slugs mit
  Suffix.
- **Proxy:** Eigene Seite und Beitrag ohne Cookie durchgelassen; `/home` und `/admin/pages` ohne Cookie
  weiter nach `/login`.
- **Freigabe:** Nicht veröffentlichter Eintrag → 404; Sammlung ohne `public_on_site` → Sektion leer, 404
  auf der Beitragsseite.
- **Bilder:** wie 7.4.
- **Mandanten:** Eine Seite oder ein Beitrag einer anderen Community ist unter dem eigenen Host nie
  erreichbar (`getPublicCommunity()` entscheidet).

Vor Abschluss: `npm run typecheck && npm run lint && npm run build && npm run worker:build`.

---

## 9. Umsetzung in einem Zug

Reihenfolge innerhalb des einen Schritts. Jede Stufe baut auf der vorigen auf:

| Stufe | Inhalt |
|---|---|
| **A** | Migration (`site_pages`, `site_page_id`, Indizes, `public_on_site`, `published_at`, `contents.slug`, `public_entry_media`), `src/lib/site-pages.ts` (Slug-Regeln, reservierte Namen), Domänenfunktionen mit Grenze, Proxy, Routen `[page]` und `[page]/[post]`, Navigation im `LandingShell` |
| **B** | Admin-UI (Tabs, Dialog mit Arten, Einstellungen, Löschen), Schalter an Sammlungen, Veröffentlichen am Eintrag, MCP (`page` als Slug, `list_pages`, `create_page`, `update_page_settings`, `set_entry_published`), Doku-Resources |
| **C** | Sektion `posts` (drei Layouts, Blättern), Beitragsseite, Bilderfreigabe, Feed, Starter für Blog und Changelog mit Sammlung und Vorlage |

Danach: `CLAUDE.md` um einen Absatz „Eigene Webseiten" ergänzen und den README-Abschnitt „Webseiten"
aktualisieren.

---

## 10. Umsetzung: Abweichungen vom Plan

- **Bilderfreigabe:** Statt einer Tabelle nur für veröffentlichte Einträge hält `content_media` die Uploads
  der aktuellen Version **jedes** Eintrags. `refreshContentMedia()` schreibt sie in `createContent` und
  `addContentVersion` in derselben Transaktion neu und beim Veröffentlichen einmal nach (für Einträge
  von vor der Migration). Quelle sind die `/api/files/<id>`-Verweise im `bodyMarkdown` plus `mediaId`,
  also genau das, was eine Beitragsseite zeigen kann (`collectEntryMediaIds` in `src/lib/posts.ts`).
  `isPublishedEntryMedia()` verlangt zusätzlich `purpose: "content"` und dieselbe Community: Ein
  Nachrichten-Anhang oder eine fremde Datei wird nie öffentlich, auch wenn jemand ihre Adresse in einen
  Beitrag schreibt.
- **Blättern:** `?page=2` statt `?seite=2`.
- **MCP:** zusätzlich `set_collection_public` (Scope `landing:write`, nur mit `canManagePublicPages`), damit
  ein Blog ohne UI eingerichtet werden kann.
- **Beitragsdarstellung:** `renderStructureMarkdown(…, { post: true, skipKeys })` lässt Vorlagen-Intro,
  Info-Texte und die Überschriften über Einzelwerten weg; das erste Bild-Element wird zum Titelbild.
- **Abzeichen „Öffentlich":** in der Admin-Liste der Sammlungen und in der Eintragsansicht (mit Link zur
  öffentlichen Adresse). Die Eintragslisten der Sammlungen zeigen es noch nicht.
- **Sammlungen beim Anlegen:** Blog mit Layout „blog", Changelog mit Layout „list", beide nach
  „neueste zuerst" sortiert.
- **Prüfung der Grenze und der Freigabe:** gegen die lokale Datenbank per Skript (drei gleichzeitige
  Anlagen bei vier Seiten → genau eine neue; Bilder öffentlich nur solange veröffentlicht). Automatisierte
  Tests decken die puren Teile ab (`site-pages.test.ts`, `posts.test.ts`), DB-Tests gibt es im Projekt
  bisher nicht.
