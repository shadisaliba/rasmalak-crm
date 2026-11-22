import { orgIdFrom, parseQuery, smeRoute } from '@/sme/api/route';
import { fromDbError } from '@/sme/api/errors';
import { normalizeForSearch } from '@/crm/search/normalizer';
import { listLessonsQuery } from '@/sme/content/api/schemas';

// LRN-01: published lessons in one locale. RLS shows published versions to members who may learn.
export const GET = smeRoute(async ({ request, db }) => {
  const org = orgIdFrom(request);
  const q = parseQuery(request, listLessonsQuery);
  let query = db.from('content_versions')
    .select('id, item_id, title, summary, est_minutes, published_at, valid_from, content_items!inner(slug, kind, level, topic_tags, regulated)')
    .eq('state', 'published').eq('locale', q.locale).order('title').limit(300);
  if (q.q) {
    // The column holds content_normalize(title || summary); normalize the query the same way.
    const term = normalizeForSearch(q.q).replace(/[\\%_]/g, c => `\\${c}`);
    if (term) query = query.ilike('search_norm', `%${term}%`);
  }
  if (q.level) query = query.eq('content_items.level', q.level);
  if (q.topic) query = query.contains('content_items.topic_tags', [q.topic]);
  const [lessons, progress] = await Promise.all([
    query,
    db.from('lesson_progress').select('item_id, completed_at, last_section_id').eq('org_id', org),
  ]);
  if (lessons.error) throw fromDbError(lessons.error);
  if (progress.error) throw fromDbError(progress.error);
  return { body: { items: lessons.data ?? [], progress: progress.data ?? [] } };
});
