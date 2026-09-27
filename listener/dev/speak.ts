/**
 * Test speaker: joins a room and plays a 16-bit PCM WAV file as microphone track, then leaves.
 *   npx tsx dev/speak.ts <room> <identity> <file.wav> [delaySeconds]
 * Uses LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET (defaults: local dev server).
 */
import { readFileSync } from "node:fs";
import { AccessToken } from "livekit-server-sdk";
import { AudioFrame, AudioSource, LocalAudioTrack, Room, TrackPublishOptions, TrackSource } from "@livekit/rtc-node";

const [room, identity, file, delay = "0"] = process.argv.slice(2);
if (!room || !identity || !file) throw new Error("usage: speak.ts <room> <identity> <file.wav> [delaySeconds]");
const url = process.env.LIVEKIT_URL ?? "ws://localhost:7880";
const key = process.env.LIVEKIT_API_KEY ?? "devkey";
const secret = process.env.LIVEKIT_API_SECRET ?? "devsecretdevsecretdevsecretdevsecret";

function readWav(path: string) {
  const buf = readFileSync(path);
  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  while (offset < buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === "fmt ") {
      channels = buf.readUInt16LE(offset + 10);
      sampleRate = buf.readUInt32LE(offset + 12);
    } else if (id === "data") {
      const pcm = new Int16Array(buf.buffer.slice(buf.byteOffset + offset + 8, buf.byteOffset + offset + 8 + size));
      return { sampleRate, channels, pcm };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error("no data chunk");
}

const { sampleRate, channels, pcm } = readWav(file);
const at = new AccessToken(key, secret, { identity, name: identity });
at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: false });
const r = new Room();
await r.connect(url, await at.toJwt(), { autoSubscribe: false, dynacast: false });
const source = new AudioSource(sampleRate, channels);
const track = LocalAudioTrack.createAudioTrack("mic", source);
const opts = new TrackPublishOptions();
opts.source = TrackSource.SOURCE_MICROPHONE;
await r.localParticipant!.publishTrack(track, opts);
console.log(`${identity}: published, waiting ${delay}s`);
await new Promise((res) => setTimeout(res, Number(delay) * 1000));
const perFrame = (sampleRate / 100) * channels; // 10 ms
for (let i = 0; i < pcm.length; i += perFrame) {
  const chunk = new Int16Array(perFrame);
  chunk.set(pcm.subarray(i, i + perFrame));
  await source.captureFrame(new AudioFrame(chunk, sampleRate, channels, perFrame / channels));
}
await source.waitForPlayout();
console.log(`${identity}: done speaking`);
await new Promise((res) => setTimeout(res, 3000));
await r.disconnect();
process.exit(0);
