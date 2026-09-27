import { inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { canEditContent, getContent, type ContentListItem } from "@/server/domain/knowledge";
import type { StructureAnswers } from "@/lib/structures/types";
import { STRUCTURE_KEY_REGEX, isWhiteboardBoard } from "@/lib/structures/types";
import { isCollaborativeBoard, isLiveBoardElement, liveItemsOf, type LiveBoardElement, type LiveItem } from "@/lib/structures/live-boards";

export type BoardAccess = { content: ContentListItem; element: LiveBoardElement; items: LiveItem[] };

/**
 * Who may join a live board (whiteboard or kanban): every active member when the element is
 * collaborative (default), otherwise only who may edit the entry. Answers "undefined" for anything
 * else – same as "does not exist", no enumeration. Membership itself is the caller's job (session
 * or membership row).
 */
export async function boardAccess(user: { id: string; role: string; communityId: string }, contentId: string, key: string): Promise<BoardAccess | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(contentId) || !STRUCTURE_KEY_REGEX.test(key)) return undefined;
  const content = await getContent(user.communityId, contentId);
  const snapshot = content?.version?.meta.structure;
  if (!content || content.type !== "structured" || !snapshot) return undefined;
  const element = snapshot.definition.elements.find((e) => e.key === key);
  if (!element || !isLiveBoardElement(element)) return undefined;
  if (!isCollaborativeBoard(element) && !canEditContent(user, content)) return undefined;
  return { content, element, items: liveItemsOf(element, snapshot.answers[key]) };
}

/** Names for the author tags of every whiteboard in the answers (ids come from the server-side stamp). */
export async function whiteboardAuthorNames(answers: StructureAnswers): Promise<Record<string, string>> {
  const ids = new Set<string>();
  for (const value of Object.values(answers)) {
    if (!isWhiteboardBoard(value)) continue;
    for (const item of value.items) if (item.createdBy) ids.add(item.createdBy);
  }
  if (ids.size === 0) return {};
  const rows = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [...ids]));
  return Object.fromEntries(rows.map((r) => [r.id, r.name]));
}
