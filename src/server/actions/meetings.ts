"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertUser } from "@/server/auth/session";
import { canEditMeeting, createMeeting, getMeeting, getSpaceById, restoreProtocolVersion, saveProtocol, softDeleteMeeting, updateMeeting } from "@/server/domain/meetings";

export type MeetingFormState = { status: "idle" } | { status: "saved"; meetingId: string; spaceSlug: string } | { status: "error"; code: "titleRequired" | "forbidden" | "unexpected" };

const schema = z.object({
  meetingId: z.string().uuid().optional(),
  spaceId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional(),
  kind: z.enum(["protocol", "audio", "video"]),
  startsAt: z.string().optional(),
  recordingEnabled: z.boolean().optional(),
});

export async function saveMeetingAction(_prev: MeetingFormState, formData: FormData): Promise<MeetingFormState> {
  const user = await assertUser();
  const parsed = schema.safeParse({
    meetingId: formData.get("meetingId") || undefined,
    spaceId: formData.get("spaceId"),
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    kind: formData.get("kind"),
    startsAt: formData.get("startsAt") || undefined,
    recordingEnabled: formData.has("recordingEnabled") ? formData.get("recordingEnabled") === "on" : undefined,
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return { status: "error", code: field === "title" ? "titleRequired" : "unexpected" };
  }
  const d = parsed.data;
  const space = await getSpaceById(d.spaceId);
  if (!space) return { status: "error", code: "unexpected" };
  let startsAt: Date | null = null;
  if (d.startsAt) {
    const dt = new Date(d.startsAt);
    if (!Number.isNaN(dt.getTime())) startsAt = dt;
  }
  if (d.meetingId) {
    const existing = await getMeeting(d.meetingId);
    if (!existing) return { status: "error", code: "unexpected" };
    if (!canEditMeeting(user, existing)) return { status: "error", code: "forbidden" };
    await updateMeeting(d.meetingId, { title: d.title, description: d.description ?? null, startsAt, recordingEnabled: d.recordingEnabled, kind: existing.status === "scheduled" ? d.kind : undefined }, user.id);
    revalidatePath("/", "layout");
    return { status: "saved", meetingId: d.meetingId, spaceSlug: space.slug };
  }
  const created = await createMeeting(d.spaceId, { title: d.title, description: d.description ?? null, kind: d.kind, startsAt, recordingEnabled: d.recordingEnabled ?? space.recordingDefault }, user.id);
  revalidatePath("/", "layout");
  return { status: "saved", meetingId: created.id, spaceSlug: space.slug };
}

export type ProtocolFormState = { status: "idle" } | { status: "saved"; version: number } | { status: "error"; code: "forbidden" | "unexpected" };

export async function saveProtocolAction(_prev: ProtocolFormState, formData: FormData): Promise<ProtocolFormState> {
  const user = await assertUser();
  const meetingId = z.string().uuid().parse(formData.get("meetingId"));
  const body = String(formData.get("body") ?? "").replace(/\r\n?/g, "\n");
  const note = String(formData.get("changeNote") ?? "").trim() || null;
  const meeting = await getMeeting(meetingId);
  if (!meeting) return { status: "error", code: "unexpected" };
  // Every active member may contribute to a protocol (it is a shared minutes document)
  const updated = await saveProtocol(meetingId, body, note, user.id);
  if (!updated) return { status: "error", code: "unexpected" };
  revalidatePath(`/meetings/${meeting.spaceSlug}/${meetingId}`, "layout");
  return { status: "saved", version: updated.protocolVersion };
}

export async function restoreProtocolAction(meetingId: string, versionId: string, note: string): Promise<{ ok: boolean }> {
  const user = await assertUser();
  const meeting = await getMeeting(meetingId);
  if (!meeting) return { ok: false };
  const res = await restoreProtocolVersion(meetingId, versionId, user.id, note);
  revalidatePath(`/meetings/${meeting.spaceSlug}/${meetingId}`, "layout");
  return { ok: !!res };
}

export async function deleteMeetingAction(meetingId: string): Promise<{ ok: boolean; spaceSlug?: string }> {
  const user = await assertUser();
  const meeting = await getMeeting(meetingId);
  if (!meeting || !canEditMeeting(user, meeting)) return { ok: false };
  await softDeleteMeeting(meetingId, user.id);
  revalidatePath("/", "layout");
  return { ok: true, spaceSlug: meeting.spaceSlug };
}

export type JoinResult = { ok: true; token: string; url: string; roomName: string; isHost: boolean } | { ok: false; error: "notConfigured" | "notFound" | "ended" | "protocol" };

/** Issues a LiveKit access token for the current user to join (or start) the meeting's room. */
export async function joinMeetingAction(meetingId: string): Promise<JoinResult> {
  const user = await assertUser();
  const meeting = await getMeeting(z.string().uuid().parse(meetingId));
  if (!meeting) return { ok: false, error: "notFound" };
  if (meeting.kind === "protocol") return { ok: false, error: "protocol" };
  if (meeting.status === "ended") return { ok: false, error: "ended" };
  const { createMeetingToken, LiveKitNotConfiguredError } = await import("@/server/meetings/livekit");
  try {
    const isHost = canEditMeeting(user, meeting);
    const t = await createMeetingToken(meeting, user, isHost);
    return { ok: true, ...t, isHost };
  } catch (err) {
    if (err instanceof LiveKitNotConfiguredError) return { ok: false, error: "notConfigured" };
    throw err;
  }
}

export async function endMeetingAction(meetingId: string): Promise<{ ok: boolean }> {
  const user = await assertUser();
  const meeting = await getMeeting(z.string().uuid().parse(meetingId));
  if (!meeting || !canEditMeeting(user, meeting)) return { ok: false };
  const { endRoom, markMeetingEnded } = await import("@/server/meetings/livekit");
  await endRoom(meeting);
  await markMeetingEnded(meeting.id);
  revalidatePath(`/meetings/${meeting.spaceSlug}/${meeting.id}`, "layout");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function reopenMeetingAction(meetingId: string): Promise<{ ok: boolean }> {
  const user = await assertUser();
  const meeting = await getMeeting(z.string().uuid().parse(meetingId));
  if (!meeting || !canEditMeeting(user, meeting)) return { ok: false };
  const { reopenMeeting } = await import("@/server/meetings/livekit");
  await reopenMeeting(meeting.id);
  revalidatePath("/", "layout");
  return { ok: true };
}
