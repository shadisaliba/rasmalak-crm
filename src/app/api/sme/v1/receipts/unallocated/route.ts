import { z } from 'zod';
import { orgIdFrom, parseQuery, smeRoute } from '@/sme/api/route';
import { fromDbError } from '@/sme/api/errors';

const query = z.object({ currency: z.string().length(3) });

export const GET = smeRoute(async ({ request, db }) => {
  const org = orgIdFrom(request);
  const { currency } = parseQuery(request, query);
  const { data, error } = await db.rpc('sme_unallocated_receipts', { p_org: org, p_currency: currency.toUpperCase() });
  if (error) throw fromDbError(error);
  return { body: { items: data ?? [] } };
});
