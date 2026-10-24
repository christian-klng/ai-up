import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateLandingDefinition } from "./landing-schema";
import { RESERVED_PAGE_SLUGS, SITE_PAGE_KINDS, isCustomPagePath, pageSlugProblem, starterDefinition } from "./site-pages";

/** Top-level path segments of the app: directories under src/app, route groups "(…)" resolved, dynamic segments skipped. */
function topLevelSegments(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith("(") && entry.name.endsWith(")")) out.push(...topLevelSegments(join(dir, entry.name)));
    else if (!entry.name.startsWith("[") && !entry.name.startsWith("_") && !entry.name.startsWith("@")) out.push(entry.name);
  }
  return out;
}

describe("reserved page slugs", () => {
  it("cover every top-level route of the app", () => {
    const missing = topLevelSegments(join(__dirname, "..", "app")).filter((s) => !RESERVED_PAGE_SLUGS.has(s));
    // A new top-level route must be added to RESERVED_PAGE_SLUGS – otherwise a custom page could take its name.
    expect(missing).toEqual([]);
  });

  it("include the names of the fixed pages", () => {
    for (const name of ["landing", "imprint", "privacy"]) expect(RESERVED_PAGE_SLUGS.has(name)).toBe(true);
  });
});

describe("pageSlugProblem", () => {
  it("accepts plain slugs", () => {
    expect(pageSlugProblem("blog")).toBeNull();
    expect(pageSlugProblem("release-notes-2026")).toBeNull();
  });

  it("rejects malformed slugs", () => {
    for (const slug of ["", "Blog", "blog/", "-blog", "blog-", "a--b", "über", "a".repeat(61)]) expect(pageSlugProblem(slug)).toBe("invalid");
  });

  it("rejects reserved names", () => {
    expect(pageSlugProblem("home")).toBe("reserved");
    expect(pageSlugProblem("admin")).toBe("reserved");
    expect(pageSlugProblem("landing")).toBe("reserved");
  });
});

describe("isCustomPagePath", () => {
  it("lets custom pages and their posts through", () => {
    expect(isCustomPagePath("/blog")).toBe(true);
    expect(isCustomPagePath("/blog/hello-world")).toBe(true);
    expect(isCustomPagePath("/blog/feed.xml")).toBe(true);
  });

  it("keeps app routes behind the session gate", () => {
    for (const path of ["/home", "/admin", "/admin/pages", "/knowledge/x", "/meetings/abc", "/api/files/x"]) expect(isCustomPagePath(path)).toBe(false);
  });

  it("rejects deeper or malformed paths", () => {
    for (const path of ["/", "//", "/blog/", "/blog/a/b", "/Blog"]) expect(isCustomPagePath(path)).toBe(false);
  });
});

describe("starterDefinition", () => {
  it("produces valid definitions for every kind and language", () => {
    for (const kind of SITE_PAGE_KINDS) {
      for (const locale of ["de", "en"] as const) {
        const def = starterDefinition(kind, "Test", locale, "00000000-0000-4000-8000-000000000000");
        expect(validateLandingDefinition(def).ok).toBe(true);
      }
    }
  });

  it("needs a collection for blog and changelog", () => {
    expect(() => starterDefinition("blog", "Blog", "de")).toThrow();
  });
});
