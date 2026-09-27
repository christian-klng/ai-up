import { addContentVersion, getContent } from "@/server/domain/knowledge";
import { loadCommunity } from "@/server/domain/communities";
import { buildStructuredVersionInput } from "@/server/domain/structured-entries";
import { logger } from "@/server/logger";
import type { WhiteboardItem } from "@/lib/structures/types";
import { dropState, dropStateIf, markFlushed, participants, publishFlushed, readState, type BoardRef } from "./state";

// ---------------------------------------------------------------------------
// Saving a live session as an entry version (docs/whiteboard.md 5.4). Runs in
// the worker as job { kind: "whiteboard-flush" }; the job postpones itself
// while people are still busy, so a session produces a handful of versions,
// not one per drag.
// ---------------------------------------------------------------------------

/** Save once the board has been quiet this long … */
export const FLUSH_QUIET_MS = 60_000;
/** … but never keep unsaved changes longer than this during a long session. */
export const FLUSH_MAX_DIRTY_MS = 10 * 60_000;
/** Delay after the last participant left (a reload reconnects within it). */
export const FLUSH_ON_LEAVE_MS = 5_000;

export type FlushResult = { postponeMs: number } | { saved: number } | { skipped: string };

const NOTE = {
  de: (label: string, n: number) => `Whiteboard „${label}“: ${n === 1 ? "1 Person" : `${n} Personen`}`,
  en: (label: string, n: number) => `Whiteboard "${label}": ${n === 1 ? "1 contributor" : `${n} contributors`}`,
};

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

type SaveResult = { ok: true; versionNo: number } | { ok: false; reason: "gone" | "invalid" | "conflict" };

/**
 * Writes the live board into a new version of the entry: re-reads the CURRENT version and replaces
 * only this element's answer, so a form save of other fields in between is not overwritten. The
 * version number doubles as optimistic lock – a concurrent save makes the insert fail, we retry.
 */
async function saveBoard(communityId: string, b: BoardRef, items: WhiteboardItem[], editorId: string, opts: { contributors: number; evaluate: boolean }): Promise<SaveResult> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const content = await getContent(communityId, b.contentId);
    const version = content?.version;
    const snapshot = version?.meta.structure;
    if (!content || !version || content.type !== "structured" || !snapshot) return { ok: false, reason: "gone" };
    const el = snapshot.definition.elements.find((e) => e.key === b.key);
    if (!el || el.type !== "whiteboard") return { ok: false, reason: "gone" };

    const community = await loadCommunity(communityId);
    const note = NOTE[community?.defaultLocale ?? "de"](el.label, opts.contributors);
    const built = await buildStructuredVersionInput(snapshot, content.title, { ...snapshot.answers, [b.key]: { items } }, {
      changeNote: note,
      prevEnrichment: snapshot.enrichment,
      imageMediaId: version.mediaId,
      prevAnswers: snapshot.answers,
      actorId: editorId,
      trustedWhiteboardKeys: [b.key],
    });
    if (!built.ok) {
      logger.info({ ...b, issues: built.issues }, "whiteboard: live board does not validate, not saved");
      return { ok: false, reason: "invalid" };
    }
    try {
      const saved = await addContentVersion(communityId, b.contentId, { ...built.input, meta: { ...version.meta, ...built.input.meta } }, editorId, { kind: "user" }, { skipEvaluation: !opts.evaluate, expectedVersionCount: content.versionCount, liveBoards: "keep" });
      if (!saved) return { ok: false, reason: "gone" };
      return { ok: true, versionNo: saved.versionCount };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      logger.debug({ ...b, attempt }, "whiteboard: concurrent save, retrying");
    }
  }
  return { ok: false, reason: "conflict" };
}

export async function flushBoard(b: BoardRef): Promise<FlushResult> {
  const state = await readState(b);
  if (!state || !state.communityId) return { skipped: "no live state" };
  const present = (await participants(b)).length;
  const now = Date.now();

  if (state.seq === state.flushedSeq) {
    if (present === 0) await dropStateIf(b, state.seq);
    return { skipped: "nothing changed" };
  }

  if (present > 0 && state.lastAt && now - state.lastAt < FLUSH_QUIET_MS && state.dirtySince && now - state.dirtySince < FLUSH_MAX_DIRTY_MS) {
    return { postponeMs: FLUSH_QUIET_MS - (now - state.lastAt) + 1_000 };
  }

  const editorId = state.lastBy ?? state.contributors[0];
  if (!editorId) return { skipped: "no editor" };
  // The criteria check runs once, when the session is over – not for every intermediate save.
  const result = await saveBoard(state.communityId, b, state.items, editorId, { contributors: Math.max(1, state.contributors.length), evaluate: present === 0 });
  if (!result.ok) {
    if (result.reason === "gone") {
      await dropState(b);
      return { skipped: "entry or element gone" };
    }
    if (result.reason === "conflict") return { postponeMs: 5_000 };
    return { skipped: "invalid board" };
  }

  await publishFlushed(b, result.versionNo);
  const clean = await markFlushed(b, state.seq, state.items);
  if (!clean) return { postponeMs: FLUSH_QUIET_MS };
  if (present === 0) await dropStateIf(b, state.seq);
  return { saved: result.versionNo };
}
