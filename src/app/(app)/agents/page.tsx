import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { listAgentsForUser } from "@/server/domain/agents";

/** "/agents" has no view of its own – it opens the first agent available to the member. */
export default async function AgentsPage() {
  const me = await requireUser();
  const agents = await listAgentsForUser(me.id);
  if (!agents.length) notFound();
  redirect(`/agents/${agents[0].slug}`);
}
