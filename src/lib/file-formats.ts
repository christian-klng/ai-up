/**
 * Format identity for the "folder" collection layout: the colour and the short
 * uppercase code a file icon carries. Derived from the entry's template — the
 * four system templates get familiar, language-neutral codes, custom templates
 * a code from their name and a colour hashed from their id. Framework-neutral
 * (no React/Next imports) so the derivation stays testable and reusable.
 */

/** Fixed colours for the four system formats — reserved, so a custom template never mimics one. */
const SYSTEM_COLORS = { blue: "#3b76c4", violet: "#7c5cd6", teal: "#0f9b8e", amber: "#d98324" } as const;

/** Colour pool for custom templates, picked by a stable hash of the template id. */
export const FILE_FORMAT_COLORS = [
  "#c2456b", // raspberry
  "#4b8c3b", // moss
  "#6b7fa8", // slate
  "#b0592f", // rust
  "#8a4f9e", // plum
  "#2e7d8c", // petrol
  "#a6832c", // ochre
  "#5559a8", // indigo
] as const;

export type FileFormat = { code: string; color: string };

/** Neutral sheet for entries whose template no longer exists. */
export const UNKNOWN_FILE_FORMAT: FileFormat = { code: "", color: "#8b8f98" };

/**
 * Fixed formats for the four system templates (`SystemTemplateKey`) and the
 * matching legacy content types — same keys, so one map serves both.
 */
export const SYSTEM_FILE_FORMATS: Record<string, FileFormat> = {
  text: { code: "TXT", color: SYSTEM_COLORS.blue },
  markdown: { code: "TXT", color: SYSTEM_COLORS.blue },
  image: { code: "IMG", color: SYSTEM_COLORS.violet },
  link: { code: "WEB", color: SYSTEM_COLORS.teal },
  video: { code: "MP4", color: SYSTEM_COLORS.amber },
};

const TRANSLITERATE: Record<string, string> = { Ä: "AE", Ö: "OE", Ü: "UE", ß: "SS" };

/**
 * Short uppercase code from a template name: "Rezept" -> "REZ", "KI-Tipp" -> "KIT".
 * Words shorter than three letters are topped up from the following word, so a
 * name like "AI note" still yields three characters ("AIN").
 */
export function formatCodeFromName(name: string): string {
  const words = name
    .toUpperCase()
    .replace(/[ÄÖÜß]/g, (c) => TRANSLITERATE[c] ?? c)
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
  if (words.length === 0) return "";
  let code = "";
  for (const word of words) {
    code += word.slice(0, 3 - code.length);
    if (code.length >= 3) break;
  }
  return code;
}

/** Stable colour for a template id — the same template always looks the same. */
export function formatColorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return FILE_FORMAT_COLORS[hash % FILE_FORMAT_COLORS.length];
}

/** Format for one entry: a system key (or legacy type) wins, otherwise name + id decide. */
export function fileFormatFor(input: { templateId?: string | null; systemKey?: string | null; name?: string | null; fallbackType?: string | null }): FileFormat {
  if (input.systemKey && SYSTEM_FILE_FORMATS[input.systemKey]) return SYSTEM_FILE_FORMATS[input.systemKey];
  if (input.name) return { code: formatCodeFromName(input.name), color: formatColorFor(input.templateId ?? input.name) };
  // No template row: a legacy entry falls back to its content type, anything else stays neutral.
  if (!input.templateId && input.fallbackType && SYSTEM_FILE_FORMATS[input.fallbackType]) return SYSTEM_FILE_FORMATS[input.fallbackType];
  return UNKNOWN_FILE_FORMAT;
}
