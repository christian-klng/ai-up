import type { WhiteboardItem } from "@/lib/structures/types";

// Wire format of a live board session (docs/whiteboard.md 5) – whiteboards and
// kanban boards share it, `I` is the item type. Shared by the event stream, the
// ops endpoint and the clients.

/** An upsert always carries the whole item (last writer wins per item). */
export type LiveOp<I> = { op: "upsert"; item: I } | { op: "delete"; id: string };

export type WhiteboardParticipant = { userId: string; name: string; avatarMediaId: string | null; selection: string[] };

export type WhiteboardEvent<I = WhiteboardItem> =
  /** first frame of every stream (and after a reconnect) */
  | { t: "snapshot"; seq: number; items: I[]; participants: WhiteboardParticipant[]; locks: Record<string, string>; token: string; me: string }
  | { t: "ops"; seq: number; by: string; clientId: string; ops: LiveOp<I>[] }
  /** the board was replaced from outside the session (restore, MCP, agent) */
  | { t: "reset"; seq: number; items: I[] }
  | { t: "presence"; participants: WhiteboardParticipant[] }
  | { t: "select"; userId: string; ids: string[] }
  | { t: "lock"; userId: string; id: string; on: boolean }
  | { t: "flushed"; versionNo: number }
  | { t: "token"; token: string }
  /** membership ended or the entry is gone – the client closes the board */
  | { t: "revoked" };

export type WhiteboardPostBody<I = WhiteboardItem> = {
  token: string;
  clientId: string;
  ops?: LiveOp<I>[];
  select?: string[];
  /** item id being typed in, null = done */
  editing?: string | null;
};

const PEER_COLORS = ["#e11d48", "#2563eb", "#16a34a", "#9333ea", "#ea580c", "#0891b2", "#c026d3", "#65a30d"];

/** Stable colour per user, the same on every screen. */
export function peerColor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) | 0;
  return PEER_COLORS[Math.abs(h) % PEER_COLORS.length];
}
