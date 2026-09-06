"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Dices, Upload } from "lucide-react";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { rerollAgentAvatarAction, saveAgentAction, uploadAgentAvatarAction, type AdminFormState } from "@/server/actions/admin-agents";
import { LlmModelSelect, type LlmProviderOption } from "@/components/common/llm-model-select";
import { UserAvatar } from "@/components/shell/user-avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type Agent = {
  id: string;
  name: string;
  description: string | null;
  avatarMediaId: string | null;
  providerId: string;
  model: string;
  systemPrompt: string;
  reasoningEffort: "none" | "low" | "medium" | "high";
  maxSteps: number;
  maxTokensPerTurn: number;
};

export function AgentForm({ agent, providers, defaultSystemPrompt }: { agent: Agent; providers: LlmProviderOption[]; defaultSystemPrompt: string }) {
  const t = useTranslations("admin.agents");
  const tc = useTranslations("common");
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rerolling, startReroll] = useTransition();
  const [name, setName] = useState(agent.name);
  const [llm, setLlm] = useState({ providerId: agent.providerId, model: agent.model });

  const [avatarState, avatarAction, avatarPending] = useActionState<AdminFormState, FormData>(uploadAgentAvatarAction.bind(null, agent.id), { status: "idle" });
  const [state, action, pending] = useActionState<AdminFormState, FormData>(saveAgentAction.bind(null, agent.id), { status: "idle" });

  const feedback = (s: AdminFormState) => {
    if (s.status === "saved") {
      toast.success(tc("saved"));
      router.refresh();
    } else if (s.status === "error") toast.error(s.message ?? tc("unexpectedError"));
  };
  useActionFeedback(avatarState, feedback);
  useActionFeedback(state, feedback);

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("avatar")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-5">
          <UserAvatar user={{ name, avatarMediaId: agent.avatarMediaId }} size={96} />
          <div className="grid gap-2">
            <form action={avatarAction} className="flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                name="avatar"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={(e) => e.currentTarget.files?.length && e.currentTarget.form?.requestSubmit()}
              />
              <Button type="button" variant="outline" disabled={avatarPending} onClick={() => fileRef.current?.click()}>
                <Upload className="size-4" /> {t("upload")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={rerolling}
                onClick={() =>
                  startReroll(async () => {
                    await rerollAgentAvatarAction(agent.id);
                    router.refresh();
                  })
                }
              >
                <Dices className="size-4" /> {t("rerollAvatar")}
              </Button>
            </form>
            <p className="text-xs text-muted-foreground">{t("avatarHint")}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <form action={action} className="grid gap-5">
            <div className="grid gap-2">
              <Label htmlFor="name">{tc("name")}</Label>
              <Input id="name" name="name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={60} />
              <p className="text-xs text-muted-foreground">{t("nameHint")}</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="description">{t("description")}</Label>
              <Input id="description" name="description" defaultValue={agent.description ?? ""} maxLength={300} placeholder={t("descriptionPlaceholder")} />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="providerId">{t("model")}</Label>
              <LlmModelSelect id="providerId" providers={providers} providerId={llm.providerId} model={llm.model} onChange={setLlm} requireTools />
              <input type="hidden" name="providerId" value={llm.providerId} />
              <input type="hidden" name="model" value={llm.model} />
              <p className="text-xs text-muted-foreground">{t("modelHint")}</p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="systemPrompt">{t("systemPrompt")}</Label>
              <Textarea id="systemPrompt" name="systemPrompt" rows={10} maxLength={20000} defaultValue={agent.systemPrompt} placeholder={defaultSystemPrompt} className="font-mono text-xs" />
              <p className="text-xs text-muted-foreground">{t("systemPromptHint")}</p>
            </div>

            <div className="grid gap-5 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label htmlFor="maxSteps">{t("maxSteps")}</Label>
                <Input id="maxSteps" name="maxSteps" type="number" min={1} max={50} defaultValue={agent.maxSteps} required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="maxTokensPerTurn">{t("maxTokensPerTurn")}</Label>
                <Input id="maxTokensPerTurn" name="maxTokensPerTurn" type="number" min={1000} max={1000000} step={1000} defaultValue={agent.maxTokensPerTurn} required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="reasoningEffort">{t("reasoningEffort")}</Label>
                <Select name="reasoningEffort" defaultValue={agent.reasoningEffort}>
                  <SelectTrigger id="reasoningEffort">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("reasoningOff")}</SelectItem>
                    <SelectItem value="low">{t("reasoningLow")}</SelectItem>
                    <SelectItem value="medium">{t("reasoningMedium")}</SelectItem>
                    <SelectItem value="high">{t("reasoningHigh")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t("limitsHint")}</p>

            <div>
              <Button type="submit" disabled={pending}>
                {tc("save")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
