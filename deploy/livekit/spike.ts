/**
 * Phase 4a spike: verifies a LiveKit deployment end-to-end from the app's point of view.
 *   npx tsx deploy/livekit/spike.ts [--egress] [--load N]
 * Env: LIVEKIT_URL (http(s)://host:7880 or wss://host), LIVEKIT_API_KEY, LIVEKIT_API_SECRET, RECORDINGS_DIR (local path of /out),
 *      SPIKE_ROOM (fixed room name, e.g. to pair with a load-test publisher), SPIKE_WAIT (seconds to record, default 8)
 * Steps: 1) create room + access token  2) optional: audio-only RoomComposite egress to /out  3) optional: load test hint
 */
import { AccessToken, EgressClient, EncodedFileOutput, EncodedFileType, RoomServiceClient } from "livekit-server-sdk";
import { existsSync, readdirSync, statSync } from "node:fs";

const url = process.env.LIVEKIT_URL ?? "http://localhost:7880";
const apiKey = process.env.LIVEKIT_API_KEY ?? "devkey";
const apiSecret = process.env.LIVEKIT_API_SECRET ?? "devsecretdevsecretdevsecretdevsecret";
const recordingsDir = process.env.RECORDINGS_DIR ?? "./data/recordings";
const args = process.argv.slice(2);
const doEgress = args.includes("--egress");
const waitSec = Number(process.env.SPIKE_WAIT ?? (args.includes("--wait") ? args[args.indexOf("--wait") + 1] : 8));

async function main() {
  const rooms = new RoomServiceClient(url, apiKey, apiSecret);
  const roomName = process.env.SPIKE_ROOM ?? `spike-${Date.now().toString(36)}`;
  const room = await rooms.createRoom({ name: roomName, emptyTimeout: 300, maxParticipants: 40 });
  console.log("✓ room created:", room.name, "sid:", room.sid);
  const list = await rooms.listRooms();
  console.log("✓ listRooms:", list.map((r) => r.name).join(", "));

  const at = new AccessToken(apiKey, apiSecret, { identity: "spike-user", name: "Spike User", ttl: "10m" });
  at.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });
  const jwt = await at.toJwt();
  console.log("✓ access token:", jwt.slice(0, 24) + "…", `(${jwt.length} chars)`);

  if (doEgress) {
    const egress = new EgressClient(url, apiKey, apiSecret);
    const filepath = `/out/${roomName}/audio-{time}.ogg`;
    const output = new EncodedFileOutput({ fileType: EncodedFileType.OGG, filepath });
    console.log("… starting audio-only room composite egress →", filepath);
    const info = await egress.startRoomCompositeEgress(roomName, { file: output }, { audioOnly: true });
    console.log("✓ egress started:", info.egressId, "status:", info.status);
    // Needs at least one publishing participant (e.g. `lk load-test --audio-publishers 1 --room <room>`), otherwise egress aborts.
    await new Promise((r) => setTimeout(r, waitSec * 1000));
    const stopped = await egress.stopEgress(info.egressId);
    console.log("✓ egress stopped:", stopped.status);
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const [cur] = await egress.listEgress({ egressId: info.egressId });
      const st = cur?.status?.toString();
      if (cur && cur.fileResults?.length) {
        console.log("✓ egress finished, status", st, "files:", cur.fileResults.map((f) => `${f.filename} (${f.size} bytes, ${Number(f.duration) / 1e9}s)`).join(", "));
        break;
      }
      if (st && /COMPLETE|FAILED|ABORTED/.test(st)) {
        console.log("egress final status:", st, cur.error ?? "");
        break;
      }
    }
    const dir = `${recordingsDir}/${roomName}`;
    if (existsSync(dir)) for (const f of readdirSync(dir)) console.log("✓ local file:", `${dir}/${f}`, statSync(`${dir}/${f}`).size, "bytes");
    else console.log("! local dir not found:", dir, "(check RECORDINGS_DIR / volume mount)");
  }
  await rooms.deleteRoom(roomName);
  console.log("✓ room deleted");
  console.log("\nLoad test (30 publishers + 30 subscribers, 2 min):\n  docker run --rm --network host livekit/livekit-cli lk load-test --url", url.replace(/^http/, "ws"), "--api-key", apiKey, "--api-secret", "***", "--room loadtest --video-publishers 30 --subscribers 30 --duration 2m");
}
main().catch((e) => {
  console.error("✗ spike failed:", e);
  process.exit(1);
});
