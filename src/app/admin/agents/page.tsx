import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/server/auth/session";
import { ensureSystemAgent, DEFAULT_AGENT_SYSTEM_PROMPT } from "@/server/domain/agents";
import { listProviderOptions } from "@/server/llm/providers";
import { PageHeader } from "@/components/common/page-header";
import { AgentForm } from "./agent-form";

export default async function AdminAgentsPage() {
  await requireAdmin();
  const [t, agent, providers] = await Promise.all([getTranslations("admin.agents"), ensureSystemAgent(), listProviderOptions()]);

  return (
    <div className="max-w-3xl">
      <PageHeader title={t("title")} description={t("intro")} />
      <AgentForm
        agent={{
          id: agent.id,
          name: agent.name,
          description: agent.description,
          avatarMediaId: agent.avatarMediaId,
          providerId: agent.providerId ?? "default",
          model: agent.model ?? "default",
          systemPrompt: agent.systemPrompt,
          reasoningEffort: agent.reasoningEffort ?? "none",
          maxSteps: agent.maxSteps,
          maxTokensPerTurn: agent.maxTokensPerTurn,
        }}
        providers={providers}
        defaultSystemPrompt={DEFAULT_AGENT_SYSTEM_PROMPT}
      />
    </div>
  );
}
