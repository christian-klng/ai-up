import { describe, expect, it } from "vitest";
import { checkCommunitySlug, checkCustomHost, communityHost, communityPath, hostOf, normalizeHost, pickActiveCommunity, proofMatches, slugifyCommunityName, subdomainSlug, verifyRecordName } from "./community";

/**
 * The slug doubles as a DNS label for a community's sub-domain (see docs/communities.md §7), so the
 * rules are stricter than for a normal url segment and a handful of names are off limits.
 */
describe("checkCommunitySlug", () => {
  it("accepts plain lowercase labels", () => {
    expect(checkCommunitySlug("lesekreis")).toEqual({ ok: true, slug: "lesekreis" });
    expect(checkCommunitySlug("ki-werkstatt-2")).toEqual({ ok: true, slug: "ki-werkstatt-2" });
  });

  it("lowercases and trims what the admin typed", () => {
    expect(checkCommunitySlug("  LeseKreis ")).toEqual({ ok: true, slug: "lesekreis" });
  });

  it("rejects labels a DNS name cannot carry", () => {
    for (const bad of ["ab", "-leading", "trailing-", "mit punkt", "with.dot", "ümlaut", "a".repeat(41)]) {
      expect(checkCommunitySlug(bad), bad).toEqual({ ok: false, reason: "format" });
    }
  });

  it("rejects host names the platform already uses", () => {
    for (const bad of ["www", "meet", "coolify", "admin", "default"]) {
      expect(checkCommunitySlug(bad), bad).toEqual({ ok: false, reason: "reserved" });
    }
  });
});

describe("slugifyCommunityName", () => {
  it("transliterates German umlauts instead of dropping them", () => {
    expect(slugifyCommunityName("Bücherwürmer")).toBe("buecherwuermer");
    expect(slugifyCommunityName("Straße & Schiene")).toBe("strasse-schiene");
  });

  it("never produces a leading or trailing hyphen", () => {
    expect(slugifyCommunityName("  !Lesekreis!  ")).toBe("lesekreis");
  });

  it("stays within the length a label allows", () => {
    expect(slugifyCommunityName("x".repeat(80)).length).toBeLessThanOrEqual(40);
  });

  it("produces something the checker accepts", () => {
    const slug = slugifyCommunityName("Der Lesekreis für KI");
    expect(checkCommunitySlug(slug)).toEqual({ ok: true, slug });
  });
});

/**
 * The prefix is what lets a link survive being pasted into a chat: it points the reader's active
 * community at the right one before forwarding (see src/app/c/[slug]).
 */
describe("communityPath", () => {
  it("leaves the root community's paths untouched", () => {
    expect(communityPath("default", "/knowledge/buecher")).toBe("/knowledge/buecher");
    expect(communityPath("default")).toBe("/home");
  });

  it("prefixes every other community", () => {
    expect(communityPath("lesekreis", "/knowledge/buecher")).toBe("/c/lesekreis/knowledge/buecher");
    expect(communityPath("lesekreis")).toBe("/c/lesekreis/home");
  });

  it("accepts a path without the leading slash", () => {
    expect(communityPath("lesekreis", "home")).toBe("/c/lesekreis/home");
  });

  it("does not leave a trailing slash for the bare root path", () => {
    expect(communityPath("lesekreis", "/")).toBe("/c/lesekreis");
  });
});

/**
 * Which community a request acts in. The list the caller passes in is already filtered to active
 * memberships of live communities and ordered root-first (domain/communities.ts).
 */
describe("pickActiveCommunity", () => {
  const root = { communityId: "default" };
  const sub = { communityId: "sub-1" };

  it("follows the cookie when it names a community the account belongs to", () => {
    expect(pickActiveCommunity([root, sub], "sub-1")).toBe(sub);
  });

  it("falls back to the first membership when there is no cookie", () => {
    expect(pickActiveCommunity([root, sub], undefined)).toBe(root);
    expect(pickActiveCommunity([root, sub], null)).toBe(root);
    expect(pickActiveCommunity([root, sub], "")).toBe(root);
  });

  it("ignores a cookie pointing at a community the account is no longer in", () => {
    // Left the community, was removed from it, or it was deleted – never lock the person out.
    expect(pickActiveCommunity([root], "sub-1")).toBe(root);
  });

  it("answers null when the account belongs to nothing", () => {
    expect(pickActiveCommunity([], "default")).toBeNull();
    expect(pickActiveCommunity([], undefined)).toBeNull();
  });

  it("works for an account that only belongs to a sub-community", () => {
    expect(pickActiveCommunity([sub], undefined)).toBe(sub);
    expect(pickActiveCommunity([sub], "default")).toBe(sub);
  });
});

/**
 * A community's sub-domain is its slug – there is no table of domains at this stage. The host
 * decides which community a request acts in, so the parsing has to be strict about what counts.
 */
