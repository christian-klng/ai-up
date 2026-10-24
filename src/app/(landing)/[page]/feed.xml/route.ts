import { getPublicCommunity } from "@/server/auth/session";
import { communityUrl } from "@/server/domain/communities";
import { listPublishedPosts, type Post } from "@/server/domain/posts";
import { getPublishedSitePage } from "@/server/domain/site-pages";
import { collectPostsCollectionIds } from "@/lib/landing-schema";

/** RSS 2.0 feed of a page with posts sections: the latest 20 published posts (docs/eigene-seiten.md 7.5). */

export const dynamic = "force-dynamic";

function xml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export async function GET(_req: Request, ctx: RouteContext<"/[page]/feed.xml">) {
  const { page } = await ctx.params;
  const settings = await getPublicCommunity();
  const found = await getPublishedSitePage(settings.id, page);
  const collections = found ? collectPostsCollectionIds(found.definition) : [];
  if (!found || collections.length === 0) return new Response("not found", { status: 404 });

  const lists = await Promise.all(collections.map((id) => listPublishedPosts(settings.id, id, { limit: 20, locale: settings.defaultLocale })));
  const posts: Post[] = lists
    .flatMap((l) => l.items)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, 20);
  const pageUrl = await communityUrl(settings, `/${found.page.slug}`);
  const items = await Promise.all(
    posts.map(async (p) => {
      const url = await communityUrl(settings, `/${found.page.slug}/${p.slug}`);
      return [
        "<item>",
        `<title>${xml(p.title)}</title>`,
        `<link>${xml(url)}</link>`,
        `<guid isPermaLink="false">${p.id}</guid>`,
        `<pubDate>${new Date(p.publishedAt).toUTCString()}</pubDate>`,
        p.excerpt ? `<description>${xml(p.excerpt)}</description>` : "",
        "</item>",
      ].join("");
    }),
  );
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "<channel>",
    `<title>${xml(`${found.page.title} – ${settings.name}`)}</title>`,
    `<link>${xml(pageUrl)}</link>`,
    `<atom:link href="${xml(`${pageUrl}/feed.xml`)}" rel="self" type="application/rss+xml"/>`,
    `<description>${xml(found.definition.meta.description ?? found.page.title)}</description>`,
    `<language>${settings.defaultLocale}</language>`,
    ...items,
    "</channel>",
    "</rss>",
  ].join("\n");
  return new Response(body, { headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
