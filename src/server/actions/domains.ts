"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertAdmin, ForbiddenError } from "@/server/auth/session";
import { ROOT_COMMUNITY_ID } from "@/server/domain/communities";
import {
  addCommunityDomain,
  removeCommunityDomain,
  setPrimaryCommunityDomain,
  verifyCommunityDomain,
  type AddDomainResult,
  type VerifyResult,
} from "@/server/domain/community-domains";
import { env } from "@/server/env";
import { logger } from "@/server/logger";

/**
 * A community's own domains, managed by its own admin (docs/communities.md §7.8, 7.d).
 *
 * The root community is excluded on purpose: it already owns the main host, and giving it a
 * "primary domain" would silently rewrite every link the installation sends – including the
 * operator's own landing page. An operator who wants a second address for the root changes
 * `APP_URL` instead, where the consequence is visible.
 */
async function assertDomainAdmin() {
  const user = await assertAdmin();
  if (!env.COMMUNITY_CUSTOM_DOMAINS) throw new ForbiddenError("custom domains are off");
  if (user.communityId === ROOT_COMMUNITY_ID) throw new ForbiddenError("the root community uses the main host");
  return user;
}

/** Everything here changes what the address card and the admin menu show. */
function revalidate() {
  revalidatePath("/admin/general");
  revalidatePath("/", "layout");
}

export async function addDomainAction(rawHost: string): Promise<AddDomainResult> {
  const user = await assertDomainAdmin();
  const host = z.string().trim().min(3).max(260).parse(rawHost);
  const res = await addCommunityDomain(user.communityId, host, user.id);
  if (res.ok) revalidate();
  return res;
}

export async function verifyDomainAction(id: string): Promise<VerifyResult> {
  const user = await assertDomainAdmin();
  const res = await verifyCommunityDomain(user.communityId, z.string().uuid().parse(id));
  if (res.ok) revalidate();
  return res;
}

export async function setPrimaryDomainAction(id: string): Promise<{ ok: boolean }> {
  const user = await assertDomainAdmin();
  const ok = await setPrimaryCommunityDomain(user.communityId, z.string().uuid().parse(id));
  if (ok) revalidate();
  return { ok };
}

export async function removeDomainAction(id: string): Promise<{ ok: boolean }> {
  const user = await assertDomainAdmin();
  const ok = await removeCommunityDomain(user.communityId, z.string().uuid().parse(id));
  if (ok) {
    logger.info({ communityId: user.communityId, by: user.id }, "custom domain removed by community admin");
    revalidate();
  }
  return { ok };
}
