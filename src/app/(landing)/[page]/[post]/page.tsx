import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { getAccount, getPublicCommunity } from "@/server/auth/session";
import { communityUrl } from "@/server/domain/communities";
import { getPublishedPost, type Post } from "@/server/domain/posts";
import { getPublishedSitePage } from "@/server/domain/site-pages";
import type { Community } from "@/server/db/schema";
import { collectPostsCollectionIds } from "@/lib/landing-schema";
import { Markdown } from "@/components/content/markdown";
import { LandingView } from "@/components/landing/landing-view";

/**
 * One post at "/<page>/<post>": a published entry of a collection that a posts section of the page
 * shows (docs/eigene-seiten.md 7.3). Header, navigation and footer come from the page.
 */

async function findPost(settings: Community, pageSlug: string, postSlug: string) {
  const found = await getPublishedSitePage(settings.id, pageSlug);
  if (!found) return undefined;
  for (const collectionId of collectPostsCollectionIds(found.definition)) {
    const post = await getPublishedPost(settings.id, collectionId, postSlug, settings.defaultLocale);
    if (post) return { ...found, post };
  }
  return undefined;
}

export async function generateMetadata({ params }: PageProps<"/[page]/[post]">): Promise<Metadata> {
  const { page, post } = await params;
  const settings = await getPublicCommunity();
  const found = await findPost(settings, page, post);
  if (!found) return {};
  const p: Post = found.post;
  const url = await communityUrl(settings, `/${found.page.slug}/${p.slug}`);
  const image = p.coverSrc ? (p.coverSrc.startsWith("/") ? await communityUrl(settings, p.coverSrc) : p.coverSrc) : undefined;
  return {
    title: { absolute: `${p.title} – ${settings.name}` },
    description: p.excerpt || undefined,
    alternates: { canonical: url, types: { "application/rss+xml": `/${found.page.slug}/feed.xml` } },
    openGraph: { type: "article", siteName: settings.name, title: p.title, description: p.excerpt || undefined, url, publishedTime: p.publishedAt, images: image ? [image] : undefined },
    twitter: { card: image ? "summary_large_image" : "summary", title: p.title, description: p.excerpt || undefined, images: image ? [image] : undefined },
  };
}

export default async function PostPage({ params }: PageProps<"/[page]/[post]">) {
  const { page, post } = await params;
  const [settings, account, t] = await Promise.all([getPublicCommunity(), getAccount(), getTranslations("landing")]);
  const found = await findPost(settings, page, post);
  if (!found) notFound();
  const p = found.post;
  return (
    <LandingView definition={found.definition} settings={settings} signedIn={Boolean(account)} pageSlug={found.page.slug}>
      <article className="mx-auto max-w-3xl py-10">
        <Link href={`/${found.page.slug}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> {t("backTo", { page: found.page.title })}
        </Link>
        <header className="mt-6">
          <time dateTime={p.publishedAt} className="text-sm text-muted-foreground">
            {p.dateLabel}
          </time>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{p.title}</h1>
        </header>
        {p.coverSrc && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.coverSrc} alt="" className="mt-6 w-full rounded-xl border object-cover" />
        )}
        <div className="mt-8">
          <Markdown>{p.markdown}</Markdown>
        </div>
      </article>
    </LandingView>
  );
}
