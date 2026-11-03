import { z } from "zod";
import { isValidHexColor } from "./theme";

/**
 * Who may start a community, and what the form collects. Pure, so the rule can be tested and the
 * same parsing serves the form and the confirmation step.
 */

/** Communities one account may found. Deleted ones count, or deleting would reset the limit. */
export const MAX_FOUNDED_COMMUNITIES = 3;

/** How long a request waits for its confirmation. */
export const COMMUNITY_REQUEST_TTL_SECONDS = 60 * 60 * 24;

/** Custom page (docs/eigene-seiten.md) holding the terms founders accept. */
export const COMMUNITY_TERMS_PATH = "/terms";

export type CreationDecision = { allowed: true } | { allowed: false; reason: "off" | "limit" | "blocked" };

/**
 * A suspension wins over everything: someone thrown out of the root must not come back as a founder.
 * Root admins are the operator and neither depend on a switch nor run into the limit. Everyone else
 * needs one of the two switches: the public one covers any account (or none yet), the member one
 * only active members of the root.
 */
export function decideCommunityCreation(input: {
  /** null: no account yet, the visitor would get one on confirming */
  accountStatus: "pending" | "active" | "suspended" | null;
  rootMembership: { role: "member" | "admin"; status: "pending" | "active" | "suspended" } | null;
  allowMembers: boolean;
  allowPublic: boolean;
  founded: number;
}): CreationDecision {
  const { accountStatus, rootMembership, allowMembers, allowPublic, founded } = input;
  if (accountStatus === "suspended" || rootMembership?.status === "suspended") return { allowed: false, reason: "blocked" };
  const activeRootMember = rootMembership?.status === "active";
  if (activeRootMember && rootMembership.role === "admin") return { allowed: true };
  if (!allowPublic && !(allowMembers && activeRootMember)) return { allowed: false, reason: "off" };
  if (founded >= MAX_FOUNDED_COMMUNITIES) return { allowed: false, reason: "limit" };
  return { allowed: true };
}

export const communityDraftSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z.string().trim().min(3).max(40),
  purpose: z.string().trim().min(5).max(4000),
  tagline: z.string().trim().max(160).optional(),
  locale: z.enum(["de", "en"]),
  primaryColor: z.string().refine(isValidHexColor).transform((c) => c.toLowerCase()),
  joinLink: z.boolean(),
});

export type CommunityDraft = z.infer<typeof communityDraftSchema>;

export const communityFounderSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
});

/**
 * The address a rate limit counts for. Traefik appends the client it saw to `X-Forwarded-For`, and
 * whatever a client sent itself stands further left – so the last entry is the one to believe.
 */
export function clientIp(forwardedFor: string | null): string {
  return forwardedFor?.split(",").at(-1)?.trim() || "unknown";
}
