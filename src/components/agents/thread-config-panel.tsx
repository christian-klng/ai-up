"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2 } from "lucide-react";
import { getBudgetStatusAction } from "@/server/actions/agents";
import { QuotaBar, ThreadConfigFields, type AreaOption, type EntryOption, type ThreadConfigValue } from "./thread-config-fields";
import type { SaveState } from "./agent-chat";

export type { AreaOption, EntryOption, ThreadConfigValue };

/**
 * Right-hand panel of an existing thread. Fully controlled: the chat owns the configuration and saves
 * every change itself, so there is no save button – the footer only says whether that worked.
 */
export function ThreadConfigPanel({
  threadId,
  areas,
  value,
  onChange,
  saveState,
}: {
  threadId: string;
  areas: AreaOption[];
  value: ThreadConfigValue;
  onChange: (next: ThreadConfigValue) => void;
  saveState: SaveState;
}) {
  const t = useTranslations("agents");
  const [budget, setBudget] = useState<{ budget: number; percent: number; exceeded: boolean } | null>(null);

  useEffect(() => {
    void getBudgetStatusAction().then(setBudget);
  }, [threadId]);

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto p-4">
      <ThreadConfigFields value={value} onChange={onChange} areas={areas} />
      <QuotaBar budget={budget} />
      <p className="mt-auto flex min-h-5 items-center gap-1.5 pt-2 text-xs text-muted-foreground" aria-live="polite">
        {saveState === "saving" && (
          <>
            <Loader2 className="size-3.5 animate-spin" aria-hidden /> {t("configSaving")}
          </>
        )}
        {saveState === "saved" && (
          <>
            <Check className="size-3.5 text-emerald-600" aria-hidden /> {t("configSaved")}
          </>
        )}
        {saveState === "error" && <span className="text-destructive">{t("configSaveFailed")}</span>}
      </p>
    </div>
  );
}
