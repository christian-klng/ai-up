"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import type { ImageAnswer, LinkAnswer, ProcessGraph, QaPair, StructureEntryMeta, VideoAnswer } from "@/lib/structures/types";
import { isMediaLikeAnswer } from "@/lib/structures/types";
import { visibleElements } from "@/lib/structures/visibility";
import { isQaPairArray } from "@/lib/structures/visibility";
import { Markdown } from "@/components/content/markdown";
import { LinkCard, VideoPlayer } from "@/components/content/content-body";
import { Badge } from "@/components/ui/badge";

const ProcessGraphEditor = dynamic(() => import("./process-graph-editor").then((m) => m.ProcessGraphEditor), { ssr: false });

/** Native view of a structured entry: sections from the stored answers, process graphs rendered read-only. */
export function StructuredContentView({ meta }: { meta: StructureEntryMeta }) {
  const t = useTranslations("knowledge");
  const { definition, answers, enrichment } = meta;
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
          case "markdown":
            return typeof value === "string" && value.trim() ? (
              <div key={el.key} className="text-sm">
                <Markdown>{value}</Markdown>
              </div>
            ) : null;
          case "image": {
            if (!isMediaLikeAnswer(value)) return null;
            const v = value as ImageAnswer;
            const e = enrichment?.[el.key];
            const src = v.mediaId ? `/api/files/${v.mediaId}` : v.url;
            if (!src) return null;
            return (
              <figure key={el.key} className="grid gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={v.alt ?? el.label} width={e?.width} height={e?.height} className="max-h-[70vh] w-auto max-w-full rounded-md border bg-muted object-contain" referrerPolicy={v.url ? "no-referrer" : undefined} />
                {v.alt && <figcaption className="text-sm text-muted-foreground">{v.alt}</figcaption>}
              </figure>
            );
          }
          case "video": {
            if (!isMediaLikeAnswer(value)) return null;
            const v = value as VideoAnswer;
            const e = enrichment?.[el.key];
            const labels = { openLink: t("view.openLink"), downloadVideo: t("view.downloadVideo"), videoUnsupported: t("view.videoUnsupported") };
            if (v.mediaId) {
              return (
                <video key={el.key} controls preload="metadata" className="max-h-[70vh] w-full rounded-md border bg-black" src={`/api/files/${v.mediaId}`}>
                  {labels.videoUnsupported}
                </video>
              );
            }
            if (!v.url) return null;
            return (
              <div key={el.key}>
                <VideoPlayer url={v.url} media={null} provider={e?.provider} embedId={e?.embedId} labels={labels} />
              </div>
            );
          }
          case "link": {
            if (!isMediaLikeAnswer(value)) return null;
            const v = value as LinkAnswer;
            if (!v.url) return null;
            const e = enrichment?.[el.key];
            return (
              <div key={el.key}>
                <LinkCard url={v.url} preview={e?.url === v.url ? e?.preview : undefined} openLabel={t("view.openLink")} />
              </div>
            );
          }
        }
      })}
    </div>
  );
}
