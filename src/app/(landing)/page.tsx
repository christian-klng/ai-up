import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import { getAppSettings } from "@/server/domain/settings";
import { getCurrentLandingVersion } from "@/server/domain/landing";
import { LandingView } from "@/components/landing/landing-view";

/**
 * Public root: serves the landing page when enabled, otherwise behaves like the old root –
 * anonymous visitors go to /login, signed-in users to the app home. The proxy lets "/" through
 * unauthenticated; this page makes the actual decision (the proxy has no DB access).
 */

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getAppSettings();
  if (!settings.landingEnabled) return {};
  const landing = await getCurrentLandingVersion("landing");
  return {
    title: { absolute: landing?.definition.meta.title ?? settings.name },
    description: landing?.definition.meta.description ?? settings.tagline ?? undefined,
  };
}

export default async function LandingPage() {
  const [settings, user] = await Promise.all([getAppSettings(), getCurrentUser()]);
  const landing = settings.landingEnabled ? await getCurrentLandingVersion("landing") : undefined;
  if (!landing) {
    // Disabled or never written: never show an empty landing page.
    redirect(user ? (user.status === "active" ? "/home" : "/pending") : "/login");
  }
  return <LandingView definition={landing.definition} settings={settings} signedIn={Boolean(user)} />;
}
