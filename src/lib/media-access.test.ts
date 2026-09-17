import { describe, expect, it } from "vitest";
import { mediaAccess, type Viewer } from "./media-access";

/**
 * The rule that keeps an upload inside its community. Before communities existed every signed-in
 * account could fetch any file by id, which is exactly what must no longer be true.
 */
describe("mediaAccess", () => {
  const signedOut: Viewer = { signedIn: false };
  const member: Viewer = { signedIn: true, active: true, memberOfCommunity: true };
  const stranger: Viewer = { signedIn: true, active: true, memberOfCommunity: false };
  const locked: Viewer = { signedIn: true, active: false, memberOfCommunity: true };

  const upload = { purpose: "content", communityId: "sub-1" };
  const avatar = { purpose: "avatar", communityId: null };
  const recording = { purpose: "recording", communityId: "sub-1" };
  const accountFile = { purpose: "message", communityId: null };

  it("serves branding, avatars and meeting covers to anyone", () => {
    // These appear on the sign-in page, in mails and in link previews, where there is no session.
    for (const purpose of ["logo", "favicon", "avatar", "landing", "meeting"]) {
      expect(mediaAccess({ purpose, communityId: "sub-1" }, signedOut), purpose).toBe("allow");
    }
    expect(mediaAccess(avatar, signedOut)).toBe("allow");
  });

  it("asks a signed-out visitor to sign in for everything else", () => {
    expect(mediaAccess(upload, signedOut)).toBe("unauthorized");
    expect(mediaAccess(recording, signedOut)).toBe("unauthorized");
  });

  it("lets a member of the file's community read it", () => {
    expect(mediaAccess(upload, member)).toBe("allow");
    expect(mediaAccess(recording, member)).toBe("allow");
  });

  it("hides the file from a member of another community", () => {
    // notFound, not forbidden: the answer must not confirm that the id exists.
    expect(mediaAccess(upload, stranger)).toBe("notFound");
    expect(mediaAccess(recording, stranger)).toBe("notFound");
  });

  it("refuses a locked account even inside its own community", () => {
    expect(mediaAccess(upload, locked)).toBe("unauthorized");
  });

  it("treats a file without a community as platform-wide", () => {
    expect(mediaAccess(accountFile, stranger)).toBe("allow");
    expect(mediaAccess(accountFile, signedOut)).toBe("unauthorized");
  });
});
