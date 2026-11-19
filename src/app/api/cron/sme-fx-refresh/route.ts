/**
 * Cron: stores today's rate to JOD for every supported currency (daily). The only writer of
 * fx_rates. Vercel runs crons on production only; on previews call it with CRON_SECRET.
 */
import { NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/serverAuth';
import { getSupabaseServerClient } from '@/lib/supabaseServer';
import { CURRENCY_CODES } from '@/sme/money';
import { refreshRatesToBase } from '@/sme/money/fx';

export async function GET(request: Request) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized.error;
  try {
    const result = await refreshRatesToBase(getSupabaseServerClient(), CURRENCY_CODES);
    if (result.errors.length) console.error('[sme-fx-refresh] some rates were not fetched', result.errors);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[sme-fx-refresh] run failed', err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
