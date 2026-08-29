// Structure definitions for collections ("Sammlungen"): an admin-authored,
// JSON-stored template of interactive elements. Members fill a structure to
// create a new entry; the answers render deterministically to Markdown.
// Pure TS — imported by client components, server actions and the worker.

/** Answer-dependent visibility. Exactly one operator must be set (validated). */
export type ShowIf = {
  /** key of an EARLIER answerable element */
  key: string;
  /** text/select/checkbox answers */
  equals?: string | boolean;
  /** chips answers: array membership */
  includes?: string;
  /** any non-empty answer */
  notEmpty?: boolean;
};

export type StructureElementBase = {
  /** unique per structure, ^[a-z][a-z0-9_]{0,39}$ */
  key: string;
  label: string;
  help?: string;
  /** ignored for "info" */
  required?: boolean;
  showIf?: ShowIf;
};

export type ProcessNodeKind = "start" | "step" | "decision" | "end";

export type ProcessNode = {
  id: string;
  label: string;
  description?: string;
  kind: ProcessNodeKind;
  x: number;
  y: number;
};

export type ProcessEdge = {
  id: string;
  from: string;
  to: string;
  /** edge label, e.g. a branch condition ("wenn ja") */
  condition?: string;
};

export type ProcessGraph = { nodes: ProcessNode[]; edges: ProcessEdge[] };

export type StructureElement =
  | (StructureElementBase & { type: "info"; body: string })
  | (StructureElementBase & { type: "text"; placeholder?: string; maxLength?: number })
  | (StructureElementBase & { type: "textarea"; placeholder?: string; maxLength?: number })
  | (StructureElementBase & { type: "select"; options: string[]; placeholder?: string })
  | (StructureElementBase & { type: "chips"; options: string[]; minSelected?: number; maxSelected?: number })
  | (StructureElementBase & { type: "checkbox" })
  | (StructureElementBase & { type: "qa"; questionLabel?: string; answerLabel?: string; minPairs?: number; maxPairs?: number })
  | (StructureElementBase & { type: "process"; seed: ProcessGraph })
  | (StructureElementBase & { type: "markdown"; placeholder?: string; maxLength?: number; multiple?: boolean })
  | (StructureElementBase & { type: "image" })
  | (StructureElementBase & { type: "link" })
  | (StructureElementBase & { type: "video" });

export type StructureElementType = StructureElement["type"];

export type StructureDefinition = {
  /** schema-of-the-schema version for future migrations */
  formatVersion: 1;
  /** shown above the fill form and included in the Markdown export */
  intro?: string;
  elements: StructureElement[];
};

export type QaPair = { question: string; answer: string };

/** One accordion section of a markdown element with `multiple: true`. */
export type MarkdownSection = { title: string; body: string };

/** image answer: exactly one of mediaId (upload) or url (validated on save) */
export type ImageAnswer = { mediaId?: string; url?: string; alt?: string };
/** link answer: http(s) url; the preview lives in the enrichment, not here */
export type LinkAnswer = { url: string };
/** video answer: exactly one of mediaId (upload) or url (YouTube/Vimeo/direct) */
export type VideoAnswer = { mediaId?: string; url?: string };

export type StructureAnswerValue = string | boolean | string[] | QaPair[] | MarkdownSection[] | ProcessGraph | ImageAnswer | LinkAnswer | VideoAnswer;

export type StructureAnswers = Record<string, StructureAnswerValue>;

/** Server-computed extras per element key (previews, embed ids, media probes).
 * Never part of `answers` — pure validation must not depend on network state. */
export type StructureElementEnrichment = {
  /** source url the enrichment was computed for (staleness check on re-save) */
  url?: string;
  preview?: { title?: string; description?: string; image?: string; siteName?: string; fetchedAt?: string };
  provider?: "youtube" | "vimeo" | "file" | "url";
  embedId?: string;
  width?: number;
  height?: number;
};

export type StructureEnrichment = Record<string, StructureElementEnrichment>;

/** Snapshot stored on each structured entry version (self-contained). */
export type StructureEntryMeta = {
  /** id of the content template (field name predates the template refactor) */
  structureId: string;
  /** template version the snapshot was taken from */
  structureVersion: number;
  /** full definition at fill time — entries stay renderable/editable forever */
  definition: StructureDefinition;
  answers: StructureAnswers;
  enrichment?: StructureEnrichment;
};

export const STRUCTURE_KEY_REGEX = /^[a-z][a-z0-9_]{0,39}$/;

/** Sections of a markdown accordion list – shaped like QaPair, so check the section fields explicitly. */
export function isMarkdownSectionArray(value: unknown): value is MarkdownSection[] {
  return Array.isArray(value) && value.every((s) => typeof s === "object" && s !== null && typeof (s as MarkdownSection).title === "string" && typeof (s as MarkdownSection).body === "string" && !("question" in s));
}

/** Common shape of image/video/link answers. */
export type MediaLikeAnswer = { mediaId?: string; url?: string; alt?: string };

export function isMediaLikeAnswer(value: unknown): value is MediaLikeAnswer {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const v = value as MediaLikeAnswer;
  return (v.mediaId === undefined || typeof v.mediaId === "string") && (v.url === undefined || typeof v.url === "string") && !("nodes" in value);
}

/** Element types that collect an answer ("info" does not). */
export function isAnswerable(el: StructureElement): boolean {
  return el.type !== "info";
}

/** Untouched process elements default to their seed graph (fill form, server action and MCP share this). */
export function fillProcessSeeds(def: StructureDefinition, answers: StructureAnswers): StructureAnswers {
  const filled = { ...answers };
  for (const el of def.elements) {
    if (el.type === "process" && filled[el.key] === undefined) filled[el.key] = structuredClone(el.seed);
  }
  return filled;
}

export function emptyProcessGraph(): ProcessGraph {
  return {
    nodes: [
      { id: "start", label: "Start", kind: "start", x: 0, y: 0 },
      { id: "end", label: "Ende", kind: "end", x: 0, y: 200 },
    ],
    edges: [{ id: "start-end", from: "start", to: "end" }],
  };
}
