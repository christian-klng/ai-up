"use client";

import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Upload, Video, X } from "lucide-react";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { saveContentAction, type ContentFormState } from "@/server/actions/content";
import { uploadFile, type UploadedMedia, type UploadError } from "@/lib/upload-client";
import type { ContentType } from "@/server/db/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Markdown } from "./markdown";

export type ContentEditorInitial = {
  contentId: string;
  type: ContentType;
  title: string;
  body: string;
  url: string;
  alt: string;
  media: UploadedMedia | null;
};

type Props = {
  areaId: string;
  areaSlug: string;
  initial: ContentEditorInitial;
  maxUploadMb: number;
};

/**
 * Editor for legacy free-type entries (markdown/image/video/link). Creation
 * goes exclusively through templates; this keeps pre-template entries editable.
 */
export function ContentEditor({ areaId, areaSlug, initial, maxUploadMb }: Props) {
  const te = useTranslations("knowledge.editor");
  const tc = useTranslations("common");
  const router = useRouter();

  const type = initial.type;
  const [body, setBody] = useState(initial.body);
  const [media, setMedia] = useState<UploadedMedia | null>(initial.media);
  const [source, setSource] = useState<"upload" | "url">(initial.url && !initial.media ? "url" : "upload");
  const [progress, setProgress] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [state, action, pending] = useActionState<ContentFormState, FormData>(saveContentAction, { status: "idle" });
  useActionFeedback(state, (s) => {
    if (s.status === "saved") {
      toast.success(te("saved"));
      router.push(`/knowledge/${s.areaSlug}/${s.contentId}`);
      router.refresh();
    } else if (s.status === "error") {
      toast.error(s.code === "unexpected" ? tc("unexpectedError") : te(`errors.${s.code}`));
    }
  });

  async function handleFile(file: File) {
    setProgress(0);
    try {
      const uploaded = await uploadFile(file, "content", setProgress);
      setMedia(uploaded);
      setSource("upload");
    } catch (e) {
      const err = e as UploadError;
      if (err.code === "too_large") toast.error(te("errors.tooLarge", { mb: Math.round((err.maxBytes ?? maxUploadMb * 1024 * 1024) / 1024 / 1024) }));
      else if (err.code === "unsupported_type") toast.error(te("errors.unsupported"));
      else toast.error(te("errors.uploadFailed"));
    } finally {
      setProgress(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const needsMedia = type === "image" || type === "video";

  return (
    <form action={action} className="grid gap-6">
      <input type="hidden" name="areaId" value={areaId} />
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="contentId" value={initial.contentId} />
      {needsMedia && source === "upload" && media && <input type="hidden" name="mediaId" value={media.id} />}

      <div className="grid gap-2">
        <Label htmlFor="title">{te("titleLabel")}</Label>
        <Input id="title" name="title" defaultValue={initial.title} required maxLength={200} placeholder={te("titlePlaceholder")} />
      </div>

      {needsMedia && (
        <Card>
          <CardContent className="grid gap-4 pt-6">
            <Tabs value={source} onValueChange={(v) => setSource(v as "upload" | "url")}>
              <TabsList>
                <TabsTrigger value="upload">{te("sourceUpload")}</TabsTrigger>
                <TabsTrigger value="url">{te("sourceUrl")}</TabsTrigger>
              </TabsList>
              <TabsContent value="upload" className="grid gap-3 pt-3">
                <input
                  ref={fileRef}
                  type="file"
                  className="sr-only"
                  accept={type === "image" ? "image/jpeg,image/png,image/webp,image/gif" : "video/mp4,video/webm,video/quicktime"}
                  onChange={(e) => e.currentTarget.files?.[0] && void handleFile(e.currentTarget.files[0])}
                />
                {media ? (
                  <div className="flex flex-wrap items-center gap-3 rounded-md border p-3">
                    {media.kind === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={media.thumbUrl ?? media.url} alt="" className="size-16 rounded object-cover" />
                    ) : (
                      <Video className="size-8 text-muted-foreground" />
                    )}
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="truncate font-medium">{te("uploaded", { name: media.originalName })}</div>
                      <div className="text-muted-foreground">
                        {media.mime} · {(media.size / 1024 / 1024).toFixed(1)} MB{media.width ? ` · ${media.width}×${media.height}` : ""}
                      </div>
                    </div>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setMedia(null)}>
                      <X className="size-4" /> {te("removeFile")}
                    </Button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={progress !== null}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const f = e.dataTransfer.files?.[0];
                      if (f) void handleFile(f);
                    }}
                    className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed p-8 text-sm text-muted-foreground transition-colors hover:bg-accent/40"
                  >
                    <Upload className="size-6" />
                    {progress !== null ? te("uploading", { percent: Math.round(progress * 100) }) : type === "image" ? te("uploadImage") : te("uploadVideo")}
                    {progress !== null && (
                      <span className="h-1.5 w-48 overflow-hidden rounded bg-muted">
                        <span className="block h-full bg-primary transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
                      </span>
                    )}
                  </button>
                )}
              </TabsContent>
              <TabsContent value="url" className="grid gap-2 pt-3">
                <Label htmlFor="url">{type === "image" ? te("imageUrlLabel") : te("videoUrlLabel")}</Label>
                <Input id="url" name={source === "url" ? "url" : undefined} type="url" defaultValue={initial.url} placeholder={te("urlPlaceholder")} />
              </TabsContent>
            </Tabs>
            {type === "image" && (
              <div className="grid gap-2">
                <Label htmlFor="alt">{te("altLabel")}</Label>
                <Input id="alt" name="alt" defaultValue={initial.alt} maxLength={500} />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {type === "link" && (
        <div className="grid gap-2">
          <Label htmlFor="url">{te("urlLabel")}</Label>
          <Input id="url" name="url" type="url" required defaultValue={initial.url} placeholder={te("urlPlaceholder")} />
        </div>
      )}

      <div className="grid gap-2">
        <Label htmlFor="body">{type === "markdown" ? te("bodyLabel") : te("noteLabel")}</Label>
        <Tabs defaultValue="write">
          <TabsList>
            <TabsTrigger value="write">{te("write")}</TabsTrigger>
            <TabsTrigger value="preview">{te("preview")}</TabsTrigger>
          </TabsList>
          <TabsContent value="write" className="pt-2">
            <Textarea id="body" name="body" value={body} onChange={(e) => setBody(e.target.value)} rows={type === "markdown" ? 16 : 5} placeholder={te("bodyPlaceholder")} className="font-mono text-sm leading-relaxed" />
          </TabsContent>
          <TabsContent value="preview" className="pt-2">
            <div className="min-h-32 rounded-md border p-4">{body.trim() ? <Markdown>{body}</Markdown> : <p className="text-sm text-muted-foreground">{te("nothingToPreview")}</p>}</div>
          </TabsContent>
        </Tabs>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="changeNote">{te("changeNoteLabel")}</Label>
        <Input id="changeNote" name="changeNote" maxLength={500} placeholder={te("changeNotePlaceholder")} />
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending || progress !== null}>
          {te("save")}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.push(`/knowledge/${areaSlug}/${initial.contentId}`)}>
          {tc("cancel")}
        </Button>
      </div>
    </form>
  );
}
