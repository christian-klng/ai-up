import type { ProcessGraph, QaPair, StructureAnswers, StructureDefinition } from "./types";
import { visibleElements } from "./visibility";
import { isQaPairArray } from "./visibility";

// ---------------------------------------------------------------------------
// Deterministic Markdown rendering of a filled structure. The result is the
// entry's bodyMarkdown — search, history, diff and export all work on it.
// ---------------------------------------------------------------------------

function mermaidId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

function mermaidLabel(text: string): string {
  return text.replace(/"/g, "'").replace(/\n/g, " ").trim();
}

export function processGraphToMermaid(graph: ProcessGraph): string {
  const lines = ["flowchart TD"];
  for (const n of graph.nodes) {
    const id = mermaidId(n.id);
    const label = mermaidLabel(n.label) || n.id;
    if (n.kind === "decision") lines.push(`  ${id}{"${label}"}`);
    else if (n.kind === "start" || n.kind === "end") lines.push(`  ${id}(["${label}"])`);
    else lines.push(`  ${id}["${label}"]`);
  }
  for (const e of graph.edges) {
    const cond = e.condition?.trim();
    lines.push(cond ? `  ${mermaidId(e.from)} -->|"${mermaidLabel(cond)}"| ${mermaidId(e.to)}` : `  ${mermaidId(e.from)} --> ${mermaidId(e.to)}`);
  }
  return lines.join("\n");
}

/** Plain-text outline of the graph so the export degrades without mermaid. */
export function processGraphToOutline(graph: ProcessGraph): string {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const out: string[] = [];
  for (const n of graph.nodes) {
    const desc = n.description?.trim() ? ` — ${n.description.trim()}` : "";
    out.push(`- **${n.label}**${n.kind === "decision" ? " (Entscheidung)" : ""}${desc}`);
    for (const e of graph.edges.filter((e) => e.from === n.id)) {
      const target = byId.get(e.to)?.label ?? e.to;
      out.push(e.condition?.trim() ? `  - wenn *${e.condition.trim()}* → ${target}` : `  - → ${target}`);
    }
  }
  return out.join("\n");
}

export function renderStructureMarkdown(def: StructureDefinition, answers: StructureAnswers): string {
  const parts: string[] = [];
  if (def.intro?.trim()) parts.push(def.intro.trim());

  for (const el of visibleElements(def, answers)) {
    if (el.type === "info") {
      parts.push(el.body.trim());
      continue;
    }
    const value = answers[el.key];
    if (value === undefined) continue;

    switch (el.type) {
      case "text":
      case "textarea":
      case "select": {
        if (typeof value !== "string" || !value.trim()) break;
        parts.push(`## ${el.label}\n\n${value.trim()}`);
        break;
      }
      case "chips": {
        if (!Array.isArray(value) || value.length === 0) break;
        parts.push(`## ${el.label}\n\n${(value as string[]).map((v) => `- ${v}`).join("\n")}`);
        break;
      }
      case "checkbox": {
        if (typeof value !== "boolean") break;
        parts.push(`- [${value ? "x" : " "}] ${el.label}`);
        break;
      }
      case "qa": {
        if (!isQaPairArray(value) || value.length === 0) break;
        const pairs = (value as QaPair[]).map((p) => `**${p.question.trim()}**\n\n${p.answer.trim()}`).join("\n\n");
        parts.push(`## ${el.label}\n\n${pairs}`);
        break;
      }
      case "process": {
        const graph = value as ProcessGraph;
        if (!graph.nodes?.length) break;
        parts.push(`## ${el.label}\n\n\`\`\`mermaid\n${processGraphToMermaid(graph)}\n\`\`\`\n\n${processGraphToOutline(graph)}`);
        break;
      }
    }
  }

  return parts.join("\n\n").trim();
}

/** Flat answer text for the denormalized search index (no mermaid noise). */
export function flattenAnswersText(def: StructureDefinition, answers: StructureAnswers): string {
  const parts: string[] = [];
  for (const el of visibleElements(def, answers)) {
    if (el.type === "info") continue;
    const value = answers[el.key];
    if (value === undefined) continue;
    parts.push(el.label);
    if (typeof value === "string") parts.push(value);
    else if (Array.isArray(value) && value.every((v) => typeof v === "string")) parts.push((value as string[]).join(" "));
    else if (isQaPairArray(value)) parts.push((value as QaPair[]).map((p) => `${p.question} ${p.answer}`).join(" "));
    else if (typeof value === "object" && value !== null && "nodes" in value) {
      const graph = value as ProcessGraph;
      parts.push(graph.nodes.map((n) => `${n.label} ${n.description ?? ""}`).join(" "));
      parts.push(graph.edges.map((e) => e.condition ?? "").filter(Boolean).join(" "));
    }
  }
  return parts.filter(Boolean).join("\n");
}
