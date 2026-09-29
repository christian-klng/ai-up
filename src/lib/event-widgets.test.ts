import { describe, expect, it } from "vitest";
import { normalizeEventServiceUrl } from "./event-widgets";
import { isFragmentHref, usesEventSections, validateLandingDefinition } from "./landing-schema";

describe("normalizeEventServiceUrl", () => {
  it("keeps only the origin", () => {
    expect(normalizeEventServiceUrl(" https://events.example.com/embed.js?x=1 ")).toBe("https://events.example.com");
    expect(normalizeEventServiceUrl("https://events.example.com:8443/")).toBe("https://events.example.com:8443");
  });

  it("refuses anything that is not https", () => {
    expect(normalizeEventServiceUrl("http://events.example.com")).toBeNull();
    expect(normalizeEventServiceUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeEventServiceUrl("//events.example.com")).toBeNull();
    expect(normalizeEventServiceUrl("events.example.com")).toBeNull();
    expect(normalizeEventServiceUrl("")).toBeNull();
  });

  it("refuses credentials in the address", () => {
    expect(normalizeEventServiceUrl("https://user:secret@events.example.com")).toBeNull();
  });

  it("allows plain http on the own machine only", () => {
    expect(normalizeEventServiceUrl("http://localhost:8787")).toBe("http://localhost:8787");
    expect(normalizeEventServiceUrl("http://127.0.0.1:8787/demo")).toBe("http://127.0.0.1:8787");
    expect(normalizeEventServiceUrl("http://localhost.example.com")).toBeNull();
  });
});

describe("event sections", () => {
  const page = (sections: unknown[], extra: Record<string, unknown> = {}) => validateLandingDefinition({ sections, ...extra });

  it("accepts the three section types and fills defaults", () => {
    const res = page([{ type: "events", title: "Seminare", limit: 3 }, { type: "event", slug: "2026-11-06-lovable-erste-app" }, { type: "order-status" }]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.definition.sections[0]).toMatchObject({ type: "events", when: "upcoming", limit: 3 });
    expect(usesEventSections(res.definition)).toBe(true);
  });

  it("has no field that could carry a script address", () => {
    const res = page([{ type: "events", src: "https://evil.example/embed.js", url: "https://evil.example" }]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.definition.sections[0]).toEqual({ type: "events", when: "upcoming" });
  });

  it("refuses slugs that are not slugs", () => {
    for (const slug of ["", "Mein Event", "a--b", "-a", "a/b", '"><script>']) {
      expect(page([{ type: "event", slug }]).ok).toBe(false);
    }
  });

  it("refuses unknown filters", () => {
    expect(page([{ type: "events", when: "soon" }]).ok).toBe(false);
    expect(page([{ type: "events", format: "hybrid" }]).ok).toBe(false);
    expect(page([{ type: "events", limit: 0 }]).ok).toBe(false);
  });

  it("checks the replaced texts", () => {
    expect(page([{ type: "events" }], { eventTexts: { buy: "Platz sichern", priceFrom: "ab {price}" } }).ok).toBe(true);
    expect(page([{ type: "events" }], { eventTexts: { priceFrom: "ab 100 €" } }).ok).toBe(false);
    expect(page([{ type: "events" }], { eventTexts: { loading: "…" } }).ok).toBe(false);
  });

  it("leaves pages without event sections alone", () => {
    const res = page([{ type: "markdown", body: "Hallo" }]);
    expect(res.ok && usesEventSections(res.definition)).toBe(false);
  });
});

describe("isFragmentHref", () => {
  it("matches internal links with a fragment only", () => {
    expect(isFragmentHref("/#event/mein-seminar")).toBe(true);
    expect(isFragmentHref("/register")).toBe(false);
    expect(isFragmentHref("https://example.com/#event/x")).toBe(false);
  });
});
