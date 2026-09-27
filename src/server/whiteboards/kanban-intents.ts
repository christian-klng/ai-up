import { addContentVersion, getContent } from "@/server/domain/knowledge";
import { buildStructuredVersionInput } from "@/server/domain/structured-entries";
import type { EventOrigin } from "@/server/events/bus";
import { logger } from "@/server/logger";
import { scheduleWhiteboardFlush } from "@/server/workflows/queue";
import type { KanbanBoard, StructureElement } from "@/lib/structures/types";
import { translateKanbanIntents, type KanbanIntent, type KanbanIntentResult, type KanbanLiveItem } from "@/lib/structures/kanban";
import { liveItemsOf, liveLimits, storedBoardOf } from "@/lib/structures/live-boards";
import { FLUSH_QUIET_MS } from "./flush";
import { applyOps, isLoaded, readState, type BoardRef } from "./state";

// ---------------------------------------------------------------------------
// Board changes from MCP and agents (docs/kanban-board.md 7): intents instead
// of a full board. A running session takes them like any participant's ops –
// everyone on the board sees them at once and the session saves them. Without
// a session they become a new version right away. Access is the caller's job.
// ---------------------------------------------------------------------------

export type KanbanElement = Extract<StructureElement, { type: "kanban" }>;

export type ApplyIntentsResult =
  | { ok: false; error: string }
  | {
      ok: true;
      results: KanbanIntentResult[];
      /** true: applied to a running session, saved with it; false: saved as `versionNo` (unless nothing changed) */
      live: boolean;
      versionNo?: number;
      board: KanbanBoard;
    };

/** The kanban element of an entry: by key, or the only one when no key is given. */
export function findKanbanElement(elements: StructureElement[], key: string | undefined): KanbanElement | { error: string } {
  const boards = elements.filter((e): e is KanbanElement => e.type === "kanban");
  if (key) return boards.find((e) => e.key === key) ?? { error: `no kanban element "${key}" in this entry (kanban keys: ${boards.map((b) => b.key).join(", ") || "none"})` };
  if (boards.length === 1) return boards[0];
  return { error: boards.length ? `the entry has several kanban boards – pass key (${boards.map((b) => b.key).join(", ")})` : "the entry has no kanban board" };
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

export async function applyKanbanIntents(communityId: string, contentId: string, key: string, intents: KanbanIntent[], actorId: string, origin: EventOrigin, changeNote?: string | null): Promise<ApplyIntentsResult> {
  const b: BoardRef = { contentId, key };

  if (await isLoaded(b)) {
    const state = await readState(b);
    const content = await getContent(communityId, contentId);
    const el = content?.version?.meta.structure?.definition.elements.find((e) => e.key === key);
    if (state && el?.type === "kanban") {
      const t = translateKanbanIntents(state.items as KanbanLiveItem[], intents, { lockColumns: el.lockColumns });
      let results = t.results;
      if (t.ops.length) {
        const applied = await applyOps(b, actorId, "server", t.ops, liveLimits("kanban"));
        if (!applied.missing) {
          if (applied.rejected.length) {
            // someone holds the card in their dialog (soft lock) – the server refused that one
            const refused = new Set(applied.rejected);
            results = results.map((r) => (r.ok && refused.has(r.id) ? { ok: false, error: "someone is editing this card right now – try again in a moment" } : r));
          }
          if (applied.becameDirty) await scheduleWhiteboardFlush(contentId, key, FLUSH_QUIET_MS);
          const now = await readState(b);
          return { ok: true, results, live: true, board: storedBoardOf(el, now?.items ?? t.items) };
        }
        // the session was saved and dropped meanwhile – fall through to a direct save
      } else {
        return { ok: true, results, live: true, board: storedBoardOf(el, t.items) };
      }
    }
  }

  // No session: build the new board from the current version and save it. The version number is
  // the optimistic lock – a concurrent save makes the insert fail, then we start over.
  for (let attempt = 0; attempt < 3; attempt++) {
    const content = await getContent(communityId, contentId);
    const version = content?.version;
    const snapshot = version?.meta.structure;
    if (!content || !version || !snapshot) return { ok: false, error: "entry not found" };
    const el = snapshot.definition.elements.find((e) => e.key === key);
    if (el?.type !== "kanban") return { ok: false, error: `no kanban element "${key}"` };

    const t = translateKanbanIntents(liveItemsOf(el, snapshot.answers[key]) as KanbanLiveItem[], intents, { lockColumns: el.lockColumns });
    const board = storedBoardOf(el, t.items);
    if (t.ops.length === 0) return { ok: true, results: t.results, live: false, board };

    const built = await buildStructuredVersionInput(snapshot, content.title, { ...snapshot.answers, [key]: board }, { changeNote: changeNote ?? null, prevEnrichment: snapshot.enrichment, imageMediaId: version.mediaId, prevAnswers: snapshot.answers, actorId });
    if (!built.ok) return { ok: false, error: `the board does not validate: ${built.issues.map((i) => `${i.key}: ${i.code}`).join(", ")}` };
    try {
      const saved = await addContentVersion(communityId, contentId, { ...built.input, meta: { ...version.meta, ...built.input.meta } }, actorId, origin, { expectedVersionCount: content.versionCount });
      if (!saved) return { ok: false, error: "entry not found" };
      return { ok: true, results: t.results, live: false, versionNo: saved.versionCount, board };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      logger.debug({ contentId, key, attempt }, "kanban intents: concurrent save, retrying");
    }
  }
  return { ok: false, error: "the entry was changed concurrently – try again" };
}

/** Compact text form of a board for tool answers: columns and cards with their ids. */
export function describeBoard(board: KanbanBoard): string {
  return board.columns
    .map((col) => [`${col.title} (id: ${col.id})`, ...col.cards.map((c) => `  - ${c.title} (id: ${c.id}${c.color ? `, ${c.color}` : ""})`)].join("\n"))
    .join("\n");
}
