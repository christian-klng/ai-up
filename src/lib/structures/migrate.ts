import type { StructureAnswers, StructureDefinition, StructureElement } from "./types";
import { isAnswerable, isMarkdownSectionArray } from "./types";
import { hasAnswerValue } from "./visibility";

export type AnswerMigrationResult = {
  answers: StructureAnswers;
  /** keys whose answers were carried into the new definition */
  carriedKeys: string[];
  /** keys that had a non-empty answer but no compatible slot in the new definition */
  droppedKeys: string[];
};

const STRING_FAMILY = new Set<StructureElement["type"]>(["text", "textarea", "markdown"]);

function maxLengthOf(el: StructureElement): number {
  if (el.type === "text") return el.maxLength ?? 2000;
  if (el.type === "textarea") return el.maxLength ?? 50000;
  if (el.type === "markdown") return el.maxLength ?? 200000;
  return Number.MAX_SAFE_INTEGER;
}

/**
 * Carries answers from an entry's definition snapshot over to a newer template
 * definition, by element key. Values that no longer fit (removed key, type
 * change outside the text family, select value not offered any more) are
 * dropped — visibly, so the user can review before saving. Enrichment is not
 * migrated; the server recomputes it on save.
 */
export function migrateStructureAnswers(oldDef: StructureDefinition, newDef: StructureDefinition, answers: StructureAnswers): AnswerMigrationResult {
  const oldByKey = new Map(oldDef.elements.filter(isAnswerable).map((el) => [el.key, el]));
  const migrated: StructureAnswers = {};
  const carriedKeys: string[] = [];
  const droppedKeys: string[] = [];

  const answeredKeys = Object.keys(answers).filter((key) => hasAnswerValue(answers[key]));

  for (const newEl of newDef.elements) {
    if (!isAnswerable(newEl)) continue;
    const oldEl = oldByKey.get(newEl.key);
    const value = answers[newEl.key];
    if (!oldEl || value === undefined || !hasAnswerValue(value)) continue;

    const sameType = oldEl.type === newEl.type;
    const stringCarry = STRING_FAMILY.has(oldEl.type) && STRING_FAMILY.has(newEl.type);
    if (!sameType && !stringCarry) continue;

    switch (newEl.type) {
      case "markdown": {
        const sections = isMarkdownSectionArray(value) ? value : null;
        if (newEl.multiple) {
          // string (old single text / text / textarea) becomes one section titled after the old element
          if (typeof value === "string") {
            migrated[newEl.key] = [{ title: oldEl.label, body: value.slice(0, maxLengthOf(newEl)) }];
            carriedKeys.push(newEl.key);
          } else if (sections) {
            migrated[newEl.key] = sections.map((s) => ({ title: s.title, body: s.body.slice(0, maxLengthOf(newEl)) }));
            carriedKeys.push(newEl.key);
          }
          break;
        }
        if (typeof value === "string") {
          migrated[newEl.key] = value.slice(0, maxLengthOf(newEl));
          carriedKeys.push(newEl.key);
        } else if (sections) {
          // accordion list collapses back into one document ("## title" blocks) – nothing is lost
          migrated[newEl.key] = sections.map((s) => `## ${s.title}\n\n${s.body}`).join("\n\n").slice(0, maxLengthOf(newEl));
          carriedKeys.push(newEl.key);
        }
        break;
      }
      case "text":
      case "textarea": {
        if (typeof value !== "string") break;
        migrated[newEl.key] = value.slice(0, maxLengthOf(newEl));
        carriedKeys.push(newEl.key);
        break;
      }
      case "select": {
        if (typeof value !== "string" || !newEl.options.includes(value)) break;
        migrated[newEl.key] = value;
        carriedKeys.push(newEl.key);
        break;
      }
      case "chips": {
        if (!Array.isArray(value)) break;
        const kept = (value as string[]).filter((v) => typeof v === "string" && newEl.options.includes(v));
        if (kept.length === 0) break;
        migrated[newEl.key] = kept;
        carriedKeys.push(newEl.key);
        break;
      }
      // structural values carry as-is; the form re-validates min/max on save
      case "checkbox":
      case "qa":
      case "process":
      case "image":
      case "link":
      case "video": {
        migrated[newEl.key] = value;
        carriedKeys.push(newEl.key);
        break;
      }
    }
  }

  const carried = new Set(carriedKeys);
  for (const key of answeredKeys) {
    if (!carried.has(key)) droppedKeys.push(key);
  }

  return { answers: migrated, carriedKeys, droppedKeys };
}
