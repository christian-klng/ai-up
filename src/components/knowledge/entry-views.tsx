import Link from "next/link";
import { Pin } from "lucide-react";
import { AreaIcon } from "@/components/knowledge/area-icon";
import { Markdown } from "@/components/content/markdown";
import { UserAvatar } from "@/components/shell/user-avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Presentational entry renderings for the collection layouts (grid, compact,
 * list, blog). Server components; labels come in as props so the page owns i18n.
 */
export type EntryViewItem = {
  href: string;
  title: string;
  /** cropped preview (thumb variant / link preview / video still) */
  thumbSrc?: string;
  /** uncropped image for the blog layout */
  fullImageSrc?: string;
  excerpt?: string;
  bodyMarkdown?: string;
  author: { id: string; name: string; avatarMediaId: string | null } | null;
  dateLabel: string;
  pinned: boolean;
};

/** Characters of teaser markdown above which the blog layout clamps and offers "read more". */
const BLOG_CLAMP_CHARS = 600;

/** Blog teaser source: the entry markdown without mermaid fences (process elements emit raw mermaid). */
export function blogTeaser(bodyMarkdown: string | null | undefined): { markdown: string; clamped: boolean } {
  const markdown = (bodyMarkdown ?? "").replace(/```mermaid[\s\S]*?```/g, "").trim();
  return { markdown, clamped: markdown.length > BLOG_CLAMP_CHARS };
}

function PinnedBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-primary">
      <Pin className="size-3" /> {label}
    </span>
  );
}

function MetaRow({ item, className }: { item: EntryViewItem; className?: string }) {
  return (
    <span className={cn("flex items-center gap-2 text-xs text-muted-foreground", className)}>
      {item.author && <UserAvatar user={item.author} size={20} variant="thumb" />}
      <span className="truncate">{item.author?.name}</span>
      <span className="ml-auto shrink-0">{item.dateLabel}</span>
    </span>
  );
}

export function EntryCard({ item, variant, showImageSlot, areaIcon, pinnedLabel }: { item: EntryViewItem; variant: "grid" | "compact"; showImageSlot: boolean; areaIcon: string; pinnedLabel: string }) {
  return (
    <Link href={item.href} className="group flex h-full flex-col overflow-hidden rounded-lg border bg-card transition-colors hover:bg-accent/40">
      {showImageSlot && (
        <span className="block aspect-[16/9] w-full overflow-hidden bg-muted">
          {item.thumbSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.thumbSrc} alt="" className="size-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
          ) : (
            <span className="flex size-full items-center justify-center">
              <AreaIcon icon={areaIcon} className="size-8 opacity-20" />
            </span>
          )}
        </span>
      )}
      <span className={cn("flex flex-1 flex-col", variant === "compact" ? "gap-1.5 p-3" : "gap-2 p-4")}>
        {item.pinned && <PinnedBadge label={pinnedLabel} />}
        <span className={cn("line-clamp-2 font-medium group-hover:underline", variant === "compact" && "text-sm")}>{item.title}</span>
        {variant === "grid" && item.excerpt && <span className={cn("text-sm text-muted-foreground", showImageSlot ? "line-clamp-2" : "line-clamp-3")}>{item.excerpt}</span>}
        <MetaRow item={item} className="mt-auto pt-2" />
      </span>
    </Link>
  );
}

export function EntryListItem({ item }: { item: EntryViewItem }) {
  return (
    <Link href={item.href} className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/40">
      {item.thumbSrc && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.thumbSrc} alt="" className="size-12 shrink-0 rounded-md border bg-muted object-cover" loading="lazy" referrerPolicy="no-referrer" />
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="line-clamp-1 font-medium group-hover:underline">{item.title}</span>
          {item.pinned && <Pin className="size-3 shrink-0 text-primary" />}
        </span>
        {item.excerpt && <span className="line-clamp-1 text-sm text-muted-foreground">{item.excerpt}</span>}
      </span>
      <span className="hidden shrink-0 items-center gap-2 text-xs text-muted-foreground sm:flex">
        {item.author && <UserAvatar user={item.author} size={20} variant="thumb" />}
        <span>{item.dateLabel}</span>
      </span>
    </Link>
  );
}

export function EntryBlogPost({ item, pinnedLabel, readMoreLabel }: { item: EntryViewItem; pinnedLabel: string; readMoreLabel: string }) {
  const teaser = blogTeaser(item.bodyMarkdown);
  return (
    <article className="grid gap-3">
      {item.pinned && (
        <span>
          <PinnedBadge label={pinnedLabel} />
        </span>
      )}
      <h2 className="text-xl font-semibold tracking-tight text-balance">
        <Link href={item.href} className="hover:underline">
          {item.title}
        </Link>
      </h2>
      <MetaRow item={item} />
      {item.fullImageSrc && (
        <Link href={item.href} className="block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.fullImageSrc} alt="" className="h-auto w-full rounded-md border bg-muted" loading="lazy" referrerPolicy="no-referrer" />
        </Link>
      )}
      {teaser.markdown && (
        <div className={cn(teaser.clamped && "relative max-h-80 overflow-hidden")}>
          <Markdown className="prose-sm">{teaser.markdown}</Markdown>
          {teaser.clamped && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background" aria-hidden />}
        </div>
      )}
      {teaser.clamped && (
        <div>
          <Button asChild variant="outline" size="sm">
            <Link href={item.href}>{readMoreLabel}</Link>
          </Button>
        </div>
      )}
    </article>
  );
}
