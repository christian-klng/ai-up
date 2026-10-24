"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Copy, ExternalLink, Eye, History, ImagePlus, Plus, Trash2, TriangleAlert } from "lucide-react";
import { uploadFile, type UploadError } from "@/lib/upload-client";
import {
  createSitePageAction,
  deleteSitePageAction,
  moveSitePageAction,
  restoreLandingVersionAction,
  setPageEnabledAction,
  updateSitePageAction,
  type PageKey,
  type SitePageActionResult,
} from "@/server/actions/admin-landing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Community } from "@/server/db/schema";
import type { PostFeed } from "@/server/domain/posts";
import type { LandingDefinition } from "@/lib/landing-schema";
import { PAGE_SLUG_MAX, PAGE_TITLE_MAX, SITE_PAGE_KINDS, pageSlugProblem, type SitePageKind } from "@/lib/site-pages";
import { slugify } from "@/lib/slug";
import { LandingEditor } from "./landing-editor";

type VersionRow = { id: string; version: number; source: string; changeNote: string | null; createdAt: string; changedByName: string | null };
type MediaRow = { id: string; originalName: string; width: number | null; height: number | null; size: number; createdAt: string };

export type PageState = {
  key: PageKey;
  url: string;
  enabled: boolean;
  /** Set for custom pages */
  custom: { id: string; slug: string; title: string; showInNav: boolean; slugReserved: boolean } | null;
  definition: LandingDefinition | null;
  currentVersion: number | null;
  versions: VersionRow[];
  posts: Record<string, PostFeed>;
};

function tabValue(page: PageState): string {
  return "fixed" in page.key ? page.key.fixed : `custom-${page.key.customId}`;
}

/** Messages for the error codes of the custom page actions. */
function useSitePageError() {
  const t = useTranslations("admin.landing");
  const tc = useTranslations("common");
  return (res: SitePageActionResult) => {
    if (res.status !== "error") return;
    switch (res.error) {
      case "page_limit":
        return toast.error(t("errorLimit"));
      case "slug_invalid":
        return toast.error(t("errorSlugInvalid"));
      case "slug_reserved":
        return toast.error(t("errorSlugReserved"));
      case "slug_taken":
        return toast.error(t("errorSlugTaken"));
      case "title_invalid":
        return toast.error(t("errorTitle", { max: PAGE_TITLE_MAX }));
      default:
        return toast.error(tc("unexpectedError"));
    }
  };
}

