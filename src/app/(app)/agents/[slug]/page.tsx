import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { getAgentBySlug } from "@/server/domain/agents";
import { listAreas } from "@/server/domain/knowledge";
import { AgentStart } from "@/components/agents/agent-start";

export default async function AgentStartPage({ params }: PageProps<"/agents/[slug]">) {
  const me = await requireUser();
  const { slug } = await params;
  const [agent, areas] = await Promise.all([getAgentBySlug(slug), listAreas()]);
  if (!agent || !agent.enabled || (agent.ownerId && agent.ownerId !== me.id)) notFound();

  return (
    <AgentStart
      slug={agent.slug}
      agent={{ name: agent.name, avatarMediaId: agent.avatarMediaId, description: agent.description }}
      areas={areas.map((a) => ({ id: a.id, name: a.name, icon: a.icon, purpose: a.purpose }))}
    />
  );
}
