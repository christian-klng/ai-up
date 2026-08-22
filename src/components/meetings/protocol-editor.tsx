"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { saveProtocolAction, type ProtocolFormState } from "@/server/actions/meetings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Markdown } from "@/components/content/markdown";

/** Shared minutes: markdown with preview; every save creates a version. */
export function ProtocolEditor({ meetingId, initialBody, version }: { meetingId: string; initialBody: string; version: number }) {
  const t = useTranslations("meetings.protocol");
  const tc = useTranslations("common");
  const router = useRouter();
  const [body, setBody] = useState(initialBody);
  const [editing, setEditing] = useState(!initialBody);
  const [state, action, pending] = useActionState<ProtocolFormState, FormData>(saveProtocolAction, { status: "idle" });
  useActionFeedback(state, (s) => {
    if (s.status === "saved") {
      toast.success(t("saved", { version: s.version }));
      setEditing(false);
      router.refresh();
    } else if (s.status === "error") toast.error(tc("unexpectedError"));
  });

  if (!editing) {
    return (
      <div className="grid gap-3">
        {body.trim() ? <Markdown>{body}</Markdown> : <p className="text-sm text-muted-foreground">{t("empty")}</p>}
        <div>
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            {body.trim() ? t("edit") : t("start")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="meetingId" value={meetingId} />
      <Tabs defaultValue="write">
        <TabsList>
          <TabsTrigger value="write">{t("write")}</TabsTrigger>
          <TabsTrigger value="preview">{t("preview")}</TabsTrigger>
        </TabsList>
        <TabsContent value="write" className="pt-2">
          <Textarea name="body" value={body} onChange={(e) => setBody(e.target.value)} rows={16} placeholder={t("placeholder")} className="font-mono text-sm leading-relaxed" />
        </TabsContent>
        <TabsContent value="preview" className="pt-2">
          <div className="min-h-32 rounded-md border p-4">{body.trim() ? <Markdown>{body}</Markdown> : <p className="text-sm text-muted-foreground">{t("nothingToPreview")}</p>}</div>
        </TabsContent>
      </Tabs>
      <div className="grid gap-1.5">
        <Label htmlFor="protocol-note">{t("changeNote")}</Label>
        <Input id="protocol-note" name="changeNote" maxLength={500} placeholder={t("changeNotePlaceholder")} />
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {version > 0 ? t("saveVersion") : tc("save")}
        </Button>
        <Button type="button" variant="ghost" onClick={() => { setBody(initialBody); setEditing(false); }}>
          {tc("cancel")}
        </Button>
      </div>
    </form>
  );
}
