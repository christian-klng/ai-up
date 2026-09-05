/** Pulls the first JSON object/array out of a text answer (fallback when a model ignores response_format). */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidates = [trimmed, fenced?.[1] ?? ""];
  for (const c of candidates) {
    if (!c) continue;
    try {
      return JSON.parse(c);
    } catch {
      /* try slicing */
    }
    const start = Math.min(...["{", "["].map((ch) => c.indexOf(ch)).filter((i) => i >= 0));
    if (Number.isFinite(start)) {
      const end = Math.max(c.lastIndexOf("}"), c.lastIndexOf("]"));
      if (end > start) {
        try {
          return JSON.parse(c.slice(start, end + 1));
        } catch {
          /* give up */
        }
      }
    }
  }
  return undefined;
}