export function LandingAdmin({
  pages,
  maxCustomPages,
  settings,
  media,
  eventsUrl,
  nav,
}: {
  pages: PageState[];
  maxCustomPages: number;
  settings: Community;
  media: MediaRow[];
  eventsUrl: string | null;
  nav: { title: string; href: string }[];
}) {
  const t = useTranslations("admin.landing");
  const tc = useTranslations("common");
  const format = useFormatter();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  /** Freshly uploaded image – marked in the gallery so a successful upload is visible at a glance. */
  const [highlight, setHighlight] = useState<string | null>(null);
  const [editorTab, setEditorTab] = useState<string | null>(null);
  const [tab, setTab] = useState("landing");
  const [adding, setAdding] = useState(false);

  const customCount = pages.filter((p) => p.custom).length;
  const atLimit = customCount >= maxCustomPages;

  const toggle = (key: PageKey, next: boolean) => {
    startTransition(async () => {
      const res = await setPageEnabledAction(key, next);
      if (res.status === "saved") {
        toast.success(tc("saved"));
        router.refresh();
      } else toast.error(tc("unexpectedError"));
    });
  };

  const restore = (key: PageKey, version: number) => {
    if (!confirm(t("confirmRestore", { version }))) return;
    startTransition(async () => {
      const res = await restoreLandingVersionAction(key, version);
      if (res.status === "saved") {
        toast.success(tc("saved"));
        router.refresh();
      } else toast.error(tc("unexpectedError"));
    });
  };

  const onUpload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const uploaded = await uploadFile(file, "landing");
      toast.success(t("imageUploaded"));
      setHighlight(uploaded.id);
      router.refresh();
    } catch (e) {
      const err = e as UploadError;
      if (err.code === "too_large") toast.error(t("imageTooLarge", { mb: Math.round((err.maxBytes ?? 0) / 1024 / 1024) }));
      else if (err.code === "unsupported_type") toast.error(t("imageUnsupported"));
      else toast.error(tc("unexpectedError"));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const fixedLabel: Record<string, string> = { landing: t("tabLanding"), imprint: t("tabImprint"), privacy: t("tabPrivacy") };
  const label = (page: PageState) => (page.custom ? page.custom.title : fixedLabel["fixed" in page.key ? page.key.fixed : ""]);
  const editorPage = pages.find((p) => tabValue(p) === editorTab);

  return (
    <div className="grid gap-6">
      {editorPage?.definition && (
        <LandingEditor
          page={editorPage.key}
          title={label(editorPage)}
          onOpenChange={() => setEditorTab(null)}
          definition={editorPage.definition}
          settings={settings}
          eventsUrl={eventsUrl}
          nav={nav}
          posts={editorPage.posts}
        />
      )}
      {adding && (
        <AddPageDialog
          onClose={() => setAdding(false)}
          onCreated={(id) => {
            setAdding(false);
            setTab(`custom-${id}`);
            router.refresh();
          }}
        />
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <div className="flex flex-wrap items-center gap-2">
          <TabsList className="h-auto flex-wrap">
            {pages.map((page) => (
              <TabsTrigger key={tabValue(page)} value={tabValue(page)} className="gap-1.5">
                {label(page)}
                {page.custom?.slugReserved && <TriangleAlert className="size-3.5 text-destructive" aria-label={t("slugReservedBadge")} />}
              </TabsTrigger>
            ))}
          </TabsList>
          <Button variant="outline" size="sm" onClick={() => setAdding(true)} disabled={atLimit} title={atLimit ? t("limitReached", { max: maxCustomPages }) : undefined}>
            <Plus className="size-4" /> {t("addPage")}
          </Button>
          <span className="text-xs text-muted-foreground">{t("customCount", { count: customCount, max: maxCustomPages })}</span>
        </div>
        {pages.map((page, index) => {
          const value = tabValue(page);
          return (
            <TabsContent key={value} value={value} className="mt-4 grid gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t("statusTitle")}</CardTitle>
                  <CardDescription>{page.definition ? t("statusHint", { version: page.currentVersion ?? 0, url: page.url }) : t("noContentYet")}</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                  {page.custom?.slugReserved && <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">{t("slugReservedHint", { slug: page.custom.slug })}</p>}
                  <div className="flex items-center gap-3">
                    <Switch
                      id={`page-enabled-${value}`}
                      checked={page.enabled}
                      onCheckedChange={(next) => toggle(page.key, next)}
                      disabled={pending || (!page.definition && !page.enabled)}
                    />
                    <Label htmlFor={`page-enabled-${value}`}>{t("enablePage", { url: page.url })}</Label>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" disabled={!page.definition} onClick={() => setEditorTab(value)}>
                      <Eye className="size-4" /> {t("preview")}
                    </Button>
                    {page.enabled && (
                      <Button asChild variant="outline" size="sm">
                        <Link href={page.url} target="_blank">
                          <ExternalLink className="size-4" /> {t("viewPublic")}
                        </Link>
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{page.custom ? t("mcpHintCustom", { slug: page.custom.slug }) : t("mcpHint")}</p>
                </CardContent>
              </Card>

              {page.custom && (
                <SitePageSettings
                  key={`${page.custom.id}-${page.custom.slug}-${page.custom.title}-${page.custom.showInNav}`}
                  page={page.custom}
                  isFirst={index === pages.findIndex((p) => p.custom)}
                  isLast={index === pages.length - 1}
                  onDeleted={() => {
                    setTab("landing");
                    router.refresh();
                  }}
                />
              )}

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <History className="size-4" /> {t("historyTitle")}
                  </CardTitle>
                  <CardDescription>{t("historyHint")}</CardDescription>
                </CardHeader>
                <CardContent>
                  {page.versions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("noContentYet")}</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("version")}</TableHead>
                          <TableHead>{t("date")}</TableHead>
                          <TableHead>{t("source")}</TableHead>
                          <TableHead>{t("editor")}</TableHead>
                          <TableHead>{t("note")}</TableHead>
                          <TableHead />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {page.versions.map((v) => (
                          <TableRow key={v.id}>
                            <TableCell>v{v.version}</TableCell>
                            <TableCell className="whitespace-nowrap">{format.dateTime(new Date(v.createdAt), { dateStyle: "medium", timeStyle: "short" })}</TableCell>
                            <TableCell>
                              <Badge variant={v.source === "mcp" ? "default" : "secondary"}>{v.source}</Badge>
                            </TableCell>
                            <TableCell>{v.changedByName ?? "–"}</TableCell>
                            <TableCell className="max-w-56 truncate text-muted-foreground" title={v.changeNote ?? undefined}>
                              {v.changeNote ?? "–"}
                            </TableCell>
                            <TableCell className="text-right">
                              {v.version !== page.currentVersion && (
                                <Button variant="ghost" size="sm" disabled={pending} onClick={() => restore(page.key, v.version)}>
                                  {t("restore")}
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          );
        })}
      </Tabs>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("imagesTitle")} {media.length > 0 && <span className="font-normal text-muted-foreground">({media.length})</span>}
          </CardTitle>
          <CardDescription>{t("imagesHint")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div>
            <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(e) => onUpload(e.target.files?.[0])} />
            <Button variant="outline" size="sm" disabled={uploading} onClick={() => fileInput.current?.click()}>
              <ImagePlus className="size-4" /> {uploading ? t("uploading") : t("uploadImage")}
            </Button>
          </div>
          {media.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noImages")}</p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {media.map((m) => (
                <li key={m.id} className={`overflow-hidden rounded-md border ${m.id === highlight ? "ring-2 ring-primary" : ""}`}>
                  <a href={`/api/files/${m.id}`} target="_blank" rel="noreferrer" title={t("openImage")} className="block bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/files/${m.id}?v=thumb`} alt={m.originalName} loading="lazy" className="aspect-video w-full object-contain" />
                  </a>
                  <div className="flex items-start gap-1 p-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm" title={m.originalName}>
                        {m.originalName}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[m.width && m.height ? `${m.width}×${m.height}` : null, formatBytes(m.size), format.dateTime(new Date(m.createdAt), { dateStyle: "short" })]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0"
                      aria-label={t("copyId")}
                      title={t("copyId")}
                      onClick={() => {
                        navigator.clipboard.writeText(m.id);
                        toast.success(t("idCopied"));
                      }}
                    >
                      <Copy className="size-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Address, title, navigation, order and deletion of one custom page. */
function SitePageSettings({
  page,
  isFirst,
  isLast,
  onDeleted,
}: {
  page: NonNullable<PageState["custom"]>;
  isFirst: boolean;
  isLast: boolean;
  onDeleted: () => void;
}) {
  const t = useTranslations("admin.landing");
  const tc = useTranslations("common");
  const router = useRouter();
  const showError = useSitePageError();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(page.title);
  const [slug, setSlug] = useState(page.slug);
  const dirty = title !== page.title || slug !== page.slug;
  const slugProblem = slug !== page.slug ? pageSlugProblem(slug) : null;

  const run = (action: () => Promise<SitePageActionResult>, after?: () => void) =>
    startTransition(async () => {
      const res = await action();
      if (res.status === "saved") {
        toast.success(tc("saved"));
        if (after) after();
        else router.refresh();
      } else showError(res);
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("settingsTitle")}</CardTitle>
        <CardDescription>{t("settingsHint")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor={`title-${page.id}`}>{t("fieldTitle")}</Label>
            <Input id={`title-${page.id}`} value={title} maxLength={PAGE_TITLE_MAX} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`slug-${page.id}`}>{t("fieldSlug")}</Label>
            <div className="flex items-center gap-1">
              <span className="text-sm text-muted-foreground">/</span>
              <Input id={`slug-${page.id}`} value={slug} maxLength={PAGE_SLUG_MAX} onChange={(e) => setSlug(e.target.value.toLowerCase())} />
            </div>
            {slugProblem && <p className="text-xs text-destructive">{slugProblem === "reserved" ? t("errorSlugReserved") : t("errorSlugInvalid")}</p>}
            {!slugProblem && slug !== page.slug && <p className="text-xs text-muted-foreground">{t("slugChangeHint")}</p>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={!dirty || Boolean(slugProblem) || pending} onClick={() => run(() => updateSitePageAction(page.id, { title, slug }))}>
            {tc("save")}
          </Button>
        </div>
        <div className="flex items-center gap-3">
          <Switch id={`nav-${page.id}`} checked={page.showInNav} disabled={pending} onCheckedChange={(next) => run(() => updateSitePageAction(page.id, { showInNav: next }))} />
          <Label htmlFor={`nav-${page.id}`}>{t("showInNav")}</Label>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          <Button variant="outline" size="sm" disabled={isFirst || pending} onClick={() => run(() => moveSitePageAction(page.id, "up"))}>
            <ArrowUp className="size-4" /> {t("moveUp")}
          </Button>
          <Button variant="outline" size="sm" disabled={isLast || pending} onClick={() => run(() => moveSitePageAction(page.id, "down"))}>
            <ArrowDown className="size-4" /> {t("moveDown")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto text-destructive hover:text-destructive"
            disabled={pending}
            onClick={() => {
              if (confirm(t("confirmDelete", { title: page.title }))) run(() => deleteSitePageAction(page.id), onDeleted);
            }}
          >
            <Trash2 className="size-4" /> {t("deletePage")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** New custom page: kind, title, address, navigation. */
function AddPageDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const t = useTranslations("admin.landing");
  const tc = useTranslations("common");
  const showError = useSitePageError();
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<SitePageKind>("blank");
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [showInNav, setShowInNav] = useState(true);
  const effectiveSlug = slugTouched ? slug : title.trim() ? slugify(title) : "";
  const slugProblem = effectiveSlug ? pageSlugProblem(effectiveSlug) : null;

  const submit = () =>
    startTransition(async () => {
      const res = await createSitePageAction({ kind, title, slug: effectiveSlug, showInNav });
      if (res.status === "saved" && res.id) {
        toast.success(t("pageCreated"));
        onCreated(res.id);
      } else showError(res);
    });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("addPageTitle")}</DialogTitle>
          <DialogDescription>{t("addPageHint")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label>{t("fieldKind")}</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as SitePageKind)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SITE_PAGE_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {t(`kind.${k}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t(`kindHint.${kind}`)}</p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="new-page-title">{t("fieldTitle")}</Label>
            <Input id="new-page-title" value={title} maxLength={PAGE_TITLE_MAX} autoFocus onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="new-page-slug">{t("fieldSlug")}</Label>
            <div className="flex items-center gap-1">
              <span className="text-sm text-muted-foreground">/</span>
              <Input
                id="new-page-slug"
                value={effectiveSlug}
                maxLength={PAGE_SLUG_MAX}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value.toLowerCase());
                }}
              />
            </div>
            {slugProblem && <p className="text-xs text-destructive">{slugProblem === "reserved" ? t("errorSlugReserved") : t("errorSlugInvalid")}</p>}
          </div>
          <div className="flex items-center gap-3">
            <Switch id="new-page-nav" checked={showInNav} onCheckedChange={setShowInNav} />
            <Label htmlFor="new-page-nav">{t("showInNav")}</Label>
          </div>
          <p className="text-xs text-muted-foreground">{t("createdOffHint")}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {tc("cancel")}
          </Button>
          <Button onClick={submit} disabled={pending || !title.trim() || !effectiveSlug || Boolean(slugProblem)}>
            {t("createPage")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
