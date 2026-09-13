"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ChevronDown, Loader2, SendHorizontal, SlidersHorizontal } from "lucide-react";
import { getBudgetStatusAction, startThreadAction } from "@/server/actions/agents";
import { UserAvatar } from "@/components/shell/user-avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { QuotaBar, ThreadConfigFields, type AreaOption, type ThreadConfigValue } from "./thread-config-fields";
import { cn } from "@/lib/utils";

/**
 * Start screen of an agent: one centred prompt field that creates the conversation, with the
 * configuration already visible underneath – what the agent may read and what steers it is
 * decided before the first message, not after it.
 */
export function AgentStart({ slug, agent, areas }: { slug: string; agent: { name: string; avatarMediaId: string | null; description: string | null }; areas: AreaOption[] }) {
  const t = useTranslations("agents");
  const router = useRouter();
  const [text, setText] = useState("");
  const [configOpen, setConfigOpen] = useState(true);
  const [sending, startSend] = useTransition();
  const [budget, setBudget] = useState<{ budget: number; percent: number; exceeded: boolean } | null>(null);
  const [config, setConfig] = useState<ThreadConfigValue>({ mode: "assist", writeApproval: "always", readAreaIds: [], writeAreaIds: [], instructions: [] });

  useEffect(() => {
    void getBudgetStatusAction().then(setBudget);
  }, []);

  const start = () => {
    const body = text.trim();
    if (!body || sending) return;
    startSend(async () => {
      const res = await startThreadAction(slug, body, {
        mode: config.mode,
        writeApproval: config.writeApproval,
        readAreaIds: config.readAreaIds,
        writeAreaIds: config.writeAreaIds,
        instructionContentIds: config.instructions.map((i) => i.id),
      });
      if (res.ok) router.push(`/agents/${slug}/${res.threadId}`);
      else toast.error(res.reason === "quota" ? t("quotaReached") : t("turnFailed"));
    });
  };

  const summary = [
    config.mode === "curate" ? t("summaryReadWrite") : t("summaryRead"),
    ...(config.mode === "curate" && config.writeApproval === "never" ? [t("summaryNoQuestions")] : []),
    config.readAreaIds.length === 0 ? t("summaryAllCollections") : t("summaryCollections", { count: config.readAreaIds.length }),
    ...(config.instructions.length ? [t("summaryInstructions", { count: config.instructions.length })] : []),
  ].join(" · ");

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col overflow-y-auto px-4 py-8">
      <div className="flex flex-1 flex-col justify-center">
        <div className="mb-6 flex flex-col items-center text-center">
          <UserAvatar user={agent} size={56} variant="thumb" />
          <h1 className="mt-3 text-xl font-semibold tracking-tight text-balance">{t("startTitle", { name: agent.name })}</h1>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">{agent.description || t("startHint")}</p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            start();
          }}
        >
          <div className="flex items-end gap-2 rounded-xl border bg-card p-2 shadow-sm focus-within:ring-1 focus-within:ring-ring">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  start();
                }
              }}
              placeholder={t("startPlaceholder")}
              rows={2}
              className="max-h-48 min-h-14 resize-none border-0 bg-transparent px-2 shadow-none focus-visible:ring-0"
              autoFocus
            />
            <Button type="submit" size="icon" disabled={sending || !text.trim()} aria-label={t("send")}>
              {sending ? <Loader2 className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}
            </Button>
          </div>
        </form>

        <div className="mt-4 rounded-xl border bg-card">
          <button
            type="button"
            onClick={() => setConfigOpen((o) => !o)}
            aria-expanded={configOpen}
            className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm hover:bg-accent/40"
          >
            <SlidersHorizontal className="size-4 shrink-0 opacity-70" aria-hidden />
            <span className="font-medium">{t("configTitle")}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{summary}</span>
            <ChevronDown className={cn("size-4 shrink-0 opacity-70 transition-transform", configOpen && "rotate-180")} aria-hidden />
          </button>
          {configOpen && (
            <div className="grid gap-5 border-t p-4">
              <ThreadConfigFields value={config} onChange={setConfig} areas={areas} />
              <QuotaBar budget={budget} />
              <p className="text-xs text-muted-foreground">{t("configStartHint")}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
