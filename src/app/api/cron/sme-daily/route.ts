/**
 * Cron: daily SME evaluation. Date-driven changes (an invoice becoming overdue, a snooze running
 * out, a bill coming due) happen without any event, so every Jordanian organization is checked.
 */
import { NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/serverAuth';
import { serviceDb } from '@/lib/supabaseServer';
import { evaluateActionsForOrg } from '@/sme/actions/server/evaluate';

export async function GET(request: Request) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized.error;

  const { data: orgs, error } = await serviceDb().from('organizations').select('id').eq('country', 'JO');
  if (error) {
    console.error('[sme-daily] organizations query failed', error.message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  let evaluated = 0;
  let failed = 0;
  for (const org of orgs ?? []) {
    try {
      await evaluateActionsForOrg(org.id);
      evaluated++;
    } catch (err) {
      failed++;
      console.error('[sme-daily] evaluation failed', org.id, err instanceof Error ? err.message : err);
    }
  }
  return NextResponse.json({ ok: failed === 0, evaluated, failed });
}
