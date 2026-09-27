import { inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { canEditContent, getContent, type ContentListItem } from "@/server/domain/knowledge";
import type { StructureAnswers, StructureElement, WhiteboardItem } from "@/lib/structures/types";
import { STRUCTURE_KEY_REGEX, isCollaborativeWhiteboard, isWhiteboardBoard } from "@/lib/structures/types";

export type BoardAccess = { content: ContentListItem; element: Extract<StructureElement, { type: "whiteboard" }>; items: WhiteboardItem[] };

/**
 * Who may join a live whiteboard: every active member when the element is collaborative (default),
 * otherwise only who may edit the entry. Answers "undefined" for anything else – same as "does not
 * exist", no enumeration. Membership itself is the caller's job (session or membership row).
 */
export async function boardAccess(user: { id: string; role: string; communityId: string }, contentId: string, key: string): Promise<BoardAccess | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(contentId) || !STRUCTURE_KEY_REGEX.test(key)) return undefined;
  const content = await getContent(user.communityId, contentId);
  const snapshot = content?.version?.meta.structure;
  if (!content || content.type !== "structured" || !snapshot) return undefined;
  const element = snapshot.definition.elements.find((e) => e.key === key);
  if (!element || element.type !== "whiteboard") return undefined;
  if (!isCollaborativeWhiteboard(element) && !canEditContent(user, content)) return undefined;
  const value = snapshot.answers[key];
  return { content, element, items: isWhiteboardBoard(value) ? value.items : (element.seed?.items ?? []) };
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
