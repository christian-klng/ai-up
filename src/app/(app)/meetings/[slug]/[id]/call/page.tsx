import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { getMeeting, getSpaceBySlug } from "@/server/domain/meetings";
import { LiveKitNotConfiguredError, requireLiveKit } from "@/server/meetings/livekit";
import { MeetingCall } from "@/components/meetings/meeting-call";

/** Full-width call page; the token is minted client-side via joinMeetingAction (CallProvider). */
export default async function MeetingCallPage({ params }: PageProps<"/meetings/[slug]/[id]/call">) {
  await requireUser();
  const { slug, id } = await params;
  const [space, meeting] = await Promise.all([getSpaceBySlug(slug), getMeeting(id)]);
  if (!space || !meeting || meeting.spaceId !== space.id) notFound();
  const backHref = `/meetings/${space.slug}/${meeting.id}`;
  if (meeting.kind === "protocol" || meeting.status === "ended") redirect(backHref);
  try {
    await requireLiveKit();
  } catch (err) {
    if (err instanceof LiveKitNotConfiguredError) redirect(backHref);
    throw err;
  }
  return <MeetingCall meetingId={meeting.id} spaceSlug={space.slug} title={meeting.title} kind={meeting.kind} backHref={backHref} recordingEnabled={meeting.recordingEnabled} />;
}
