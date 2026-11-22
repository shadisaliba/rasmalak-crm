import { callRpc, parseBody, smeRoute, uuidParam } from '@/sme/api/route';
import { draftBody } from '@/sme/content/api/schemas';

// Saves the open draft for a locale, or starts the next version (content_save_draft).
export const POST = smeRoute<unknown, { id: string }>(async ({ request, db, params }) => {
  const id = uuidParam(params.id);
  const { locale, draft } = await parseBody(request, draftBody);
  const body = await callRpc(db, 'content_save_draft', { p_item: id, p_locale: locale, p_draft: draft });
  return { body };
});
