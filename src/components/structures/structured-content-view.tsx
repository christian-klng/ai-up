"use client";

import dynamic from "next/dynamic";
import type { ProcessGraph, QaPair, StructureEntryMeta } from "@/lib/structures/types";
import { visibleElements } from "@/lib/structures/visibility";
import { isQaPairArray } from "@/lib/structures/visibility";
import { Markdown } from "@/components/content/markdown";
import { Badge } from "@/components/ui/badge";

const ProcessGraphEditor = dynamic(() => import("./process-graph-editor").then((m) => m.ProcessGraphEditor), { ssr: false });

/** Native view of a structured entry: sections from the stored answers, process graphs rendered read-only. */
export function StructuredContentView({ meta }: { meta: StructureEntryMeta }) {
  const { definition, answers } = meta;
  return (
    <div className="grid grid-cols-1 gap-5">
      {definition.intro && (
        <div className="text-sm text-muted-foreground">
          <Markdown>{definition.intro}</Markdown>
        </div>
      )}
      {visibleElements(definition, answers).map((el) => {
        if (el.type === "info") {
          return (
            <div key={el.key} className="rounded-md border bg-muted/40 p-3 text-sm">
              <Markdown>{el.body}</Markdown>
            </div>
          );
        }
        const value = answers[el.key];
        if (value === undefined) return null;
        switch (el.type) {
          case "text":
          case "textarea":
          case "select":
            return typeof value === "string" && value.trim() ? (
              <section key={el.key}>
                <h2 className="mb-1 text-base font-semibold">{el.label}</h2>
                <div className="text-sm">
                  <Markdown>{value}</Markdown>
                </div>
              </section>
            ) : null;
          case "chips":
            return Array.isArray(value) && value.length > 0 ? (
              <section key={el.key}>
                <h2 className="mb-1.5 text-base font-semibold">{el.label}</h2>
                <div className="flex flex-wrap gap-1.5">
                  {(value as string[]).map((v) => (
                    <Badge key={v} variant="secondary">
                      {v}
                    </Badge>
                  ))}
                </div>
              </section>
            ) : null;
          case "checkbox":
            return typeof value === "boolean" ? (
              <div key={el.key} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={value} readOnly disabled className="size-4 accent-primary" />
                <span>{el.label}</span>
              </div>
            ) : null;
          case "qa":
            return isQaPairArray(value) && value.length > 0 ? (
              <section key={el.key}>
                <h2 className="mb-1.5 text-base font-semibold">{el.label}</h2>
                <div className="grid grid-cols-1 gap-3">
                  {(value as QaPair[]).map((p, i) => (
                    <div key={i}>
                      <div className="text-sm font-medium">{p.question}</div>
                      <div className="text-sm text-muted-foreground">
                        <Markdown>{p.answer}</Markdown>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null;
          case "process": {
            const graph = value as ProcessGraph;
            return graph.nodes?.length ? (
              <section key={el.key}>
                <h2 className="mb-1.5 text-base font-semibold">{el.label}</h2>
                <ProcessGraphEditor value={graph} readOnly />
              </section>
            ) : null;
          }
        }
      })}
    </div>
  );
}
