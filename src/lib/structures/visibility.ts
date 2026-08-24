import type { ProcessGraph, QaPair, ShowIf, StructureAnswers, StructureAnswerValue, StructureDefinition, StructureElement } from "./types";
import { isAnswerable } from "./types";

function hasValue(value: StructureAnswerValue | undefined): boolean {
  if (value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.length > 0;
  // ProcessGraph counts as answered once it has any node
  return (value as ProcessGraph).nodes?.length > 0;
}

function matches(cond: ShowIf, value: StructureAnswerValue | undefined): boolean {
  if (cond.notEmpty !== undefined) return cond.notEmpty === hasValue(value);
  if (cond.includes !== undefined) return Array.isArray(value) && (value as string[]).includes(cond.includes);
  if (cond.equals !== undefined) {
    if (typeof cond.equals === "boolean") return value === cond.equals;
    return typeof value === "string" && value === cond.equals;
  }
  return true;
}

/**
 * Elements currently visible given the answers, in definition order.
 * An element whose showIf references a hidden element is hidden too
 * (hidden elements count as unanswered).
 */
export function visibleElements(def: StructureDefinition, answers: StructureAnswers): StructureElement[] {
  const effective: StructureAnswers = {};
  const visible: StructureElement[] = [];
  for (const el of def.elements) {
    if (el.showIf && !matches(el.showIf, effective[el.showIf.key])) continue;
    visible.push(el);
    if (isAnswerable(el) && answers[el.key] !== undefined) effective[el.key] = answers[el.key];
  }
  return visible;
}

/** Answers restricted to the currently visible, answerable elements. */
export function pruneHiddenAnswers(def: StructureDefinition, answers: StructureAnswers): StructureAnswers {
  const pruned: StructureAnswers = {};
  for (const el of visibleElements(def, answers)) {
    if (isAnswerable(el) && answers[el.key] !== undefined) pruned[el.key] = answers[el.key];
  }
  return pruned;
}

export function isQaPairArray(value: unknown): value is QaPair[] {
  return Array.isArray(value) && value.every((p) => typeof p === "object" && p !== null && typeof (p as QaPair).question === "string" && typeof (p as QaPair).answer === "string");
}
