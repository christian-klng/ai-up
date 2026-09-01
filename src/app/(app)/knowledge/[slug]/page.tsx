import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { FileText, Image as ImageIcon, Link2, ListChecks, Plus, Search, Video } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { countContentsByType, getAreaBySlug, listContents } from "@/server/domain/knowledge";
import type { ContentType } from "@/server/db/schema";
import { PageHeader } from "@/components/common/page-header";
import { AreaIcon } from "@/components/knowledge/area-icon";
import { EntryBlogPost, EntryCard, EntryListItem, type EntryViewItem } from "@/components/knowledge/entry-views";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const TYPE_ICONS = { markdown: FileText, image: ImageIcon, video: Video, link: Link2, structured: ListChecks } as const;
const TYPES: ContentType[] = ["markdown", "image", "video", "link", "structured"];

export default async function AreaPage({ params, searchParams }: PageProps<"/knowledge/[slug]">) {
  await requireUser();
  const { slug } = await params;
  const sp = await searchParams;
  const area = await getAreaBySlug(slug);
  if (!area) notFound();
  const type = TYPES.includes(sp.type as ContentType) ? (sp.type as ContentType) : undefined;
  const q = typeof sp.q === "string" ? sp.q : "";
  const [t, tc, format, items, typeCounts] = await Promise.all([
    getTranslations("knowledge"),
    getTranslations("common"),
    getFormatter(),
    listContents({ areaId: area.id, type, query: q || undefined, sort: area.sortMode }),
    countContentsByType(area.id),
  ]);
  const availableTypes = TYPES.filter((tp) => (typeCounts[tp] ?? 0) > 0);
  const hasAnyContent = availableTypes.length > 0;

  const filterHref = (tp?: ContentType) => `/knowledge/${area.slug}${tp ? `?type=${tp}` : ""}${q ? `${tp ? "&" : "?"}q=${encodeURIComponent(q)}` : ""}`;

  const viewItems: { id: string; item: EntryViewItem }[] = items.map((c) => {
    const v = c.version;
    // Entry images and legacy image entries both live on version.mediaId.
    const imageMedia = c.media?.kind === "image" ? c.media : null;
    const thumbSrc = imageMedia
      ? `/api/files/${imageMedia.id}?v=thumb`
      : c.type === "image"
        ? (v?.url ?? undefined)
        : c.type === "link"
          ? v?.meta.preview?.image
          : c.type === "video" && v?.meta.embedId && v.meta.provider === "youtube"
            ? `https://i.ytimg.com/vi/${v.meta.embedId}/hqdefault.jpg`
            : undefined;
    const excerpt = c.type === "link" ? (v?.meta.preview?.description ?? v?.url ?? undefined) : v?.bodyMarkdown?.replace(/[#*_`>\[\]()!-]/g, " ").replace(/\s+/g, " ").trim();
    return {
      id: c.id,
      item: {
        href: `/knowledge/${area.slug}/${c.id}`,
        title: c.title,
        thumbSrc: thumbSrc || undefined,
        fullImageSrc: imageMedia ? `/api/files/${imageMedia.id}` : thumbSrc || undefined,
        excerpt: excerpt || undefined,
        bodyMarkdown: v?.bodyMarkdown ?? undefined,
        author: c.author,
        dateLabel: format.dateTime(c.updatedAt, { dateStyle: "medium" }),
        pinned: c.pinned,
      },
    };
  });
  const hasAnyImage = viewItems.some(({ item }) => !!item.thumbSrc);

  return (
    <div>
      <PageHeader
        title={area.name}
        description={area.purpose}
        actions={
          <Button asChild>
            <Link href={`/knowledge/${area.slug}/new`}>
              <Plus className="size-4" /> {t("newContent")}
            </Link>
          </Button>
        }
      />

      {hasAnyContent && (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1">
            <FilterChip href={filterHref()} active={!type}>
              {t("all")}
            </FilterChip>
            {availableTypes.map((tp) => {
              const Icon = TYPE_ICONS[tp];
              return (
                <FilterChip key={tp} href={filterHref(tp)} active={type === tp}>
                  <Icon className="size-3.5" /> {t(`types.${tp}`)}
                </FilterChip>
              );
            })}
          </div>
          <form className="relative ml-auto" role="search">
            {type && <input type="hidden" name="type" value={type} />}
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input name="q" defaultValue={q} placeholder={t("searchPlaceholder")} className="w-64 pl-8" aria-label={tc("search")} />
          </form>
        </div>
      )}

      {viewItems.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          <AreaIcon icon={area.icon} className="mx-auto mb-3 size-8 opacity-40" />
          {q || type ? t("emptySearch") : t("empty")}
        </div>
      ) : area.layout === "list" ? (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card">
          {viewItems.map(({ id, item }) => (
            <li key={id}>
              <EntryListItem item={item} />
            </li>
          ))}
        </ul>
      ) : area.layout === "blog" ? (
        <div className="mx-auto grid max-w-2xl gap-10">
          {viewItems.map(({ id, item }) => (
            <EntryBlogPost key={id} item={item} pinnedLabel={t("view.pinned")} readMoreLabel={t("view.readMore")} />
          ))}
        </div>
      ) : (
        <ul className={cn("grid gap-3", area.layout === "compact" ? "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" : "sm:grid-cols-2 xl:grid-cols-3")}>
          {viewItems.map(({ id, item }) => (
            <li key={id}>
              <EntryCard item={item} variant={area.layout === "compact" ? "compact" : "grid"} showImageSlot={hasAnyImage} areaIcon={area.icon} pinnedLabel={t("view.pinned")} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterChip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors", active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent")}>
      {children}
    </Link>
  );
}
