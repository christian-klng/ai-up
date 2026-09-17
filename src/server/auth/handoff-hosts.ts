import { communityIdForHost, listVerifiedHosts } from "@/server/domain/community-domains";
import { env } from "@/server/env";

/**
 * Which hosts may receive a handed-over session, and which origins the app trusts because of it.
 *
 * Both answer from `community_domains`, and both only ever see **verified** rows: an unverified
 * host must never receive a session, or anyone could point a domain at the app and collect logins
 * (docs/communities.md §7.2). The feature flag is checked inside the lookups.
 */
export async function isHandoffHost(host: string): Promise<boolean> {
  return (await communityIdForHost(host)) !== null;
}

/**
 * The verified hosts as origins, so Better Auth's own endpoints (sign-out, session refresh) and
 * every server action accept requests coming from a community's own domain. Without this a visitor
 * could be handed a session there and then be unable to sign out of it – found in the spike.
 *
 * The port matters: an origin carries it, so a pattern without it never matches when the app does
 * not run on the default port. In production the app host has none and this appends nothing.
 */
export async function handoffOrigins(): Promise<string[]> {
  const hosts = await listVerifiedHosts();
  if (hosts.length === 0) return [];
  const app = new URL(env.APP_URL);
  const port = app.port ? `:${app.port}` : "";
  return hosts.map((h) => `${app.protocol}//${h}${port}`);
}
