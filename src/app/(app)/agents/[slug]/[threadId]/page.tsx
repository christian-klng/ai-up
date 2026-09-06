import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { requireUser } from "@/server/auth/session";
import { getAgentBySlug } from "@/server/domain/agents";
import { listAreas } from "@/server/domain/knowledge";
import { listTools } from "@/server/agents/tools";
import { toDto } from "@/server/agents/history";
import { getOwnedThread, getThreadConfig, hasRunningTurn, listMessages } from "@/server/agents/threads";
import { loadInstructionDocs } from "@/server/agents/context";
import { AgentChat } from "@/components/agents/agent-chat";

export default async function AgentThreadPage({ params }: PageProps<"/agents/[slug]/[threadId]">) {
  const me = await requireUser();
  const { slug, threadId } = await params;
  const [agent, thread] = await Promise.all([getAgentBySlug(slug), getOwnedThread(threadId, me.id)]);
  if (!agent || !thread || thread.agentId !== agent.id) notFound();

  const [messages, config, areas, running, locale] = await Promise.all([
    listMessages(thread.id),
    getThreadConfig(thread.id),
    listAreas(),
    hasRunningTurn(thread.id),
    getLocale(),
  ]);
  const docs = await loadInstructionDocs(config.instructionContentIds);
  const areaNames = new Map(areas.map((a) => [a.id, a.name]));

  return (
    <AgentChat
      threadId={thread.id}
      agent={{ name: agent.name, avatarMediaId: agent.avatarMediaId }}
      me={{ name: me.name, avatarMediaId: me.avatarMediaId }}
      initialMessages={messages.map(toDto)}
      initialRunning={running}
      areas={areas.map((a) => ({ id: a.id, name: a.name, icon: a.icon, purpose: a.purpose }))}
      readAreaIds={config.readAreaIds}
      writeAreaIds={config.writeAreaIds}
      mode={thread.mode}
      writeApproval={thread.writeApproval}
      instructions={docs.map((d) => ({ id: d.id, title: d.title, areaId: d.areaId, areaName: areaNames.get(d.areaId) ?? "" }))}
      toolLabels={Object.fromEntries(listTools("write").map((tool) => [tool.name, tool.labels[locale as "de" | "en"] ?? tool.labels.en]))}
    />
  );
}
