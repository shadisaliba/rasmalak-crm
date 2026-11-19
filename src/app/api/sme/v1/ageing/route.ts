import { z } from 'zod';
import { orgIdFrom, parseQuery, smeRoute } from '@/sme/api/route';
import { fromDbError } from '@/sme/api/errors';

const query = z.object({ register: z.enum(['invoice', 'bill']) });
const COLUMNS = 'currency, is_total, current_minor::text, d1_30_minor::text, d31_60_minor::text, d61_90_minor::text, d90_plus_minor::text, total_minor::text';

export const GET = smeRoute(async ({ request, db }) => {
  const org = orgIdFrom(request);
  const { register } = parseQuery(request, query);
  const { data, error } = register === 'invoice'
    ? await db.from('sme_receivables_ageing').select(`customer_company_id, customer_contact_id, ${COLUMNS}`).eq('org_id', org)
    : await db.from('sme_payables_ageing').select(`supplier_company_id, supplier_contact_id, ${COLUMNS}`).eq('org_id', org);
  if (error) throw fromDbError(error);
  return { body: { items: data ?? [] } };
});
