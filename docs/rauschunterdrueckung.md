# Rauschunterdrückung im Call (DeepFilterNet3)

Stand: 15.10.2026, umgesetzt; Hör- und Lasttest (Abschnitt 5) stehen noch aus.

Anlass: Im ersten längeren Call hat ein Teilnehmer nebenher getippt, und alle haben jede Taste gehört.
Ziel sind drei Stufen, die jede Person für ihr eigenes Mikrofon wählt.

## 1. Ausgangslage

- Der Raum entsteht in `src/components/meetings/call-provider.tsx` (`new Room({ adaptiveStream, dynacast })`),
  das Mikrofon kommt über `setMicrophoneEnabled(true)` mit den Standardwerten von livekit-client 2.22:
  `echoCancellation`, `noiseSuppression`, `autoGainControl` und `voiceIsolation` sind an. Das ist die
  WebRTC-Unterdrückung des Browsers – gut gegen gleichmäßiges Rauschen, schwach gegen kurze, harte
  Geräusche wie Tastaturklicks.
- **Krisp** (`@livekit/krisp-noise-filter`) scheidet aus: nur mit LiveKit Cloud, wir betreiben LiveKit selbst.
- Gefiltert wird immer **beim Sprechenden**. Wer tippt, muss die Unterdrückung selbst an haben
  (Voreinstellung: Abschnitt 4.4).

## 2. Die Bibliothek

`deepfilternet3-noise-filter` (npm, v1.3.0, MIT/Apache-2.0, Repo `mezonai/mezon-noise-suppression`,
Peer-Dependency `livekit-client ^2`). Geprüft am Paket selbst, nicht nur an der README:

- `DeepFilterNoiseFilter(options)` liefert einen LiveKit-`TrackProcessor` für
  `LocalAudioTrack.setProcessor()`. Intern: eigener `AudioContext` (48 kHz) → `AudioWorklet` mit
  DeepFilterNet3 (WASM) → `MediaStreamDestination`; LiveKit veröffentlicht den gefilterten Track.
  Gerätewechsel laufen über `restart()`, das den Graphen neu verbindet.
- `setSuppressionLevel(0–100)` ändert die Stärke **ohne Neustart**. Der Wert ist DeepFilterNets
  **Dämpfungsgrenze in dB**: 0 = keine Unterdrückung, 100 = unbegrenzt. Damit ergeben sich die Stufen
  von selbst.
- `setEnabled(false)` schaltet auf Durchreichen, das Modell bleibt geladen.
- Das Worklet-Skript ist im Paket eingebettet (Blob-URL); WASM und Modell lädt es per `fetch` nach,
  standardmäßig von `https://cdn.mezon.ai/…/deepfilternet3/v3/…`. Umstellbar über
  `assetConfig.cdnUrl` – erwartet darunter `v3/pkg/df_bg.wasm` und `v3/models/DeepFilterNet3_onnx.tar.gz`.
- **Größe:** WASM 16,4 MB + Modell 8,0 MB = **rund 24 MB** beim ersten Laden (unkomprimiert gemessen).
- Schwächen: keine Erkennung von CPU-Überlast (das Worklet gibt dann Stille-Blöcke aus, hörbar als
  Aussetzer), Init-Fehler im Worklet werden nur geloggt und fallen auf Durchreichen zurück,
  `destroy()` wirft das geladene Modell weg.
- Sicherheit: Die WASM-Datei ist ein fremdes Binary. Sie läuft im AudioWorklet (kein DOM, kein `fetch`)
  und bekommt als Importe nur `getRandomValues` und eine Fehlerfunktion – sie kann also nur rechnen.
  Trotzdem: per SHA-256 festnageln, Paket exakt pinnen (ohne `^`). Den eigenen WASM-Build aus dem
  DeepFilterNet-Repo können wir nicht einfach einsetzen, weil der eingebettete wasm-bindgen-Kleber an
  die Import-Namen genau dieses Builds gebunden ist.

## 3. Stufen

