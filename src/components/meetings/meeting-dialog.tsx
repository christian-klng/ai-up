"use client";

import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ImagePlus, Plus, X } from "lucide-react";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { uploadFile } from "@/lib/upload-client";
import { saveMeetingAction, type MeetingFormState } from "@/server/actions/meetings";
import type { MeetingKind } from "@/server/db/schema";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { MeetingKindIcon } from "./meeting-badges";
import { cn } from "@/lib/utils";

export type MeetingFormValues = { id: string; title: string; description: string | null; kind: MeetingKind; startsAt: string | null; recordingEnabled: boolean; status: "scheduled" | "live" | "ended"; coverMediaId: string | null };

/** Selectable kinds. "protocol" (minutes without a call) is legacy: no longer offered, but an existing
 *  protocol meeting keeps its kind and still shows it while editing. */
const KINDS: MeetingKind[] = ["audio", "video"];

/** Local datetime-local value from an ISO string (keeps the user's timezone). */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `canSetCover`: admins only – cover images are publicly served (OpenGraph) and uploaded with purpose "meeting". */
export function MeetingDialog({ spaceId, recordingDefault, meeting, trigger, callsAvailable, canSetCover = false }: { spaceId: string; recordingDefault: boolean; meeting?: MeetingFormValues; trigger?: React.ReactNode; callsAvailable: boolean; canSetCover?: boolean }) {
  const t = useTranslations("meetings");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [cover, setCover] = useState<string | null>(meeting?.coverMediaId ?? null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const onCoverUpload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const media = await uploadFile(file, "meeting");
      setCover(media.id);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      toast.error(code === "too_large" ? t("cover.tooLarge") : code === "unsupported_type" ? t("cover.unsupported") : tc("unexpectedError"));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  const [kind, setKind] = useState<MeetingKind>(meeting?.kind ?? "video");
  const kinds = meeting?.kind === "protocol" ? (["protocol", ...KINDS] as MeetingKind[]) : KINDS;
  const [startsAt, setStartsAt] = useState(toLocalInput(meeting?.startsAt ?? null));
  const [state, action, pending] = useActionState<MeetingFormState, FormData>(saveMeetingAction, { status: "idle" });
  const isEdit = !!meeting;
  useActionFeedback(state, (s) => {
    if (s.status === "saved") {
      toast.success(tc("saved"));
      setOpen(false);
      router.push(`/meetings/${s.spaceSlug}/${s.meetingId}`);
      router.refresh();
    } else if (s.status === "error") toast.error(s.code === "unexpected" ? tc("unexpectedError") : t(`errors.${s.code}`));
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="size-4" /> {t("create")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <form action={action} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{isEdit ? t("edit") : t("create")}</DialogTitle>
            <DialogDescription>{t("dialogIntro")}</DialogDescription>
          </DialogHeader>
          <input type="hidden" name="spaceId" value={spaceId} />
          {meeting && <input type="hidden" name="meetingId" value={meeting.id} />}
          <input type="hidden" name="kind" value={kind} />
          {/* startsAt is sent as ISO so the server does not depend on the browser's timezone format */}
          <input type="hidden" name="startsAt" value={startsAt ? new Date(startsAt).toISOString() : ""} />

          <div className="grid gap-2">
            <Label>{t("kind")}</Label>
            <div className={cn("grid gap-2", kinds.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
              {kinds.map((k) => {
                const disabled = (isEdit && meeting.status !== "scheduled") || (k !== "protocol" && !callsAvailable);
                return (
                  <button key={k} type="button" disabled={disabled} aria-pressed={kind === k} onClick={() => setKind(k)} className={cn("flex items-start gap-2 rounded-lg border p-3 text-left transition-colors hover:bg-accent/60 disabled:cursor-not-allowed disabled:opacity-50", kind === k && "border-primary bg-primary/5")}>
                    <MeetingKindIcon kind={k} className={cn("mt-0.5 shrink-0", kind === k ? "text-primary" : "text-muted-foreground")} />
                    <span>
                      <span className="block text-sm font-medium">{t(`kinds.${k}`)}</span>
                      <span className="block text-xs text-muted-foreground">{t(`kindHints.${k}`)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            {!callsAvailable && <p className="text-xs text-muted-foreground">{t("callsUnavailable")}</p>}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="m-title">{t("titleLabel")}</Label>
            <Input id="m-title" name="title" defaultValue={meeting?.title ?? ""} required maxLength={200} placeholder={t("titlePlaceholder")} autoFocus />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="m-desc">{t("descriptionLabel")}</Label>
            <Textarea id="m-desc" name="description" defaultValue={meeting?.description ?? ""} rows={3} maxLength={4000} placeholder={t("descriptionPlaceholder")} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="m-starts">{t("startsAt")}</Label>
            <Input id="m-starts" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className="max-w-64" />
            <p className="text-xs text-muted-foreground">{t("startsAtHint")}</p>
          </div>
          {canSetCover && (
            <div className="grid gap-2">
              <Label>{t("cover.label")}</Label>
              <input type="hidden" name="coverMediaId" value={cover ?? ""} />
              <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(e) => void onCoverUpload(e.target.files?.[0])} />
              {cover ? (
                <div className="relative overflow-hidden rounded-md border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/files/${cover}`} alt="" className="aspect-[1200/630] w-full object-cover" />
                  <div className="absolute right-2 top-2 flex gap-1">
                    <Button type="button" variant="secondary" size="sm" disabled={uploading} onClick={() => fileInput.current?.click()}>
                      <ImagePlus className="size-4" /> {uploading ? t("cover.uploading") : t("cover.replace")}
                    </Button>
                    <Button type="button" variant="secondary" size="icon" aria-label={t("cover.remove")} title={t("cover.remove")} onClick={() => setCover(null)}>
                      <X className="size-4" />
                    </Button>
                  </div>
                </div>
              ) : (
                <div>
                  <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileInput.current?.click()}>
                    <ImagePlus className="size-4" /> {uploading ? t("cover.uploading") : t("cover.upload")}
                  </Button>
                </div>
              )}
              <p className="text-xs text-muted-foreground">{t("cover.hint")}</p>
            </div>
          )}
          {kind !== "protocol" && (
            <div className="flex items-start gap-3">
              <Switch id="m-rec" name="recordingEnabled" defaultChecked={meeting?.recordingEnabled ?? recordingDefault} />
              <div className="grid gap-0.5">
                <Label htmlFor="m-rec">{t("recordingEnabled")}</Label>
                <p className="text-xs text-muted-foreground">{t("recordingEnabledHint")}</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={pending || uploading}>
              {isEdit ? tc("save") : t("createSubmit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
