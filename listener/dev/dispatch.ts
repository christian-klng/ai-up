/** Dispatches the listener into a room: npx tsx dev/dispatch.ts <room> <meetingId> */
import { AgentDispatchClient } from "livekit-server-sdk";
import { LISTENER_AGENT_NAME } from "../../src/lib/live-listener";

const [room, meetingId] = process.argv.slice(2);
if (!room || !meetingId) throw new Error("usage: dispatch.ts <room> <meetingId>");
const url = (process.env.LIVEKIT_URL ?? "ws://localhost:7880").replace(/^ws/, "http");
const client = new AgentDispatchClient(url, process.env.LIVEKIT_API_KEY ?? "devkey", process.env.LIVEKIT_API_SECRET ?? "devsecretdevsecretdevsecretdevsecret");
const d = await client.createDispatch(room, LISTENER_AGENT_NAME, { metadata: JSON.stringify({ meetingId }) });
console.log("dispatched", d.id, "to", d.room);
