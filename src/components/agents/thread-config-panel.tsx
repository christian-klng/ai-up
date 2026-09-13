"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { getBudgetStatusAction, saveThreadConfigAction } from "@/server/actions/agents";
import { Button } from "@/components/ui/button";
import { QuotaBar, ThreadConfigFields, type AreaOption, type EntryOption, type ThreadConfigValue } from "./thread-config-fields";

export type { AreaOption, EntryOption, ThreadConfigValue };

type Permissions = Pick<ThreadConfigValue, "mode" | "writeApproval">;
type Selection = Pick<ThreadConfigValue, "readAreaIds" | "writeAreaIds" | "instructions">;

/**
 * Right-hand panel of an existing thread. Two kinds of settings live here:
 *  - permissions (write, ask first) take effect immediately and are shared with the toggle in the
 *    chat header, so they are owned by the chat and passed in;
 *  - collections and instructions are edited locally and saved with the button.
 */
export function ThreadConfigPanel({
  threadId,
  areas,
  initialValue,
  mode,
  writeApproval,
  onPermissionsChange,
}: {
  threadId: string;
  areas: AreaOption[];
  initialValue: Selection;
  mode: Permissions["mode"];
  writeApproval: Permissions["writeApproval"];
  onPermissionsChange: (next: Permissions) => void;
}) {
  const t = useTranslations("agents");
  const tc = useTranslations("common");
  const router = useRouter();
  const [selection, setSelection] = useState<Selection>(initialValue);
  const [dirty, setDirty] = useState(false);
  const [saving, startSave] = useTransition();
  const [budget, setBudget] = useState<{ budget: number; percent: number; exceeded: boolean } | null>(null);

  useEffect(() => {
    void getBudgetStatusAction().then(setBudget);
  }, [threadId]);

  const value: ThreadConfigValue = { ...selection, mode, writeApproval };

  const change = (next: ThreadConfigValue) => {
    if (next.readAreaIds !== selection.readAreaIds || next.writeAreaIds !== selection.writeAreaIds || next.instructions !== selection.instructions) {
      setSelection({ readAreaIds: next.readAreaIds, writeAreaIds: next.writeAreaIds, instructions: next.instructions });
      setDirty(true);
    }
    if (next.mode !== mode || next.writeApproval !== writeApproval) onPermissionsChange({ mode: next.mode, writeApproval: next.writeApproval });
  };

  const save = () =>
    startSave(async () => {
      const res = await saveThreadConfigAction(threadId, {
        readAreaIds: selection.readAreaIds,
        writeAreaIds: mode === "curate" ? selection.writeAreaIds.filter((id) => selection.readAreaIds.includes(id)) : [],
        instructionContentIds: selection.instructions.map((i) => i.id),
      });
      if (res.ok) {
        setDirty(false);
        toast.success(tc("saved"));
        // The panel remounts from server props when reopened – refresh them, or it shows the old selection.
        router.refresh();
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
