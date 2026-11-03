"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { COMMUNITY_COOKIE, COMMUNITY_COOKIE_OPTIONS } from "@/lib/community";
import { clientIp, communityDraftSchema, communityFounderSchema, type CommunityDraft } from "@/lib/community-creation";
import { auth } from "@/server/auth/auth";
import { issueFounderSessionToken } from "@/server/auth/founder-session-plugin";
import { assertRootAdmin, assertUser, getAccount } from "@/server/auth/session";
import { getHostCommunity } from "@/server/community-context";
import {
  ROOT_COMMUNITY_ID,
  getMembership,
  communityCreationDecision,
  communityUrl,
  isCommunitySlugTaken,
  loadCommunity,
  loadRootCommunity,
  restoreCommunity,
  softDeleteCommunity,
  updateCommunity,
  type CreateCommunityInput,
} from "@/server/domain/communities";
import { primaryHostOf } from "@/server/domain/community-domains";
import { restoreCommunityRequest, storeCommunityRequest, takeCommunityRequest, withinRequestLimit } from "@/server/domain/community-requests";
import { createCommunityWithSetup } from "@/server/domain/community-setup";
import { ensureConfirmedAccount, getUserByEmail } from "@/server/domain/users";
import { env } from "@/server/env";
import { sendMail } from "@/server/mail/mailer";
import { communityRequestMail, mailContext } from "@/server/mail/templates";
import { checkCommunitySlug, slugifyCommunityName } from "@/lib/community";
import { logger } from "@/server/logger";

/**
 * Switches the community the caller is acting in.
 *
 * The cookie is only ever set to a community the account is an active member of – the same check
 * `getActiveCommunity()` performs on every request, repeated here so a forged value never even
 * gets written.
 */
export type SwitchResult = { ok: false } | { ok: true; href: string; leaveApp: boolean };

export async function switchCommunityAction(communityId: string): Promise<SwitchResult> {
  const user = await assertUser();
  const id = z.string().min(1).max(64).parse(communityId);
  if (id === user.communityId) return { ok: true, href: "/home", leaveApp: false };

  const membership = await getMembership(id, user.id);
  if (!membership || membership.status !== "active") return { ok: false };
  (await cookies()).set(COMMUNITY_COOKIE, id, COMMUNITY_COOKIE_OPTIONS);
  revalidatePath("/", "layout");

  // With a host of its own the community *is* an address, so the switch has to leave this one – the
  // cookie alone would be overruled by the host we are still standing on. A custom domain needs the
  // hand-off on top, since the session cookie cannot follow across a registrable domain.
  //
  // `leaveApp` tells the browser to load the address properly instead of routing to it inside the
  // app: both targets are route handlers that answer with a redirect, and a client-side navigation
  // would fetch them as data and go nowhere.
  const target = await loadCommunity(id);
  if (!target) return { ok: true, href: "/home", leaveApp: false };
  const own = await primaryHostOf(id);
  if (own) return { ok: true, href: `/auth/handoff?to=${encodeURIComponent(own)}&next=%2Fhome`, leaveApp: true };
  const href = await communityUrl(target, "/home");
  return { ok: true, href, leaveApp: href.startsWith("http") || href.startsWith("/c/") };
}

// ---------------------------------------------------------------------------
// Creating
// ---------------------------------------------------------------------------

/**
 * May the signed-in account start a community? Decides whether the app shows the way there; the rule
 * itself is `decideCommunityCreation`. Being an admin of a sub-community grants nothing here.
 */
export async function canCreateCommunityAction(): Promise<boolean> {
  const user = await assertUser();
  return (await communityCreationDecision(user)).allowed;
}

export type CreateCommunityState =
  | { status: "idle" }
  | { status: "created"; href: string }
  /** a visitor: the confirmation mail is on its way */
  | { status: "sent"; email: string }
  | { status: "error"; code: "notAllowed" | "limit" | "slugTaken" | "slugInvalid" | "terms" | "founderName" | "founderEmail" | "invalid" | "tooManyRequests" | "unexpected" };

/** Attempts from one IP per hour – a coarse brake against scripts, a shared office stays well below it. */
const IP_LIMIT = { max: 10, windowSeconds: 60 * 60 };
/** Mails to one address per day, so the form cannot be used to flood somebody's inbox. */
const EMAIL_LIMIT = { max: 3, windowSeconds: 60 * 60 * 24 };

function readDraft(formData: FormData) {
  const name = String(formData.get("name") ?? "");
  return communityDraftSchema.safeParse({
    name,
    slug: String(formData.get("slug") ?? "").trim() || slugifyCommunityName(name),
    purpose: formData.get("purpose"),
    tagline: formData.get("tagline") || undefined,
    locale: formData.get("locale"),
    primaryColor: formData.get("primaryColor"),
    joinLink: formData.get("joinLink") === "on",
  });
}

