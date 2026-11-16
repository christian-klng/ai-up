import { getSubmissionResponse } from "@/server/domain/collection-forms";

export const dynamic = "force-dynamic";

/**
 * Asked by the sender's browser while it waits for a workflow's answer to a submission
 * (docs/externe-formulare.md 5). Polling rather than a stream: the realtime channels belong to
 * signed-in members, and the wait is a few seconds at most.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/forms/[token]/submissions/[id]">) {
  const { token, id } = await ctx.params;
  const found = await getSubmissionResponse(token, id, new URL(req.url).searchParams.get("key") ?? "");
  if (!found) return Response.json({ status: "not_found" }, { status: 404 });
  return Response.json(found.response ? { status: "ready", response: found.response } : { status: "pending" }, { headers: { "Cache-Control": "no-store" } });
}
