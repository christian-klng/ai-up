import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { canEditMeeting, getMeeting, getSpaceBySlug } from "@/server/domain/meetings";
import { createMeetingToken, LiveKitNotConfiguredError } from "@/server/meetings/livekit";
import { MeetingCall } from "@/components/meetings/meeting-call";

/** Full-width call page; the token is minted per visit (2 h TTL). */
export default async function MeetingCallPage({ params }: PageProps<"/meetings/[slug]/[id]/call">) {
  const user = await requireUser();
  const { slug, id } = await params;
  const [space, meeting] = await Promise.all([getSpaceBySlug(slug), getMeeting(id)]);
  if (!space || !meeting || meeting.spaceId !== space.id) notFound();
  const backHref = `/meetings/${space.slug}/${meeting.id}`;
  if (meeting.kind === "protocol" || meeting.status === "ended") redirect(backHref);
  let token: { token: string; url: string };
  try {
    token = await createMeetingToken(meeting, user, canEditMeeting(user, meeting));
  } catch (err) {
    if (err instanceof LiveKitNotConfiguredError) redirect(backHref);
    throw err;
  }
  return <MeetingCall title={meeting.title} kind={meeting.kind} token={token.token} serverUrl={token.url} backHref={backHref} recordingEnabled={meeting.recordingEnabled} />;
}