function toCreateInput(draft: CommunityDraft, termsAcceptedAt: string): CreateCommunityInput {
  return {
    name: draft.name,
    slug: draft.slug,
    purpose: draft.purpose,
    tagline: draft.tagline,
    primaryColor: draft.primaryColor,
    defaultLocale: draft.locale,
    joinLink: draft.joinLink,
    termsAcceptedAt,
  };
}

/**
 * The form on /communities/new. Someone signed in gets the community straight away, their address is
 * already proven. A visitor gets a mail, and nothing exists until they confirm it. The answer to a
 * visitor is the same whether or not a mail went out, so the form cannot probe for accounts.
 */
export async function createCommunityAction(_prev: CreateCommunityState, formData: FormData): Promise<CreateCommunityState> {
  // Main host only: the cookie that selects the new community is overruled on any other host.
  if (await getHostCommunity()) return { status: "error", code: "notAllowed" };

  const parsed = readDraft(formData);
  if (!parsed.success) return { status: "error", code: "invalid" };
  const checked = checkCommunitySlug(parsed.data.slug);
  if (!checked.ok) return { status: "error", code: "slugInvalid" };
  const draft = { ...parsed.data, slug: checked.slug };
  if (formData.get("terms") !== "on") return { status: "error", code: "terms" };

  const account = await getAccount();
  try {
    if (account) {
      if (account.status !== "active") return { status: "error", code: "notAllowed" };
      const decision = await communityCreationDecision(account);
      if (!decision.allowed) return { status: "error", code: decision.reason === "limit" ? "limit" : "notAllowed" };
      const res = await createCommunityWithSetup(toCreateInput(draft, new Date().toISOString()), account.id);
      if (!res.ok) return { status: "error", code: res.reason };
      (await cookies()).set(COMMUNITY_COOKIE, res.community.id, COMMUNITY_COOKIE_OPTIONS);
      revalidatePath("/", "layout");
      return { status: "created", href: "/admin/general" };
    }

    const founder = communityFounderSchema.safeParse({ name: formData.get("founderName"), email: formData.get("founderEmail") });
    if (!founder.success) return { status: "error", code: founder.error.issues[0]?.path[0] === "name" ? "founderName" : "founderEmail" };
    const { email, name } = founder.data;

    const root = await loadRootCommunity();
    if (!root.allowPublicCommunities) return { status: "error", code: "notAllowed" };
    // A field people never see: whatever fills it in is not a person. It gets the usual answer.
    if (formData.get("website")) return { status: "sent", email };
    const ip = clientIp((await headers()).get("x-forwarded-for"));
    if (!(await withinRequestLimit("ip", ip, IP_LIMIT.max, IP_LIMIT.windowSeconds))) return { status: "error", code: "tooManyRequests" };
    // Not binding – the name is only claimed on confirming – but it saves a pointless round through the inbox.
    if (await isCommunitySlugTaken(draft.slug)) return { status: "error", code: "slugTaken" };

    const existing = await getUserByEmail(email);
    const decision = await communityCreationDecision(existing ?? null);
    if (decision.allowed && !existing?.isBot && (await withinRequestLimit("email", email, EMAIL_LIMIT.max, EMAIL_LIMIT.windowSeconds))) {
      const locale = existing?.locale ?? draft.locale;
      const token = await storeCommunityRequest({ draft, founder: { name, email, locale } });
      await sendMail(communityRequestMail(mailContext(root, locale), email, `${env.APP_URL.replace(/\/$/, "")}/communities/confirm/${token}`));
    } else {
      logger.info({ email, decision }, "community request without mail");
    }
    return { status: "sent", email };
  } catch (err) {
    logger.error({ err }, "creating a community failed");
    return { status: "error", code: "unexpected" };
  }
}

export type ConfirmCommunityState =
  | { status: "idle" }
  | { status: "error"; code: "invalid" | "limit" | "slugTaken" | "slugInvalid" | "unexpected" };

/**
 * The button on the confirmation page – a button, because mail scanners open the links in a mail and
 * must not create anything by doing so. Having the link proves the address, so the person is signed
 * in afterwards, just as with a magic link.
 *
 * Ends in a redirect rather than a state for the form: the new cookies make Next render the page
 * again, the request is used up by then, and the page would replace the form with "link no longer
 * valid" before the form could navigate anywhere.
 */
