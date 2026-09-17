import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentUser, getPublicCommunity } from "@/server/auth/session";
import { getCurrentLandingVersion } from "@/server/domain/landing";
import { LandingView } from "@/components/landing/landing-view";

/** Public imprint page; 404 while disabled or without content. */

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getPublicCommunity();
  if (!settings.imprintEnabled) return {};
  const page = await getCurrentLandingVersion(settings.id, "imprint");
  return {
    title: { absolute: page?.definition.meta.title ?? settings.name },
    description: page?.definition.meta.description ?? undefined,
  };
}

export default async function ImprintPage() {
  const [settings, user] = await Promise.all([getPublicCommunity(), getCurrentUser()]);
  const page = settings.imprintEnabled ? await getCurrentLandingVersion(settings.id, "imprint") : undefined;
  if (!page) notFound();
  return <LandingView definition={page.definition} settings={settings} signedIn={Boolean(user)} />;
}
