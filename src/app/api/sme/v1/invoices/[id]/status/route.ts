import { callRpc, idempotencyKeyFrom, orgIdFrom, parseBody, smeRoute, uuidParam } from '@/sme/api/route';
import { statusInput } from '@/sme/receivables/api/schemas';

const RPC = { open: 'sme_issue_invoice', void: 'sme_void_invoice', written_off: 'sme_write_off_invoice' } as const;

export const POST = smeRoute<unknown, { id: string }>(async ({ request, db, correlationId, params }) => {
  const org = orgIdFrom(request);
  const key = idempotencyKeyFrom(request);
  const { to, reason } = await parseBody(request, statusInput);
  const args: Record<string, unknown> = { p_org: org, p_invoice: uuidParam(params.id), p_correlation_id: correlationId, p_idem: key };
  if (to !== 'open') args.p_reason = reason ?? null;
  return { body: await callRpc(db, RPC[to], args) };
});
