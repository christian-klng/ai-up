import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { FileText, Image as ImageIcon, Link2, ListChecks, Pin, Plus, Search, Video } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { countContentsByType, getAreaBySlug, listContents } from "@/server/domain/knowledge";
import type { ContentType } from "@/server/db/schema";
import { PageHeader } from "@/components/common/page-header";
import { AreaIcon } from "@/components/knowledge/area-icon";
import { UserAvatar } from "@/components/shell/user-avatar";
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
    listContents({ areaId: area.id, type, query: q || undefined }),
    countContentsByType(area.id),
  ]);
  const availableTypes = TYPES.filter((tp) => (typeCounts[tp] ?? 0) > 0);
  const hasAnyContent = availableTypes.length > 0;

  const filterHref = (tp?: ContentType) => `/knowledge/${area.slug}${tp ? `?type=${tp}` : ""}${q ? `${tp ? "&" : "?"}q=${encodeURIComponent(q)}` : ""}`;

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

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          <AreaIcon icon={area.icon} className="mx-auto mb-3 size-8 opacity-40" />
          {q || type ? t("emptySearch") : t("empty")}
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((c) => {
            const Icon = TYPE_ICONS[c.type];
            const v = c.version;
            const thumb = c.type === "image" ? (c.media ? `/api/files/${c.media.id}?v=thumb` : v?.url) : c.type === "link" ? v?.meta.preview?.image : c.type === "video" && v?.meta.embedId && v.meta.provider === "youtube" ? `https://i.ytimg.com/vi/${v.meta.embedId}/hqdefault.jpg` : undefined;
            const excerpt = c.type === "link" ? v?.meta.preview?.description ?? v?.url : v?.bodyMarkdown?.replace(/[#*_`>\[\]()!-]/g, " ").replace(/\s+/g, " ").trim();
            return (
              <li key={c.id}>
                <Link href={`/knowledge/${area.slug}/${c.id}`} className="group flex h-full flex-col overflow-hidden rounded-lg border bg-card transition-colors hover:bg-accent/40">
                  {thumb && (
                    <span className="block aspect-[16/9] w-full overflow-hidden bg-muted">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={thumb} alt="" className="size-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
                    </span>
                  )}
                  <span className="flex flex-1 flex-col gap-2 p-4">
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Icon className="size-3.5" /> {t(`types.${c.type}`)}
                      {c.pinned && (
                        <span className="ml-auto inline-flex items-center gap-1 text-primary">
                          <Pin className="size-3" /> {t("view.pinned")}
                        </span>
                      )}
                    </span>
                    <span className="line-clamp-2 font-medium group-hover:underline">{c.title}</span>
                    {excerpt && <span className="line-clamp-3 text-sm text-muted-foreground">{excerpt}</span>}
                    <span className="mt-auto flex items-center gap-2 pt-2 text-xs text-muted-foreground">
                      {c.author && <UserAvatar user={c.author} size={20} variant="thumb" />}
                      <span className="truncate">{c.author?.name}</span>
                      <span className="ml-auto shrink-0">{format.dateTime(c.updatedAt, { dateStyle: "medium" })}</span>
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
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