| Stufe | Technik | `setSuppressionLevel` | Gedacht für |
|---|---|---|---|
| **Standard** | nur Browser (heute) | – (`stopProcessor()`) | schwache Geräte, Ausweichstufe |
| **Mittel** | DeepFilterNet3 | ca. 25 dB (im Test einstellen) | Alltag, Tippen, Lüfter |
| **Stark** | DeepFilterNet3 | 100 (unbegrenzt) | Großraum, Café, lautes Tippen |

Zwischen Mittel und Stark wird nur der Wert umgestellt; nach Standard wird der Processor entfernt, damit
schwache Geräte wirklich entlastet sind. Die dB-Werte stehen an **einer** Stelle (`src/lib/noise-filter.ts`).

Die Browser-Unterdrückung bleibt vorerst auch bei Mittel/Stark an (kein `restartTrack`, also kein
Knacken beim Umschalten). Im Test vergleichen, ob `noiseSuppression: false` bei aktivem DeepFilterNet
natürlicher klingt – falls ja, beim Umschalten `restartTrack({ noiseSuppression: false, voiceIsolation: false })`.
Echo-Unterdrückung und automatische Pegelanpassung bleiben in jedem Fall an.

## 4. Umsetzung

### 4.1 Assets selbst ausliefern

Nicht ins Git (24 MB Binärdateien), nicht vom fremden CDN zur Laufzeit:

