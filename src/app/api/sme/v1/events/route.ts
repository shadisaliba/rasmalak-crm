import { callRpc, idempotencyKeyFrom, orgIdFrom, parseBody, smeRoute } from '@/sme/api/route';
import { trackBody } from '@/sme/home/api/schemas';

// Product events for the pilot KPIs (W3a-11). The database accepts only blueprint names and
// code-like props, and skips demo organizations.
export const POST = smeRoute(async ({ request, db }) => {
  const org = orgIdFrom(request);
  idempotencyKeyFrom(request);
  const body = await parseBody(request, trackBody);
  const recorded = await callRpc<boolean>(db, 'sme_track', { p_org: org, p_event: body.event, p_props: body.props });
  return { status: 202, body: { recorded } };
});
