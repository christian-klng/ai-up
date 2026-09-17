import { eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import { contentVersions, contents } from "@/server/db/schema";
import { DEFAULT_AGENT_SYSTEM_PROMPT } from "@/server/domain/agents";
import { loadCommunity } from "@/server/domain/communities";
import type { AiAgent } from "@/server/db/schema";
import { MAX_INSTRUCTION_CHARS, instructionBlockChars } from "@/lib/agent-instructions";

/**
 * Builds the system prompt of a turn: the agent's base prompt (or the shipped default) plus the
 * entries the user picked as instructions – the "CLAUDE.md" pattern from docs/ki-agenten.md.
 *
 * Runs in the worker – no next/* imports.
 */

/** All instruction entries together. Beyond this the prompt starts crowding out the conversation. */
export { MAX_INSTRUCTION_CHARS };

export type InstructionDoc = { id: string; title: string; body: string; areaId: string };

/** Loads the instruction entries in the order the user arranged them. */
export async function loadInstructionDocs(contentIds: string[]): Promise<InstructionDoc[]> {
  if (!contentIds.length) return [];
  const rows = await db
    .select({ id: contents.id, title: contents.title, areaId: contents.areaId, body: contentVersions.bodyMarkdown })
    .from(contents)
    .leftJoin(contentVersions, eq(contentVersions.id, contents.currentVersionId))
    .where(inArray(contents.id, contentIds));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return contentIds.flatMap((id) => {
    const row = byId.get(id);
    return row ? [{ id: row.id, title: row.title, areaId: row.areaId, body: row.body ?? "" }] : [];
  });
}

/** Fills the two placeholders the default prompt uses. Plain replacement, not Liquid: an
 *  admin's prompt may legitimately contain braces, and a template error must not kill a turn. */
function fillPlaceholders(prompt: string, appName: string, purpose: string): string {
  return prompt.replaceAll("{{ app.name }}", appName).replaceAll("{{ app.purpose }}", purpose).replace(/\n{3,}/g, "\n\n").trim();
}

export async function buildSystemPrompt(agent: AiAgent, instructionContentIds: string[]): Promise<{ prompt: string; docs: InstructionDoc[]; truncated: boolean }> {
  // The agent knows its community, so {{ app.name }} / {{ app.purpose }} describe the right one.
  const community = await loadCommunity(agent.communityId);
  const base = fillPlaceholders(agent.systemPrompt.trim() || DEFAULT_AGENT_SYSTEM_PROMPT, community?.name ?? "AI-Up", community?.purpose ?? "");
  const docs = await loadInstructionDocs(instructionContentIds);
  if (!docs.length) return { prompt: base, docs, truncated: false };

  const parts: string[] = [base, "", "## Instructions from the collections", ""];
  let budget = MAX_INSTRUCTION_CHARS;
  let truncated = false;
  const used: InstructionDoc[] = [];
  for (const doc of docs) {
    const block = `### ${doc.title}\n\n${doc.body}`;
    // Same measure as the panel shows (src/lib/agent-instructions.ts) – the two must not drift apart.
    const size = instructionBlockChars(doc.title, doc.body);
    if (size > budget) {
      truncated = true;
      // A half-cut instruction is worse than a missing one – skip it and say so in the prompt.
      continue;
    }
    budget -= size;
    used.push(doc);
    parts.push(block, "");
  }
  if (truncated) parts.push("(Further instruction entries were left out because the instruction budget was exhausted.)", "");
  return { prompt: parts.join("\n").trim(), docs: used, truncated };
}
