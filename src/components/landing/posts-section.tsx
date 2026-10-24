import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { PostsSection } from "@/lib/landing-schema";
import type { Post, PostFeed } from "@/server/domain/posts";
import { Markdown } from "@/components/content/markdown";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export type PostsLabels = { noPosts: string; olderPosts: string; newerPosts: string; postsUnavailable: string };

function postHref(feed: PostFeed, post: Post): string | null {
  return feed.basePath ? `/${feed.basePath}/${post.slug}` : null;
}

/** Cover of a card; external URLs are allowed in entries, so a plain img. */
function Cover({ src }: { src: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" loading="lazy" className="aspect-video w-full border-b object-cover" />;
}

function MaybeLink({ href, className, children }: { href: string | null; className?: string; children: React.ReactNode }) {
  return href ? (
    <Link href={href} className={className}>
      {children}
    </Link>
  ) : (
    <div className={className}>{children}</div>
  );
}

/**
 * Published entries of a collection (blog, changelog). Server-resolved feed in, markup out – no
 * hooks, so the admin inline editor can render it too. Paging uses plain query links (`?page=2`).
 */
export function PostsSectionView({ section, path, feed, labels, editing }: { section: PostsSection; path: string; feed: PostFeed | undefined; labels: PostsLabels; editing?: boolean }) {
  if (!feed) {
    return editing ? (
      <section className="py-10">
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{labels.postsUnavailable}</p>
      </section>
    ) : null;
  }
  const header = (
    <>
      {section.title && (
        <h2 className="text-center text-2xl font-semibold tracking-tight text-balance" data-ep={`${path}.title`}>
          {section.title}
        </h2>
      )}
      {section.intro && (
        <p className="mx-auto mt-2 max-w-2xl text-center text-muted-foreground text-balance" data-ep={`${path}.intro`}>
          {section.intro}
        </p>
      )}
    </>
  );
  const spaced = section.title || section.intro ? "mt-8" : "";

  if (feed.items.length === 0) {
    return (
      <section className="py-10">
        {header}
        <p className={`${spaced} rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground`} data-ep={section.emptyText ? `${path}.emptyText` : undefined}>
          {section.emptyText ?? labels.noPosts}
        </p>
      </section>
    );
  }

  return (
    <section className="py-10">
      {header}
      <div className={spaced}>
        {section.layout === "cards" && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {feed.items.map((post) => (
              <MaybeLink key={post.id} href={postHref(feed, post)} className="group block h-full">
                <Card className="h-full gap-0 overflow-hidden py-0 transition-shadow group-hover:shadow-md">
                  {post.coverSrc && <Cover src={post.coverSrc} />}
                  <CardContent className="flex flex-col gap-2 py-5">
                    <time dateTime={post.publishedAt} className="text-xs text-muted-foreground">
                      {post.dateLabel}
                    </time>
                    <h3 className="font-semibold leading-snug group-hover:underline">{post.title}</h3>
                    {post.excerpt && <p className="line-clamp-4 text-sm text-muted-foreground">{post.excerpt}</p>}
                  </CardContent>
                </Card>
              </MaybeLink>
            ))}
          </div>
        )}

        {section.layout === "list" && (
          <ul className="mx-auto max-w-3xl divide-y rounded-xl border bg-card">
            {feed.items.map((post) => (
              <li key={post.id}>
                <MaybeLink href={postHref(feed, post)} className="flex items-baseline justify-between gap-4 px-4 py-3 hover:bg-muted/50">
                  <span className="font-medium">{post.title}</span>
                  <time dateTime={post.publishedAt} className="shrink-0 text-sm text-muted-foreground">
                    {post.dateLabel}
                  </time>
                </MaybeLink>
              </li>
            ))}
          </ul>
        )}

        {section.layout === "timeline" && (
          <ol className="mx-auto grid max-w-3xl gap-10">
            {feed.items.map((post) => {
              const href = postHref(feed, post);
              return (
                <li key={post.id} className="grid gap-2 md:grid-cols-[9rem_1fr] md:gap-6">
                  <time dateTime={post.publishedAt} className="pt-1 text-sm text-muted-foreground md:text-right">
                    {post.dateLabel}
                  </time>
                  <article className="min-w-0 border-l-2 border-primary/30 pl-5">
                    <h3 className="text-lg font-semibold tracking-tight">{href ? <Link href={href} className="hover:underline">{post.title}</Link> : post.title}</h3>
                    {post.markdown && (
                      <div className="mt-2">
                        {/* Headings inside an entry rank below its title. */}
                        <Markdown className="prose-sm prose-h1:text-base prose-h2:mt-4 prose-h2:mb-1 prose-h2:text-base prose-h3:text-sm">{post.markdown}</Markdown>
                      </div>
                    )}
                  </article>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {(feed.page > 1 || feed.hasMore) && (
        <nav className="mt-8 flex items-center justify-between gap-3">
          {feed.page > 1 ? (
            <Button asChild variant="outline" size="sm">
              <a href={feed.page === 2 ? "?" : `?page=${feed.page - 1}`}>
                <ArrowLeft className="size-4" /> {labels.newerPosts}
              </a>
            </Button>
          ) : (
            <span />
          )}
          {feed.hasMore && (
            <Button asChild variant="outline" size="sm">
              <a href={`?page=${feed.page + 1}`}>
                {labels.olderPosts} <ArrowRight className="size-4" />
              </a>
            </Button>
          )}
        </nav>
      )}
    </section>
  );
}
