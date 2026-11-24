import { callRpc, parseBody, smeRoute } from '@/sme/api/route';
import { SmeError, fromDbError } from '@/sme/api/errors';
import { createItemBody } from '@/sme/content/api/schemas';

// Staff content register (W3b-01). RLS shows drafts and review data to platform staff only.
export const GET = smeRoute(async ({ db }) => {
  const staff = await callRpc<boolean>(db, 'is_staff', { p_role: null });
  if (!staff) throw new SmeError('ACCESS_DENIED');
  const { data, error } = await db.from('content_items')
    .select('id, slug, kind, regulated, level, topic_tags, created_at, content_versions(id, locale, version, state, title, submitted_at, published_at)')
    .order('created_at', { ascending: false }).limit(500);
  if (error) throw fromDbError(error);
  return { body: { items: data ?? [] } };
});

export const POST = smeRoute(async ({ request, db }) => {
  const input = await parseBody(request, createItemBody);
  const id = await callRpc<string>(db, 'content_create_item', { p_item: input });
  return { status: 201, body: { id } };
});
