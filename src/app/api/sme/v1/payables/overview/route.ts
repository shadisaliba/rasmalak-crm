import { orgIdFrom, smeRoute } from '@/sme/api/route';
import { fromDbError } from '@/sme/api/errors';

export const GET = smeRoute(async ({ request, db }) => {
  const { data, error } = await db.rpc('sme_payables_overview', { p_org: orgIdFrom(request) });
  if (error) throw fromDbError(error);
  return { body: data };
});
