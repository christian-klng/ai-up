"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Copy, ExternalLink, Eye, History, ImagePlus } from "lucide-react";
import { uploadFile } from "@/lib/upload-client";
import { restoreLandingVersionAction, setLandingEnabledAction } from "@/server/actions/admin-landing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AppSettings } from "@/server/db/schema";
import type { LandingDefinition } from "@/lib/landing-schema";
import { LandingEditor } from "./landing-editor";

type VersionRow = { id: string; version: number; source: string; changeNote: string | null; createdAt: string; changedByName: string | null };
type MediaRow = { id: string; originalName: string; width: number | null; height: number | null };

export function LandingAdmin({
  enabled,
  definition,
  settings,
  currentVersion,
  versions,
  media,
}: {
  enabled: boolean;
  definition: LandingDefinition | null;
  settings: AppSettings;
  currentVersion: number | null;
  versions: VersionRow[];
  media: MediaRow[];
}) {
  const hasDefinition = definition !== null;
  const t = useTranslations("admin.landing");
  const tc = useTranslations("common");
  const format = useFormatter();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);

  const toggle = (next: boolean) => {
    startTransition(async () => {
      const res = await setLandingEnabledAction(next);
      if (res.status === "saved") {
        toast.success(tc("saved"));
        router.refresh();
      } else toast.error(tc("unexpectedError"));
    });
  };

  const restore = (version: number) => {
    if (!confirm(t("confirmRestore", { version }))) return;
    startTransition(async () => {
      const res = await restoreLandingVersionAction(version);
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
      await uploadFile(file, "landing");
      toast.success(t("imageUploaded"));
      router.refresh();
    } catch {
      toast.error(tc("unexpectedError"));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  return (
    <div className="grid gap-6">
      {editorOpen && definition && <LandingEditor onOpenChange={setEditorOpen} definition={definition} settings={settings} />}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("statusTitle")}</CardTitle>
          <CardDescription>{hasDefinition ? t("statusHint", { version: currentVersion ?? 0 }) : t("noContentYet")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex items-center gap-3">
            <Switch id="landing-enabled" checked={enabled} onCheckedChange={toggle} disabled={pending || (!hasDefinition && !enabled)} />
            <Label htmlFor="landing-enabled">{t("enableLabel")}</Label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={!hasDefinition} onClick={() => setEditorOpen(true)}>
              <Eye className="size-4" /> {t("preview")}
            </Button>
            {enabled && (
              <Button asChild variant="outline" size="sm">
                <Link href="/" target="_blank">
                  <ExternalLink className="size-4" /> {t("viewPublic")}
                </Link>
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{t("mcpHint")}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("imagesTitle")}</CardTitle>
          <CardDescription>{t("imagesHint")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div>
            <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(e) => onUpload(e.target.files?.[0])} />
            <Button variant="outline" size="sm" disabled={uploading} onClick={() => fileInput.current?.click()}>
              <ImagePlus className="size-4" /> {uploading ? t("uploading") : t("uploadImage")}
            </Button>
          </div>
          {media.length > 0 && (
            <ul className="grid gap-2 sm:grid-cols-2">
              {media.map((m) => (
                <li key={m.id} className="flex items-center gap-2 rounded-md border p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/files/${m.id}`} alt={m.originalName} className="size-10 shrink-0 rounded object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{m.originalName}</p>
                    <p className="truncate font-mono text-xs text-muted-foreground">{m.id}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("copyId")}
                    onClick={() => {
                      navigator.clipboard.writeText(m.id);
                      toast.success(t("idCopied"));
                    }}
                  >
                    <Copy className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="size-4" /> {t("historyTitle")}
          </CardTitle>
          <CardDescription>{t("historyHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          {versions.length === 0 ? (
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
                {versions.map((v) => (
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
                      {v.version !== currentVersion && (
                        <Button variant="ghost" size="sm" disabled={pending} onClick={() => restore(v.version)}>
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
    </div>
  );
}
