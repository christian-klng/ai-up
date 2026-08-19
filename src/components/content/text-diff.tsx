import { diffLines } from "diff";
import { cn } from "@/lib/utils";

/** Line diff between two markdown texts (server component; `diff` is pure). */
export function TextDiff({ before, after, emptyLabel }: { before: string; after: string; emptyLabel: string }) {
  // Normalize trailing newlines so a missing final "\n" does not show as a changed line.
  const norm = (raw: string) => {
    const s = raw.replace(/\r\n?/g, "\n");
    return s === "" || s.endsWith("\n") ? s : `${s}\n`;
  };
  const parts = diffLines(norm(before), norm(after));
  const changed = parts.some((p) => p.added || p.removed);
  if (!changed) return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  return (
    <pre className="max-h-[60vh] overflow-auto rounded-md border bg-muted/30 p-3 text-xs leading-relaxed">
      {parts.map((p, i) => {
        const lines = p.value.replace(/\n$/, "").split("\n");
        // Collapse long unchanged blocks
        const shown = !p.added && !p.removed && lines.length > 8 ? [...lines.slice(0, 3), `… (${lines.length - 6})`, ...lines.slice(-3)] : lines;
        return shown.map((line, j) => (
          <div key={`${i}-${j}`} className={cn("whitespace-pre-wrap break-words px-1", p.added && "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300", p.removed && "bg-red-500/15 text-red-800 line-through dark:text-red-300")}>
            <span className="mr-2 select-none text-muted-foreground">{p.added ? "+" : p.removed ? "−" : " "}</span>
            {line}
          </div>
        ));
      })}
    </pre>
  );
}
