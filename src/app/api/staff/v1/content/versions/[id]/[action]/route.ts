import { callRpc, parseBody, smeRoute, uuidParam } from '@/sme/api/route';
import { SmeError } from '@/sme/api/errors';
import { reviewBody } from '@/sme/content/api/schemas';

// Workflow transitions. The rules (four eyes, legal review, sources) are enforced in the database.
export const POST = smeRoute<unknown, { id: string; action: string }>(async ({ request, db, params }) => {
  const id = uuidParam(params.id);
  switch (params.action) {
    case 'submit': return { body: await callRpc(db, 'content_submit', { p_version: id }) };
    case 'publish': return { body: await callRpc(db, 'content_publish', { p_version: id }) };
    case 'retire': return { body: await callRpc(db, 'content_retire', { p_version: id }) };
    case 'review': {
      const { decision, note } = await parseBody(request, reviewBody);
      return { body: await callRpc(db, 'content_review', { p_version: id, p_decision: decision, p_note: note ?? null }) };
    }
    default: throw new SmeError('NOT_FOUND', { field: 'action' });
  }
});
