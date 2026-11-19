import { z } from 'zod';
import { orgIdFrom, parseQuery, smeRoute } from '@/sme/api/route';
import { fromDbError } from '@/sme/api/errors';
import { isoDate } from '@/sme/ledger/api/schemas';

const query = z.object({ from: isoDate, to: isoDate });

export const GET = smeRoute(async ({ request, db }) => {
  const org = orgIdFrom(request);
  const { from, to } = parseQuery(request, query);
  const { data, error } = await db.rpc('sme_cash_by_channel', { p_org: org, p_from: from, p_to: to });
  if (error) throw fromDbError(error);
  return { body: { items: data ?? [] } };
});
