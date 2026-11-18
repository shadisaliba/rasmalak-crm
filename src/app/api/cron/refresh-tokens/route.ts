/**
 * Cron: Refresh Expiring OAuth Tokens
 * ====================================
 * Runs hourly. Finds tokens expiring within 2 hours and refreshes.
 */

import { NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/serverAuth';
import { refreshExpiring } from '@/integrations/core/tokenRefresher';

export async function GET(request: Request) {
  // Verify cron secret (Vercel sets this automatically for cron requests)
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized.error;

  try {
    const result = await refreshExpiring();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.warn('[Cron] Token refresh error:', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
