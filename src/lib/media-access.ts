/**
 * Who may fetch a stored file. Pure, so the rule can be read and tested on its own – it is the only
 * thing standing between an upload and anyone who learns its id.
 */

/**
 * Purposes served without a session, because something outside the app has to render them: the
 * sign-in page and mails show branding, OpenGraph previews show meeting covers, member avatars
 * appear next to invitations.
 */
export const PUBLIC_MEDIA_PURPOSES = new Set(["logo", "favicon", "avatar", "landing", "meeting"]);

export type MediaAccessInput = {
  /** What the file is for (media_files.purpose). */
  purpose: string;
  /** Which community owns it; null = platform-wide, e.g. a generated account avatar. */
  communityId: string | null;
};

export type Viewer =
  | { signedIn: false }
  | {
      signedIn: true;
      /** Account status – a locked account may hold a cookie but must not read anything. */
      active: boolean;
      /** Is the viewer an active member of the file's community? Irrelevant for public purposes. */
      memberOfCommunity: boolean;
    };

/**
 * `notFound` rather than `forbidden` when a member of another community asks: the answer must not
 * reveal that the id exists. `unauthorized` is only used when nobody is signed in at all, where
 * there is nothing to reveal and a sign-in prompt is the useful answer.
 */
export type MediaAccess = "allow" | "unauthorized" | "notFound";

export function mediaAccess(media: MediaAccessInput, viewer: Viewer): MediaAccess {
  if (PUBLIC_MEDIA_PURPOSES.has(media.purpose)) return "allow";
  if (!viewer.signedIn || !viewer.active) return "unauthorized";
  // A file without a community belongs to the platform and is readable by any signed-in account.
  if (media.communityId === null) return "allow";
  return viewer.memberOfCommunity ? "allow" : "notFound";
}
