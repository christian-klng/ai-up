import type { StructureDefinition, StructureElement } from "@/lib/structures/types";

/**
 * Renders a template definition as a compact text description for the model: which element keys
 * exist, what shape their answer has and which ones are required. Pure – no imports beyond types.
 */

/** The answer shape per element type, phrased so the model can build valid JSON straight away. */
function answerShape(el: StructureElement): string {
  switch (el.type) {
    case "text":
    case "textarea":
      return "string";
    case "markdown":
      return el.multiple ? 'array of { "title": string, "body": string } (markdown body)' : "string (markdown)";
    case "select":
      return `string, one of: ${el.options.map((o) => JSON.stringify(o)).join(", ")}`;
    case "chips":
      return `array of strings out of: ${el.options.map((o) => JSON.stringify(o)).join(", ")}`;
    case "checkbox":
      return "boolean";
    case "qa":
      return 'array of { "question": string, "answer": string }';
    case "process":
      return 'process graph { "nodes": [{ "id", "label", "kind": "start"|"step"|"decision"|"end", "x", "y" }], "edges": [{ "id", "from", "to", "condition"? }] }';
    case "image":
      return 'object { "url": string } or { "mediaId": string }';
    case "link":
      return 'object { "url": string }';
    case "video":
      return 'object { "url": string } or { "mediaId": string }';
    case "info":
      return "no answer (static text)";
  }
}

export function describeStructure(name: string, definition: StructureDefinition): string {
  const lines = [`Template "${name}"`];
  if (definition.intro) lines.push("", definition.intro);
  lines.push("", "Elements (key → answer):");
  for (const el of definition.elements) {
    if (el.type === "info") continue;
    const flags = [el.required ? "required" : "optional", el.showIf ? `only when "${el.showIf.key}" matches` : null].filter(Boolean).join(", ");
    lines.push(`- ${el.key} (${el.label}) → ${answerShape(el)} [${flags}]`);
    if (el.help) lines.push(`  ${el.help}`);
  }
  return lines.join("\n");
}