- `scripts/fetch-noise-filter-assets.mjs`: lädt beide Dateien einmal von der Mezon-Adresse, prüft
  **SHA-256** gegen fest eingetragene Werte, legt sie unter `public/vendor/deepfilternet3/1.3.0/v3/…` ab.
  Überspringt, wenn die Dateien mit richtigem Hash schon da sind. Bricht bei falschem Hash ab, ebenso wenn
  die installierte Paketversion nicht zur Version im Skript passt. Notausgang: `SKIP_NOISE_FILTER_ASSETS=1`
  (der Build läuft dann, der Filter meldet im Call „läuft nicht").
- In `package.json` als `prebuild` und `predev` – damit greift es lokal und im Docker-Build
  (`npm run build` im Build-Stage) ohne Dockerfile-Änderung. `public/vendor/` in `.gitignore`.
- `next.config.ts` → `headers()`: `/vendor/:path*` mit `Cache-Control: public, max-age=31536000, immutable`
  (der Pfad trägt die Version). `application/wasm` gilt als komprimierbar, Next liefert es gzip-komprimiert
  aus (16,4 → 4,3 MB); das Modell ist schon ein `.tar.gz`.
- `src/proxy.ts`: `/vendor` aus dem Cookie-Gate nehmen (Matcher-Ausnahme), damit die Dateien wie
  andere statische Assets laufen.
- Paketversion-Update = Script-Hashes + Pfad anpassen, sonst lädt der Browser altes WASM zum neuen Kleber.
- Später optional: Spiegel im Hetzner-Bucket, falls `cdn.mezon.ai` beim Build ausfällt.

### 4.2 Logik

- `src/lib/noise-filter.ts` (pur): `NOISE_FILTER_LEVELS = ["standard", "medium", "strong"] as const`,
  `suppressionDb(level)`, `parseNoiseFilterLevel(raw)`, Storage-Key, Asset-Basis-URL.
- `src/components/meetings/noise-filter.ts` (Client): `applyNoiseFilter(track, level)`:
  - `standard` → `track.stopProcessor()`.
  - sonst: läuft schon unser Processor → nur `setSuppressionLevel`; sonst
    `const { DeepFilterNoiseFilter } = await import("deepfilternet3-noise-filter")` (dynamisch, bleibt
    aus dem Haupt-Bundle), `isSupported()` prüfen, `await track.setProcessor(DeepFilterNoiseFilter({ noiseReductionLevel, assetConfig: { cdnUrl } }))`.
  - Fehler (Fetch, Kompilieren, Worklet) → auf `standard` zurückfallen, einmal Toast „Rauschfilter
    nicht verfügbar", Auswahl nicht überschreiben (beim nächsten Call neuer Versuch).
  - Parallele Aufrufe serialisieren (schnelles Umklicken während des ersten Ladens).
- `call-provider.tsx`:
  - Kontext erweitert um `noiseFilter`, `noiseFilterStatus` (`idle|loading|active|failed`) und `setNoiseFilter`.
  - Wert pro **Gerät** in `localStorage` (`aiup_noise_filter`, mit try/catch) – die Rechenleistung hängt am
    Gerät, nicht am Konto, deshalb keine DB-Spalte.
  - Anwenden bei `RoomEvent.LocalTrackPublished` für das Mikrofon – deckt den ersten Publish und ein erst
    später erlaubtes Mikrofon ab; danach bei jeder Änderung der Auswahl. Der Call startet sofort; beim allerersten Mal läuft
    er ein paar Sekunden ungefiltert, bis die 24 MB geladen sind, danach aus dem Browser-Cache.
- Aufzeichnung (Egress) und Live-Zuhörer bekommen automatisch den gefilterten Ton – für Transkript und
  VAD ein Gewinn.

### 4.3 Oberfläche

- `video-conference.tsx`: in der `ControlBar` `settings: true`; bei `widgetState.showSettings` erscheint
  `CallSettings` (`call-settings.tsx`) als kleines Panel über der Leiste. Nicht das `.lk-settings-menu-modal`
  des Prefabs – das ist mindestens halbbildschirmgroß, zu viel für eine Einstellung. Kein Nachbau der
  ControlBar nötig.
- `CallSettings`: Abschnitt „Rauschunterdrückung" mit drei Optionen (Radio) und je einem Satz Erklärung,
  Ladehinweis beim ersten Aktivieren, Hinweis „wirkt auf dein Mikrofon – die anderen hören den Unterschied".
  Tailwind-Klassen mit LiveKits Theme-Variablen, keine `lk-button`-Klasse (LiveKits Styles sind ungelayert
  und schlügen jede Utility).
- Mini-Player: keine Einstellung, nur über die Call-Seite.
- Texte in `messages/de.json` **und** `messages/en.json` unter `meetings.call.noiseFilter.*`.

### 4.4 Voreinstellung

**Standard für alle** (Entscheidung 15.10.2026). Mittel und Stark schaltet jede Person selbst ein; die Wahl
bleibt auf dem Gerät gespeichert. Damit lädt niemand ungefragt 24 MB, und schwache Geräte laufen wie bisher.

## 5. Testplan

1. Lokal mit `docker compose -f docker-compose.dev.yml --profile media up -d`, zwei Identitäten
   (`localhost` + `127.0.0.1`), eine tippt beim Sprechen. Stufen nacheinander, Aufnahme zum Vergleichen.
2. dB-Wert für Mittel einstellen (Kandidaten 15 / 25 / 35).
3. Last: Chrome-Taskmanager bzw. Activity Monitor auf einem **älteren** Laptop, 30 Minuten, auf
   Aussetzer hören. Ergebnis hier eintragen.
4. Browser-Matrix: Chrome, Firefox, Safari (macOS + iOS) – besonders, ob Safari das kompilierte
   `WebAssembly.Module` an das Worklet übergeben kann.
5. Gerätewechsel im Call, Stummschalten/Entstummen, Wechsel zwischen Call-Seite und Mini-Player,
   Neuverbindung.
6. Aufzeichnung und Live-Transkript mit Stufe Stark gegenprüfen.
7. `npm run typecheck && npm run lint && npm run build && npm run worker:build`; prüfen, dass der
   Docker-Build die Assets lädt und `/vendor/…` mit Cache-Header ausliefert.

## 6. Offene Entscheidungen

- Browser-Unterdrückung bei aktivem DeepFilterNet aus oder an? (entscheidet der Hörtest)
- Fällt der Lasttest auf schwachen Geräten durch: automatische Rückstufung (z. B. über
  `AudioContext`-Unterläufe) als zweite Ausbaustufe.
