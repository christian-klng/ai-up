import { describe, expect, it } from "vitest";
import { isAuthHref } from "./landing-schema";

describe("isAuthHref", () => {
  it("recognises sign-in and registration, also with a query or fragment", () => {
    expect(isAuthHref("/login")).toBe(true);
    expect(isAuthHref("/register")).toBe(true);
    expect(isAuthHref("/login?next=%2Fhome")).toBe(true);
    expect(isAuthHref("/register#start")).toBe(true);
  });

  it("leaves every other target alone", () => {
    expect(isAuthHref("/")).toBe(false);
    expect(isAuthHref("/#event/workshop")).toBe(false);
    expect(isAuthHref("/login-hilfe")).toBe(false);
    expect(isAuthHref("/blog/login")).toBe(false);
    expect(isAuthHref("https://example.com/login")).toBe(false);
  });
});
