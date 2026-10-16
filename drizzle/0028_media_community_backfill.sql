-- Uploads through /api/upload and URL imports (MCP entry images, meeting covers) were stored without a
-- community since 0024. Such files were missing from community-scoped lists (site images) and, for
-- non-public purposes, readable by any signed-in account. Assign each one to the community that uses
-- it; whatever is still unused falls back to the uploader's only active membership. Avatars stay
-- platform-wide on purpose.

-- Meeting covers
UPDATE "media_files" mf SET "community_id" = ms."community_id"
FROM "meetings" m JOIN "meeting_spaces" ms ON ms."id" = m."space_id"
WHERE mf."community_id" IS NULL AND m."cover_media_id" = mf."id";
--> statement-breakpoint
-- Raster logos and favicons
UPDATE "media_files" mf SET "community_id" = c."id"
FROM "communities" c
WHERE mf."community_id" IS NULL AND (c."logo_media_id" = mf."id" OR c."favicon_media_id" = mf."id");
--> statement-breakpoint
-- Entry images and media answers of structured entries (version.mediaId or anywhere in meta)
UPDATE "media_files" mf SET "community_id" = sub."community_id"
FROM (
  SELECT DISTINCT ON (f."id") f."id", ka."community_id"
  FROM "media_files" f
  JOIN "content_versions" cv ON cv."media_id" = f."id" OR cv."meta"::text LIKE '%' || f."id"::text || '%'
  JOIN "contents" c ON c."id" = cv."content_id"
  JOIN "knowledge_areas" ka ON ka."id" = c."area_id"
  WHERE f."community_id" IS NULL AND f."purpose" <> 'avatar'
  ORDER BY f."id", cv."created_at"
) sub
WHERE mf."id" = sub."id";
--> statement-breakpoint
-- Message attachments
UPDATE "media_files" mf SET "community_id" = sub."community_id"
FROM (
  SELECT DISTINCT ON (f."id") f."id", cv."community_id"
  FROM "media_files" f
  JOIN "messages" msg ON msg."attachments"::text LIKE '%' || f."id"::text || '%'
  JOIN "conversations" cv ON cv."id" = msg."conversation_id"
  WHERE f."community_id" IS NULL AND f."purpose" = 'message'
  ORDER BY f."id", msg."created_at"
) sub
WHERE mf."id" = sub."id";
--> statement-breakpoint
-- Images used on a site page
UPDATE "media_files" mf SET "community_id" = sub."community_id"
FROM (
  SELECT DISTINCT ON (f."id") f."id", lpv."community_id"
  FROM "media_files" f
  JOIN "landing_page_versions" lpv ON lpv."definition"::text LIKE '%' || f."id"::text || '%'
  WHERE f."community_id" IS NULL AND f."purpose" = 'landing'
  ORDER BY f."id", lpv."created_at"
) sub
WHERE mf."id" = sub."id";
--> statement-breakpoint
-- Still unused: the uploader's community, if there is exactly one it could have been
UPDATE "media_files" mf SET "community_id" = sub."community_id"
FROM (
  SELECT f."id", min(cm."community_id") AS "community_id"
  FROM "media_files" f
  JOIN "community_members" cm ON cm."user_id" = f."uploaded_by" AND cm."status" = 'active'
    AND (f."purpose" NOT IN ('landing', 'meeting') OR cm."role" = 'admin')
  WHERE f."community_id" IS NULL AND f."purpose" IN ('content', 'message', 'landing', 'meeting')
  GROUP BY f."id"
  HAVING count(*) = 1
) sub
WHERE mf."id" = sub."id";
