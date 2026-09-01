"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { FileVideo, Upload, Video, X } from "lucide-react";
import { uploadFile, type UploadedMedia, type UploadError } from "@/lib/upload-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export type MediaInputValue = { mediaId?: string; url?: string };

type Props = {
  kind: "image" | "video";
  value: MediaInputValue | undefined;
  onChange: (value: MediaInputValue | undefined) => void;
  maxUploadMb: number;
  disabled?: boolean;
  invalid?: boolean;
  /** false hides the URL tab – the value is always an uploaded media_files row (e.g. entry images). */
  allowUrl?: boolean;
};

/** Controlled upload-or-URL input for image/video answers (structure fill form). */
export function MediaInput({ kind, value, onChange, maxUploadMb, disabled, invalid, allowUrl = true }: Props) {
  const te = useTranslations("knowledge.editor");
  const [source, setSource] = useState<"upload" | "url">(allowUrl && value?.url && !value.mediaId ? "url" : "upload");
  const [media, setMedia] = useState<UploadedMedia | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setProgress(0);
    try {
      const uploaded = await uploadFile(file, "content", setProgress);
      setMedia(uploaded);
      setSource("upload");
      onChange({ mediaId: uploaded.id });
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

  const clear = () => {
    setMedia(null);
    onChange(undefined);
  };

  return (
    <Tabs
      value={source}
      onValueChange={(v) => {
        setSource(v as "upload" | "url");
        // switching source drops the other variant (exactly one of mediaId/url is allowed)
        if (v === "upload") onChange(media ? { mediaId: media.id } : value?.mediaId ? value : undefined);
        else onChange(value?.url ? { url: value.url } : undefined);
      }}
      className={cn(invalid && "rounded-md ring-1 ring-destructive")}
    >
      {allowUrl && (
        <TabsList>
          <TabsTrigger value="upload">{te("sourceUpload")}</TabsTrigger>
          <TabsTrigger value="url">{te("sourceUrl")}</TabsTrigger>
        </TabsList>
      )}
      <TabsContent value="upload" className="grid gap-3 pt-3">
        <input
          ref={fileRef}
          type="file"
          className="sr-only"
          accept={kind === "image" ? "image/jpeg,image/png,image/webp,image/gif" : "video/mp4,video/webm,video/quicktime"}
          onChange={(e) => e.currentTarget.files?.[0] && void handleFile(e.currentTarget.files[0])}
        />
        {value?.mediaId ? (
          <div className="flex flex-wrap items-center gap-3 rounded-md border p-3">
            {media?.kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={media.thumbUrl ?? media.url} alt="" className="size-16 rounded object-cover" />
            ) : kind === "image" ? (
              // existing upload from a previous version: only the id is known
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/files/${value.mediaId}?v=thumb`} alt="" className="size-16 rounded object-cover" />
            ) : (
              <FileVideo className="size-8 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1 text-sm">
              <div className="truncate font-medium">{media ? te("uploaded", { name: media.originalName }) : te("uploadedExisting")}</div>
              {media && (
                <div className="text-muted-foreground">
                  {media.mime} · {(media.size / 1024 / 1024).toFixed(1)} MB{media.width ? ` · ${media.width}×${media.height}` : ""}
                </div>
              )}
            </div>
            <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={clear}>
              <X className="size-4" /> {te("removeFile")}
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={disabled || progress !== null}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) void handleFile(f);
            }}
            className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed p-8 text-sm text-muted-foreground transition-colors hover:bg-accent/40"
          >
            {kind === "image" ? <Upload className="size-6" /> : <Video className="size-6" />}
            {progress !== null ? te("uploading", { percent: Math.round(progress * 100) }) : kind === "image" ? te("uploadImage") : te("uploadVideo")}
            {progress !== null && (
              <span className="h-1.5 w-48 overflow-hidden rounded bg-muted">
                <span className="block h-full bg-primary transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
              </span>
            )}
          </button>
        )}
      </TabsContent>
      <TabsContent value="url" className="grid gap-2 pt-3">
        <Input
          type="url"
          value={value?.url ?? ""}
          onChange={(e) => onChange(e.target.value.trim() ? { url: e.target.value } : undefined)}
          placeholder={te("urlPlaceholder")}
          disabled={disabled}
        />
      </TabsContent>
    </Tabs>
  );
}
