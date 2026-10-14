/** Upper bound for a meeting description (Markdown) – room for a short agenda and who it is for. */
export const MEETING_DESCRIPTION_MAX = 10000;

/**
 * Markdown as one line of plain text, for places that cannot render it (OpenGraph description).
 * Deliberately simple: drops the syntax of what the description editor produces – headings, emphasis,
 * lists, quotes, links (their text stays) – and collapses whitespace.
 */
export function markdownToPlainText(md: string): string {
  return md
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, "")
    .replace(/(?<!\\)(\*\*|__|\*|_|~~)(.+?)(?<!\\)\1/g, "$2")
    .replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
