import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAccount, getPublicCommunity } from "@/server/auth/session";
import { getPublishedSitePage } from "@/server/domain/site-pages";
import { collectPostsCollectionIds } from "@/lib/landing-schema";
import { LandingView } from "@/components/landing/landing-view";

/**
 * Custom public page at "/<slug>" (docs/eigene-seiten.md). The proxy lets every unreserved
 * one-segment path through; unknown or switched-off pages answer 404 here.
 */

export async function generateMetadata({ params }: PageProps<"/[page]">): Promise<Metadata> {
  const { page } = await params;
  const settings = await getPublicCommunity();
  const found = await getPublishedSitePage(settings.id, page);
  if (!found) return {};
  const feeds = collectPostsCollectionIds(found.definition).length > 0;
  return {
    title: { absolute: found.definition.meta.title ?? `${found.page.title} – ${settings.name}` },
    description: found.definition.meta.description ?? undefined,
    // Blog and changelog pages announce their feed.
    alternates: feeds ? { types: { "application/rss+xml": `/${found.page.slug}/feed.xml` } } : undefined,
  };
}

export default async function CustomSitePage({ params, searchParams }: PageProps<"/[page]">) {
  const [{ page }, query] = await Promise.all([params, searchParams]);
  const [settings, account] = await Promise.all([getPublicCommunity(), getAccount()]);
  const found = await getPublishedSitePage(settings.id, page);
  if (!found) notFound();
  const listPage = Number(Array.isArray(query.page) ? query.page[0] : query.page);
  return (
    <LandingView
      definition={found.definition}
      settings={settings}
      signedIn={Boolean(account)}
      pageSlug={found.page.slug}
      listPage={Number.isInteger(listPage) && listPage > 1 ? listPage : 1}
    />
  );
}
