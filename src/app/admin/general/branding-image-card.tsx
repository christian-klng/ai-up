"use client";

import { useActionState, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { ImageIcon, Upload } from "lucide-react";
import { removeBrandingImageAction, uploadBrandingImageAction, type AdminFormState } from "@/server/actions/admin-settings";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Props = { kind: "logo" | "favicon"; title: string; hint: string; mediaId: string | null; removeLabel: string; accept: string };

export function BrandingImageCard({ kind, title, hint, mediaId, removeLabel, accept }: Props) {
  const tc = useTranslations("common");
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [removing, startRemove] = useTransition();
  const bound = uploadBrandingImageAction.bind(null, kind);
  const [state, action, pending] = useActionState<AdminFormState, FormData>(bound, { status: "idle" });

  useActionFeedback(state, (s) => {
    if (s.status === "saved") {
      toast.success(tc("saved"));
      router.refresh();
    } else if (s.status === "error") toast.error(tc("unexpectedError"));
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex h-24 items-center justify-center rounded-md border bg-muted/40">
          {mediaId ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/files/${mediaId}`} alt={title} className="max-h-20 max-w-[80%] object-contain" />
          ) : (
            <ImageIcon className="size-8 text-muted-foreground" aria-hidden />
          )}
        </div>
        <form action={action} className="flex flex-wrap gap-2">
          <input ref={ref} type="file" name="file" accept={accept} className="sr-only" onChange={(e) => e.currentTarget.files?.length && e.currentTarget.form?.requestSubmit()} />
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => ref.current?.click()}>
            <Upload className="size-4" /> {tc("edit")}
          </Button>
          {mediaId && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={removing}
              onClick={() =>
                startRemove(async () => {
                  await removeBrandingImageAction(kind);
                  router.refresh();
                })
              }
            >
              {removeLabel}
            </Button>
          )}
        </form>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}
