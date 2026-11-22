import { smeRoute, uuidParam } from '@/sme/api/route';
import { SmeError, fromDbError } from '@/sme/api/errors';

export const GET = smeRoute<unknown, { id: string }>(async ({ db, params }) => {
  const id = uuidParam(params.id);
  const [item, versions, staff] = await Promise.all([
    db.from('content_items').select('id, slug, kind, regulated, level, topic_tags, competency_tags, created_at').eq('id', id).maybeSingle(),
    db.from('content_versions').select('id, locale, version, state, title, summary, body, est_minutes, legal_source_ids, external_sources, valid_from, valid_to, author_id, submitted_at, reviewer_id, reviewed_at, legal_reviewer_id, legal_reviewed_at, review_note, published_at, change_note')
      .eq('item_id', id).order('version', { ascending: false }),
    db.from('platform_staff').select('roles').is('revoked_at', null).maybeSingle(),
  ]);
  if (item.error) throw fromDbError(item.error);
  if (versions.error) throw fromDbError(versions.error);
  if (!staff.data) throw new SmeError('ACCESS_DENIED');
  if (!item.data) throw new SmeError('NOT_FOUND');
  return { body: { item: item.data, versions: versions.data ?? [], my_roles: staff.data.roles } };
});
