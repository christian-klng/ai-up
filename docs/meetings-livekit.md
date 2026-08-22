# Meetings: LiveKit-Media-Server auf Coolify (Phase 4a)

Der Media-Server läuft als **eigene Coolify-Ressource** (Docker Compose) neben der App: eigene Subdomain,
direkt am Host geöffnete UDP-Ports, unabhängig skalierbar. Vorlage: [`deploy/livekit/`](../deploy/livekit/).

## 1. Voraussetzungen

- Host mit öffentlicher IPv4 (`NODE_IP`), 4 vCPU / 8 GB empfohlen (+ ≈ 4 vCPU / 4 GB während Aufzeichnungen).
- DNS: `meet.<domain>` → Host-IP (A-Record). Der App-Host darf derselbe sein.
- Firewall/Security-Group des Hosts: **7881/tcp**, **3478/udp**, **50000–50200/udp** offen (zusätzlich zu 80/443).
- Ein Host-Verzeichnis für Aufzeichnungen, z. B. `/data/aiup/recordings` (wird von Egress beschrieben und vom App-Worker gelesen).

## 2. Schlüssel erzeugen

```bash
node deploy/livekit/gen-keys.mjs
```

Ausgabe `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` notieren – dieselben Werte kommen später in die App (Verwaltung → Integrationen).

## 3. Coolify-Ressource anlegen

1. **Projekt → + New Resource → Docker Compose** (Quelle: dieses Git-Repo, *Base Directory* `deploy/livekit`, Compose-Datei `docker-compose.yml`) – oder den Inhalt von `deploy/livekit/docker-compose.yml` als „Docker Compose Empty“ einfügen.
2. **Environment Variables** setzen:

   | Variable | Wert |
   |---|---|
   | `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | aus Schritt 2 |
   | `LIVEKIT_DOMAIN` | `meet.<domain>` |
   | `APP_WEBHOOK_URL` | `https://<app-domain>/api/livekit/webhook` |
   | `NODE_IP` | öffentliche IPv4 des Hosts |
   | `RECORDINGS_PATH` | `/data/aiup/recordings` |

3. **Konfigurationsdateien**: `livekit.yaml` und `egress.yaml` liegen im Repo-Ordner und werden per Bind-Mount eingebunden. In `livekit.yaml` die Platzhalter ersetzen (Coolify kann das nicht selbst): `LIVEKIT_DOMAIN`, `LIVEKIT_API_KEY`, `APP_WEBHOOK_URL` (und `node_ip` einkommentieren, falls die IP-Erkennung fehlschlägt). Alternativ in Coolify unter *Storages* eine eigene Datei `/etc/livekit.yaml` anlegen und den Inhalt hineinkopieren.
4. **Domain**: am Service `livekit` die Domain `https://meet.<domain>` auf **Port 7880** legen (Coolify/Traefik terminiert TLS, WebSocket läuft durch). Für `egress` und `redis` keine Domain.
5. **Ports prüfen**: Coolify übernimmt die `ports:`-Einträge (7881/tcp, 3478/udp, 50000–50200/udp) 1:1 auf den Host. Sollte die Compose-Validierung den UDP-Bereich ablehnen, den Bereich verkleinern (z. B. `50000-50050`) – 50 Ports reichen für ~25 gleichzeitige Teilnehmende, 200 für ~100.
6. **Deploy** und Logs prüfen: `livekit` meldet `starting LiveKit server` mit `nodeIP`, `egress` meldet `egress service started`.

## 4. Verifizieren (von deinem Rechner aus)

```bash
# Signaling erreichbar (muss "OK" liefern)
curl -s https://meet.<domain>/

# End-to-End aus App-Sicht: Raum, Token, Audio-only-Egress auf das Volume
LIVEKIT_URL=https://meet.<domain> LIVEKIT_API_KEY=… LIVEKIT_API_SECRET=… RECORDINGS_DIR=/irrelevant \
  npx tsx deploy/livekit/spike.ts            # Räume + Token
# mit Aufzeichnung (braucht einen sprechenden Teilnehmer – siehe Lasttest unten mit --audio-publishers 1):
SPIKE_ROOM=spike-egress SPIKE_WAIT=15 LIVEKIT_URL=https://meet.<domain> LIVEKIT_API_KEY=… LIVEKIT_API_SECRET=… \
  npx tsx deploy/livekit/spike.ts --egress   # → Datei unter RECORDINGS_PATH/spike-egress/ auf dem Host

# Lasttest mit 30 Video-Teilnehmenden (läuft am besten von einer zweiten Maschine/VPS, nicht vom Laptop):
docker run --rm livekit/livekit-cli load-test --url wss://meet.<domain> --api-key … --api-secret … \
  --room loadtest --video-publishers 30 --subscribers 30 --duration 2m
```

Im Lasttest-Report interessieren *Latency*, *Dropped Packets* und die CPU/Netzlast des Hosts (Coolify → Metrics oder `htop`/`iftop`).
Erwartung für 30 × 720p: ≈ 75–100 Mbit/s Upload, CPU des `livekit`-Containers deutlich unter einem Kern pro 10 Teilnehmende.

## 5. Was die App braucht (4b–4d umgesetzt, 4e folgt)

- Verwaltung → Integrationen: Server-URL (`wss://meet.<domain>`), API-Key/-Secret (verschlüsselt gespeichert), Aufzeichnungspfad, „Calls aktiviert“ – erst dann sind Audio-/Video-Meetings wählbar.
- App-Compose: `worker` mountet `RECORDINGS_PATH` read-only nach `/data/recordings`, um fertige Aufzeichnungen in `media_files` zu übernehmen.
- Webhook-Endpunkt `/api/livekit/webhook` (signiert mit API-Key/-Secret): `room_started`, `participant_joined/left`, `room_finished` setzen Status/Teilnehmer (Live-Punkt); `egress_*` für Aufzeichnungen (4e). In `livekit.yaml` muss `webhook.urls` auf `https://<app-domain>/api/livekit/webhook` zeigen und `webhook.api_key` dem App-Key entsprechen.

## 6. Lokal entwickeln

```bash
docker compose -f docker-compose.dev.yml --profile media up -d   # livekit :7880/:7881, egress, redis
npx tsx deploy/livekit/spike.ts --egress                           # Dev-Keys: devkey / devsecret…
```

Lokale Aufzeichnungen landen in `./data/recordings/`.

## 7. TURN über TLS (optional, später)

Wenn Teilnehmende aus restriktiven Firmennetzen nicht verbinden (UDP und 7881/tcp blockiert), TURN/TLS auf 443 oder 5349 aktivieren:
Zertifikat für `meet.<domain>` in den Container mounten und in `livekit.yaml` `turn.tls_port` + `cert_file`/`key_file` setzen
(oder `external_tls: true` hinter einem TCP-Loadbalancer). Traefik kann TURN-TLS nicht als HTTP-Route proxyen.
