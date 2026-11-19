import { callRpc, idempotencyKeyFrom, orgIdFrom, parseBody, smeRoute } from '@/sme/api/route';
import { createAccountInput } from '@/sme/ledger/api/schemas';
import { listAccounts } from '@/sme/ledger/server/read';

export const GET = smeRoute(async ({ request, db }) => ({ body: { items: await listAccounts(db, orgIdFrom(request)) } }));

export const POST = smeRoute(async ({ request, db, correlationId }) => {
  const org = orgIdFrom(request);
  const key = idempotencyKeyFrom(request);
  const input = await parseBody(request, createAccountInput);
  const body = await callRpc(db, 'sme_create_account', {
    p_org: org, p_account: input.account, p_opening: input.opening ?? null, p_correlation_id: correlationId, p_idem: key,
  });
  return { status: 201, body };
});
