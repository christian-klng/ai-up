"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { getBudgetStatusAction, saveThreadConfigAction, setThreadModeAction } from "@/server/actions/agents";
import { Button } from "@/components/ui/button";
import { QuotaBar, ThreadConfigFields, type AreaOption, type EntryOption, type ThreadConfigValue } from "./thread-config-fields";

export type { AreaOption, EntryOption, ThreadConfigValue };

/** Right-hand panel of an existing thread: the shared fields plus quota and an explicit save. */
export function ThreadConfigPanel({
  threadId,
  areas,
  initialValue,
  onModeChange,
}: {
  threadId: string;
  areas: AreaOption[];
  initialValue: ThreadConfigValue;
  /** the chat header shows the approval toggle only in curate mode */
  onModeChange: (mode: "assist" | "curate") => void;
}) {
  const t = useTranslations("agents");
  const tc = useTranslations("common");
  const [value, setValue] = useState<ThreadConfigValue>(initialValue);
  const [dirty, setDirty] = useState(false);
  const [saving, startSave] = useTransition();
  const [budget, setBudget] = useState<{ budget: number; percent: number; exceeded: boolean } | null>(null);

  useEffect(() => {
    void getBudgetStatusAction().then(setBudget);
  }, [threadId]);

  const change = (next: ThreadConfigValue) => {
    setValue(next);
    setDirty(true);
    if (next.mode !== value.mode) {
      onModeChange(next.mode);
      // The mode decides which tools exist at all, so it takes effect immediately.
      void setThreadModeAction(threadId, next.mode, "always");
    }
  };

  const save = () =>
    startSave(async () => {
      const res = await saveThreadConfigAction(threadId, {
        readAreaIds: value.readAreaIds,
        writeAreaIds: value.mode === "curate" ? value.writeAreaIds.filter((id) => value.readAreaIds.includes(id)) : [],
        instructionContentIds: value.instructions.map((i) => i.id),
      });
      if (res.ok) {
        setDirty(false);
        toast.success(tc("saved"));
      } else toast.error(tc("unexpectedError"));
    });

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto p-4">
      <ThreadConfigFields value={value} onChange={change} areas={areas} />
      <QuotaBar budget={budget} />
      <div className="mt-auto pt-2">
        <Button type="button" size="sm" className="w-full" disabled={!dirty || saving} onClick={save}>
          {saving && <Loader2 className="size-4 animate-spin" />} {dirty ? tc("save") : t("configSaved")}
        </Button>
      </div>
    </div>
  );
}
