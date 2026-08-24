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
  | (StructureElementBase & { type: "process"; seed: ProcessGraph });

export type StructureElementType = StructureElement["type"];

export type StructureDefinition = {
  /** schema-of-the-schema version for future migrations */
  formatVersion: 1;
  /** shown above the fill form and included in the Markdown export */
  intro?: string;
  elements: StructureElement[];
};

export type QaPair = { question: string; answer: string };

export type StructureAnswerValue = string | boolean | string[] | QaPair[] | ProcessGraph;

export type StructureAnswers = Record<string, StructureAnswerValue>;

/** Snapshot stored on each structured entry version (self-contained). */
export type StructureEntryMeta = {
  structureId: string;
  structureVersion: number;
  /** full definition at fill time — entries stay renderable/editable forever */
  definition: StructureDefinition;
  answers: StructureAnswers;
};

export const STRUCTURE_KEY_REGEX = /^[a-z][a-z0-9_]{0,39}$/;

/** Element types that collect an answer ("info" does not). */
export function isAnswerable(el: StructureElement): boolean {
  return el.type !== "info";
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
