import { describe, expect, it } from "vitest";
import { signListenerRequest, verifyListenerRequest } from "./live-listener";

const secret = "s3cret";
const now = 1_800_000_000_000;

function req(overrides: Partial<Parameters<typeof verifyListenerRequest>[1]> = {}) {
  const timestamp = String(now);
  const body = '{"a":1}';
  return { method: "POST", path: "/api/internal/live/segments", timestamp, body, signature: signListenerRequest(secret, "POST", "/api/internal/live/segments", timestamp, body), ...overrides };
}

describe("listener request signature", () => {
  it("accepts a correctly signed request", () => {
    expect(verifyListenerRequest(secret, req(), now)).toBe(true);
  });
  it("rejects a changed body, path or method", () => {
    expect(verifyListenerRequest(secret, req({ body: '{"a":2}' }), now)).toBe(false);
    expect(verifyListenerRequest(secret, req({ path: "/api/internal/live/config" }), now)).toBe(false);
    expect(verifyListenerRequest(secret, req({ method: "GET" }), now)).toBe(false);
  });
  it("rejects a wrong secret and missing headers", () => {
    expect(verifyListenerRequest("other", req(), now)).toBe(false);
    expect(verifyListenerRequest(secret, req({ signature: null }), now)).toBe(false);
    expect(verifyListenerRequest(secret, req({ timestamp: null }), now)).toBe(false);
    expect(verifyListenerRequest("", req(), now)).toBe(false);
  });
  it("rejects stale or future timestamps", () => {
    expect(verifyListenerRequest(secret, req(), now + 61_000)).toBe(false);
    expect(verifyListenerRequest(secret, req(), now - 61_000)).toBe(false);
  });
  it("rejects a malformed signature without throwing", () => {
    expect(verifyListenerRequest(secret, req({ signature: "zz" }), now)).toBe(false);
  });
});
