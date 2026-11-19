import { callRpc, idempotencyKeyFrom, orgIdFrom, parseBody, parseQuery, smeRoute } from '@/sme/api/route';
import { listTransactionsQuery, postTransactionInput } from '@/sme/ledger/api/schemas';
import { listTransactions } from '@/sme/ledger/server/read';

export const GET = smeRoute(async ({ request, db }) => ({
  body: await listTransactions(db, orgIdFrom(request), parseQuery(request, listTransactionsQuery)),
}));

// Posted transactions are immutable: there is deliberately no PUT, PATCH or DELETE (R6).
export const POST = smeRoute(async ({ request, db, correlationId }) => {
  const org = orgIdFrom(request);
  const key = idempotencyKeyFrom(request);
  const input = await parseBody(request, postTransactionInput);
  const body = await callRpc(db, 'sme_post_transaction', { p_org: org, p_tx: input, p_correlation_id: correlationId, p_idem: key });
  return { status: 201, body };
});
