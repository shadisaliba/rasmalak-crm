import { orgIdFrom, parseQuery, smeRoute } from '@/sme/api/route';
import { SmeError, fromDbError } from '@/sme/api/errors';
import { lessonQuery } from '@/sme/content/api/schemas';

const SLUG = /^[a-z0-9][a-z0-9_-]{2,120}$/;

// LRN-02: one lesson in the requested locale. A missing locale is reported, never translated.
export const GET = smeRoute<unknown, { slug: string }>(async ({ request, db, params }) => {
  const org = orgIdFrom(request);
  const { locale } = parseQuery(request, lessonQuery);
  if (!SLUG.test(params.slug)) throw new SmeError('NOT_FOUND', { field: 'slug' });
  const { data: item, error } = await db.from('content_items')
    .select('id, slug, kind, level, topic_tags, regulated').eq('slug', params.slug).maybeSingle();
  if (error) throw fromDbError(error);
  if (!item) throw new SmeError('NOT_FOUND', { field: 'slug' });
  const [versions, progress] = await Promise.all([
    db.from('content_versions')
      .select('id, locale, version, title, summary, body, est_minutes, external_sources, legal_source_ids, valid_from, valid_to, published_at, reviewed_at, legal_reviewed_at')
      .eq('item_id', item.id).eq('state', 'published'),
    db.from('lesson_progress').select('version_id, last_section_id, completed_at, quiz_score, quiz_attempts').eq('org_id', org).eq('item_id', item.id).maybeSingle(),
  ]);
  if (versions.error) throw fromDbError(versions.error);
  if (progress.error) throw fromDbError(progress.error);
  const published = versions.data ?? [];
  return {
    body: {
      item,
      version: published.find(v => v.locale === locale) ?? null,
      available_locales: published.map(v => v.locale),
      progress: progress.data ?? null,
    },
  };
});
