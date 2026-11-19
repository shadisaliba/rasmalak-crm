/**
 * Cron: SME outbox worker (every 5 minutes).
 * Processes due domain events, then purges idempotency keys older than 30 days.
 */
import { NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/serverAuth';
import { runOutboxBatch } from '@/sme/events/worker';
import { EVENT_HANDLERS } from '@/sme/events/handlers';
import { purgeIdempotencyKeys, supabaseOutboxStore } from '@/sme/events/server/outboxStore';

export async function GET(request: Request) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized.error;

  try {
    const batch = await runOutboxBatch(supabaseOutboxStore, EVENT_HANDLERS);
    if (batch.abandoned.length) {
      console.error('[sme-outbox] events abandoned after max attempts', batch.abandoned);
    }
    const purged = await purgeIdempotencyKeys();
    return NextResponse.json({ ok: true, ...batch, purgedIdempotencyKeys: purged });
  } catch (err) {
    console.error('[sme-outbox] run failed', err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
