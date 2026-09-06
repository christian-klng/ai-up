import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { getAgentBySlug } from "@/server/domain/agents";
import { listThreads } from "@/server/agents/threads";
import { AgentShell } from "@/components/agents/agent-shell";

export default async function AgentLayout({ children, params }: LayoutProps<"/agents/[slug]">) {
  const me = await requireUser();
  const { slug } = await params;
  const agent = await getAgentBySlug(slug);
  if (!agent || !agent.enabled || (agent.ownerId && agent.ownerId !== me.id)) notFound();
  const threads = await listThreads(me.id, agent.id);

  return (
    <AgentShell
      agent={{ name: agent.name, avatarMediaId: agent.avatarMediaId, description: agent.description }}
      slug={agent.slug}
      threads={threads.map((th) => ({ id: th.id, title: th.title, lastMessageAt: th.lastMessageAt?.toISOString() ?? null }))}
    >
      {children}
    </AgentShell>
  );
}
