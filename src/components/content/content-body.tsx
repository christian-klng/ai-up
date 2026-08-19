import { ExternalLink, FileVideo } from "lucide-react";
import type { ContentType, ContentVersionMeta, MediaFile } from "@/server/db/schema";
import { detectVideoSource, isDirectMediaUrl } from "@/lib/video";
import { Markdown } from "./markdown";

export type ContentBodyProps = {
  type: ContentType;
  title: string;
  bodyMarkdown: string | null;
  url: string | null;
  media: Pick<MediaFile, "id" | "mime" | "width" | "height" | "originalName" | "size"> | null;
  meta: ContentVersionMeta;
  labels: { openLink: string; downloadVideo: string; videoUnsupported: string };
};

/** Renders the body of a content version according to its type. Used on the view page and in history. */
export function ContentBody({ type, title, bodyMarkdown, url, media, meta, labels }: ContentBodyProps) {
  return (
    <div className="grid gap-6">
      {type === "image" && (
        <figure className="grid gap-2">
          {media ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/files/${media.id}`} alt={meta.alt ?? title} width={media.width ?? undefined} height={media.height ?? undefined} className="max-h-[70vh] w-auto max-w-full rounded-md border bg-muted object-contain" />
          ) : url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={meta.alt ?? title} className="max-h-[70vh] w-auto max-w-full rounded-md border bg-muted object-contain" referrerPolicy="no-referrer" />
          ) : null}
          {meta.alt && <figcaption className="text-sm text-muted-foreground">{meta.alt}</figcaption>}
        </figure>
      )}

      {type === "video" && <VideoPlayer url={url} media={media} meta={meta} labels={labels} />}

      {type === "link" && url && <LinkCard url={url} meta={meta} openLabel={labels.openLink} />}

      {bodyMarkdown && <Markdown>{bodyMarkdown}</Markdown>}
    </div>
  );
}

function VideoPlayer({ url, media, meta, labels }: Pick<ContentBodyProps, "url" | "media" | "meta" | "labels">) {
  if (media) {
    return (
      <div className="grid gap-2">
        <video controls preload="metadata" className="max-h-[70vh] w-full rounded-md border bg-black">
          <source src={`/api/files/${media.id}`} type={media.mime} />
          {labels.videoUnsupported}
        </video>
        <a href={`/api/files/${media.id}`} download={media.originalName} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <FileVideo className="size-4" /> {labels.downloadVideo} ({Math.round(media.size / 1024 / 1024)} MB)
        </a>
      </div>
    );
  }
  if (!url) return null;
  const src = meta.provider === "youtube" || meta.provider === "vimeo" ? { provider: meta.provider, embedId: meta.embedId } : detectVideoSource(url);
  if (src && (src.provider === "youtube" || src.provider === "vimeo") && src.embedId) {
    const embedUrl = src.provider === "youtube" ? `https://www.youtube-nocookie.com/embed/${src.embedId}` : `https://player.vimeo.com/video/${src.embedId}`;
    return (
      <div className="aspect-video w-full overflow-hidden rounded-md border bg-black">
        <iframe src={embedUrl} title="video" className="size-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
      </div>
    );
  }
  if (isDirectMediaUrl(url, "video")) {
    return (
      <video controls preload="metadata" className="max-h-[70vh] w-full rounded-md border bg-black" src={url}>
        {labels.videoUnsupported}
      </video>
    );
  }
  return <LinkCard url={url} meta={meta} openLabel={labels.openLink} />;
}

export function LinkCard({ url, meta, openLabel, compact }: { url: string; meta: ContentVersionMeta; openLabel: string; compact?: boolean }) {
  const p = meta.preview ?? {};
  let host = url;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    /* ignore */
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="group flex overflow-hidden rounded-lg border bg-card transition-colors hover:bg-accent/40">
      {p.image && !compact && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.image} alt="" className="hidden h-auto w-48 shrink-0 object-cover sm:block" referrerPolicy="no-referrer" loading="lazy" />
      )}
      <span className="grid min-w-0 flex-1 gap-1 p-4">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ExternalLink className="size-3.5" /> {p.siteName ?? host}
        </span>
        <span className="line-clamp-2 font-medium group-hover:underline">{p.title ?? url}</span>
        {p.description && !compact && <span className="line-clamp-3 text-sm text-muted-foreground">{p.description}</span>}
        <span className="mt-1 truncate text-xs text-muted-foreground">{url}</span>
        <span className="sr-only">{openLabel}</span>
      </span>
    </a>
  );
}