describe("subdomainSlug", () => {
  const base = "ai-up.club";

  it("reads the slug from a one-level sub-domain", () => {
    expect(subdomainSlug("lesekreis.ai-up.club", base)).toBe("lesekreis");
    expect(subdomainSlug("LeseKreis.AI-UP.club", base)).toBe("lesekreis");
    expect(subdomainSlug("lesekreis.ai-up.club:3000", base)).toBe("lesekreis");
  });

  it("answers null for the main host", () => {
    expect(subdomainSlug("ai-up.club", base)).toBeNull();
    expect(subdomainSlug("ai-up.club:443", base)).toBeNull();
  });

  it("ignores deeper names, which the wildcard certificate could not serve anyway", () => {
    expect(subdomainSlug("a.b.ai-up.club", base)).toBeNull();
  });

  it("ignores foreign hosts and nonsense", () => {
    expect(subdomainSlug("lesekreis.example.com", base)).toBeNull();
    expect(subdomainSlug("evil-ai-up.club", base)).toBeNull();
    expect(subdomainSlug("", base)).toBeNull();
    expect(subdomainSlug(null, base)).toBeNull();
  });

  it("refuses labels that are not valid community slugs", () => {
    // www and meet are real DNS names of the installation, not communities.
    expect(subdomainSlug("www.ai-up.club", base)).toBeNull();
    expect(subdomainSlug("meet.ai-up.club", base)).toBeNull();
    expect(subdomainSlug("ab.ai-up.club", base)).toBeNull();
  });

  it("works for localhost during development", () => {
    expect(subdomainSlug("lesekreis.localhost:3000", "localhost")).toBe("lesekreis");
    expect(subdomainSlug("localhost:3000", "localhost")).toBeNull();
  });
});

describe("hostOf / normalizeHost / communityHost", () => {
  it("takes the bare host out of an app URL", () => {
    expect(hostOf("https://ai-up.club")).toBe("ai-up.club");
    expect(hostOf("http://localhost:3000")).toBe("localhost");
    expect(hostOf("not a url")).toBe("");
  });

  it("drops port and trailing dot from a Host header", () => {
    expect(normalizeHost("AI-UP.club:443")).toBe("ai-up.club");
    expect(normalizeHost("ai-up.club.")).toBe("ai-up.club");
    expect(normalizeHost(undefined)).toBe("");
  });

  it("gives the root the main host and everyone else a sub-domain", () => {
    expect(communityHost("default", "ai-up.club")).toBe("ai-up.club");
    expect(communityHost("lesekreis", "ai-up.club")).toBe("lesekreis.ai-up.club");
  });
});

describe("checkCustomHost", () => {
  const app = "ai-up.club";

  it("accepts a plain host and tidies what people paste", () => {
    expect(checkCustomHost("community.verein-xy.de", app)).toEqual({ ok: true, host: "community.verein-xy.de" });
    expect(checkCustomHost("  HTTPS://Community.Verein-XY.de/pfad  ", app)).toEqual({ ok: true, host: "community.verein-xy.de" });
    expect(checkCustomHost("verein-xy.de.", app)).toEqual({ ok: true, host: "verein-xy.de" });
    expect(checkCustomHost("verein-xy.de:3000", app)).toEqual({ ok: true, host: "verein-xy.de" });
  });

  it("refuses what could never be served", () => {
    expect(checkCustomHost("", app).ok).toBe(false);
    expect(checkCustomHost("intranet", app).ok).toBe(false); // single label
    expect(checkCustomHost("192.168.0.4", app).ok).toBe(false); // an address proves nothing
    expect(checkCustomHost("-bad.example.org", app).ok).toBe(false);
    expect(checkCustomHost("bad-.example.org", app).ok).toBe(false);
    expect(checkCustomHost("under_score.example.org", app).ok).toBe(false);
    expect(checkCustomHost(`${"a".repeat(64)}.example.org`, app).ok).toBe(false);
  });

  it("refuses the installation's own names – those belong to the slug", () => {
    expect(checkCustomHost("ai-up.club", app)).toEqual({ ok: false, reason: "ownDomain" });
    expect(checkCustomHost("lesekreis.ai-up.club", app)).toEqual({ ok: false, reason: "ownDomain" });
    expect(checkCustomHost("meet.ai-up.club", app)).toEqual({ ok: false, reason: "ownDomain" });
    // A name that merely *ends* in the same letters is a different domain.
    expect(checkCustomHost("notai-up.club", app).ok).toBe(true);
  });
});

describe("verifyRecordName", () => {
  it("names the record under the host being proven", () => {
    expect(verifyRecordName("community.verein-xy.de")).toBe("_aiup-verify.community.verein-xy.de");
  });
});

/**
 * The DNS proof is what stands between a community and a domain it does not own, so the decision
 * itself is tested here. Not covered: the lookup around it (`dns.resolveTxt`), which is the
 * resolver's job – a test there would only assert that the standard library works.
 */
describe("proofMatches", () => {
  const app = "ai-up.club";
  const token = "9f2c1a7b3d4e5f60";

  it("accepts the token among other TXT records", () => {
    expect(proofMatches({ txt: ["v=spf1 -all", token], cname: [] }, token, app)).toBe(true);
  });

  it("accepts a CNAME to the app host or below it", () => {
    expect(proofMatches({ txt: [], cname: ["ai-up.club"] }, token, app)).toBe(true);
    expect(proofMatches({ txt: [], cname: ["lesekreis.ai-up.club"] }, token, app)).toBe(true);
  });

  it("refuses a near miss", () => {
    expect(proofMatches({ txt: [], cname: ["notai-up.club"] }, token, app)).toBe(false);
    expect(proofMatches({ txt: [`${token}x`], cname: [] }, token, app)).toBe(false);
    expect(proofMatches({ txt: ["v=spf1 -all"], cname: ["example.org"] }, token, app)).toBe(false);
    expect(proofMatches({ txt: [], cname: [] }, token, app)).toBe(false);
  });

  it("never accepts an empty token, whatever DNS says", () => {
    expect(proofMatches({ txt: [""], cname: [] }, "", app)).toBe(false);
  });
});
