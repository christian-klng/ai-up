import { describe, expect, it } from "vitest";
import { MAX_FOUNDED_COMMUNITIES, clientIp, communityDraftSchema, decideCommunityCreation } from "./community-creation";

const base = { accountStatus: "active", rootMembership: null, allowMembers: false, allowPublic: false, founded: 0 } as const;
const member = { role: "member", status: "active" } as const;

describe("decideCommunityCreation", () => {
  it("stays closed while both switches are off", () => {
    expect(decideCommunityCreation(base)).toEqual({ allowed: false, reason: "off" });
    expect(decideCommunityCreation({ ...base, rootMembership: member })).toEqual({ allowed: false, reason: "off" });
  });

  it("lets root admins through without a switch or a limit", () => {
    const admin = { role: "admin", status: "active" } as const;
    expect(decideCommunityCreation({ ...base, rootMembership: admin, founded: 99 })).toEqual({ allowed: true });
  });

  it("opens the member switch to active root members only", () => {
    expect(decideCommunityCreation({ ...base, allowMembers: true, rootMembership: member })).toEqual({ allowed: true });
    expect(decideCommunityCreation({ ...base, allowMembers: true })).toEqual({ allowed: false, reason: "off" });
    expect(decideCommunityCreation({ ...base, allowMembers: true, rootMembership: { role: "member", status: "pending" } })).toEqual({ allowed: false, reason: "off" });
  });

  it("opens the public switch to visitors without an account", () => {
    expect(decideCommunityCreation({ ...base, accountStatus: null, allowPublic: true })).toEqual({ allowed: true });
  });

  it("counts the limit for everyone but root admins", () => {
    expect(decideCommunityCreation({ ...base, allowPublic: true, founded: MAX_FOUNDED_COMMUNITIES })).toEqual({ allowed: false, reason: "limit" });
    expect(decideCommunityCreation({ ...base, allowPublic: true, founded: MAX_FOUNDED_COMMUNITIES - 1 })).toEqual({ allowed: true });
  });

  it("never lets a suspended account or root membership found anything", () => {
    expect(decideCommunityCreation({ ...base, accountStatus: "suspended", allowPublic: true })).toEqual({ allowed: false, reason: "blocked" });
    expect(decideCommunityCreation({ ...base, allowPublic: true, rootMembership: { role: "admin", status: "suspended" } })).toEqual({ allowed: false, reason: "blocked" });
  });
});

describe("communityDraftSchema", () => {
  const draft = { name: "Lesekreis", slug: "lesekreis", purpose: "Wir lesen zusammen.", locale: "de", primaryColor: "#2563EB", joinLink: false };

  it("normalizes the color", () => {
    expect(communityDraftSchema.parse(draft).primaryColor).toBe("#2563eb");
  });

  it("rejects a color that is not hex, it ends up in the page's CSS", () => {
    expect(communityDraftSchema.safeParse({ ...draft, primaryColor: "red;}" }).success).toBe(false);
  });
});

describe("clientIp", () => {
  it("believes the last entry, the one the proxy added", () => {
    expect(clientIp("6.6.6.6, 1.2.3.4")).toBe("1.2.3.4");
    expect(clientIp(null)).toBe("unknown");
  });
});