export async function confirmCommunityRequestAction(_prev: ConfirmCommunityState, formData: FormData): Promise<ConfirmCommunityState> {
  if (await getHostCommunity()) return { status: "error", code: "invalid" };
  const token = String(formData.get("token") ?? "");
  if (!token) return { status: "error", code: "invalid" };

  const request = await takeCommunityRequest(token).catch((err) => {
    logger.error({ err }, "community request: could not read the request");
    return null;
  });
  if (!request) return { status: "error", code: "invalid" };

  let target = "/admin/general";
  try {
    // Switched off in the meantime: that decision also covers the mails already out there.
    if (!(await loadRootCommunity()).allowPublicCommunities) return { status: "error", code: "invalid" };

    const existing = await getUserByEmail(request.founder.email);
    const decision = await communityCreationDecision(existing ?? null);
    if (!decision.allowed || existing?.isBot) {
      if (decision.allowed || decision.reason !== "limit") return { status: "error", code: "invalid" };
      return { status: "error", code: "limit" };
    }

    // The short name is only claimed now. If someone else got there first, the founder can pick another.
    const checked = checkCommunitySlug(String(formData.get("slug") ?? request.draft.slug));
    if (!checked.ok) {
      await restoreCommunityRequest(token, request);
      return { status: "error", code: "slugInvalid" };
    }
    if (await isCommunitySlugTaken(checked.slug)) {
      await restoreCommunityRequest(token, request);
      return { status: "error", code: "slugTaken" };
    }

    const account = await ensureConfirmedAccount(request.founder);
    const res = await createCommunityWithSetup(toCreateInput({ ...request.draft, slug: checked.slug }, request.acceptedAt), account.id);
    if (!res.ok) {
      await restoreCommunityRequest(token, request);
      return { status: "error", code: res.reason === "slugInvalid" ? "slugInvalid" : "slugTaken" };
    }

    (await cookies()).set(COMMUNITY_COOKIE, res.community.id, COMMUNITY_COOKIE_OPTIONS);
    revalidatePath("/", "layout");
    try {
      const sessionToken = await issueFounderSessionToken(account.id);
      await auth.api.founderSessionConsume({ body: { token: sessionToken }, headers: await headers() });
    } catch (err) {
      // The community exists and the account can sign in the normal way – no reason to fail the step.
      logger.error({ err, userId: account.id }, "community request: could not start the session");
      target = "/login";
    }
  } catch (err) {
    logger.error({ err }, "confirming a community request failed");
    await restoreCommunityRequest(token, request).catch(() => {});
    return { status: "error", code: "unexpected" };
  }
  redirect(target);
}

// ---------------------------------------------------------------------------
// Deleting
// ---------------------------------------------------------------------------

/**
 * Deletes the community the caller administers. It disappears immediately and is purged for good
 * after the grace period; until then a root admin can bring it back.
 */
export async function deleteOwnCommunityAction(confirmName: string): Promise<{ ok: boolean; reason?: "root" | "mismatch" | "notFound" }> {
  const user = await assertUser();
  if (user.role !== "admin") return { ok: false, reason: "notFound" };
  if (user.communityId === ROOT_COMMUNITY_ID) return { ok: false, reason: "root" };
  // Typing the name is the confirmation – this is the one action that takes everything with it.
  const row = await loadCommunity(user.communityId);
  if (!row || row.name.trim() !== confirmName.trim()) return { ok: false, reason: "mismatch" };

  const res = await softDeleteCommunity(user.communityId, user.id);
  if (!res.ok) return res;
  (await cookies()).set(COMMUNITY_COOKIE, ROOT_COMMUNITY_ID, COMMUNITY_COOKIE_OPTIONS);
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Operator view: delete or bring back any sub-community. */
export async function adminDeleteCommunityAction(communityId: string): Promise<{ ok: boolean }> {
  const admin = await assertRootAdmin();
  const res = await softDeleteCommunity(communityId, admin.id);
  revalidatePath("/admin/communities");
  revalidatePath("/", "layout");
  return { ok: res.ok };
}

export async function adminRestoreCommunityAction(communityId: string): Promise<{ ok: boolean }> {
  const admin = await assertRootAdmin();
  const ok = await restoreCommunity(communityId, admin.id);
  revalidatePath("/admin/communities");
  revalidatePath("/", "layout");
  return { ok };
}

/** Operator switch: may ordinary members of the root start their own communities? */
export async function setAllowSubcommunitiesAction(allow: boolean): Promise<{ ok: boolean }> {
  await assertRootAdmin();
  await updateCommunity(ROOT_COMMUNITY_ID, { allowMemberSubcommunities: allow });
  revalidatePath("/admin/general");
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Operator switch: may anyone with a confirmed address start one, without being a member here? */
export async function setAllowPublicCommunitiesAction(allow: boolean): Promise<{ ok: boolean }> {
  await assertRootAdmin();
  await updateCommunity(ROOT_COMMUNITY_ID, { allowPublicCommunities: allow });
  revalidatePath("/", "layout");
  return { ok: true };
}
