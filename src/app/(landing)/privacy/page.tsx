import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentUser, getPublicCommunity } from "@/server/auth/session";
import { getCurrentLandingVersion } from "@/server/domain/landing";
import { LandingView } from "@/components/landing/landing-view";

/** Public privacy policy page; 404 while disabled or without content. */

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getPublicCommunity();
  if (!settings.privacyEnabled) return {};
  const page = await getCurrentLandingVersion(settings.id, "privacy");
  return {
    title: { absolute: page?.definition.meta.title ?? settings.name },
    description: page?.definition.meta.description ?? undefined,
  };
}

export default async function PrivacyPage() {
  const [settings, user] = await Promise.all([getPublicCommunity(), getCurrentUser()]);
  const page = settings.privacyEnabled ? await getCurrentLandingVersion(settings.id, "privacy") : undefined;
  if (!page) notFound();
  return <LandingView definition={page.definition} settings={settings} signedIn={Boolean(user)} />;
}
