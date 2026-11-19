import 'server-only';
import { after } from 'next/server';
import { runOutboxBatch } from '../worker';
import { EVENT_HANDLERS } from '../handlers';
import { supabaseOutboxStore } from './outboxStore';

/**
 * Runs the outbox worker once after the response is sent, so work the user is waiting for (such
 * as parsing an import) starts without waiting for the cron, which does not run on preview
 * deployments. Safe next to the cron: claimed events are leased.
 */
export function runOutboxSoon(): void {
  after(async () => {
    try {
      await runOutboxBatch(supabaseOutboxStore, EVENT_HANDLERS);
    } catch (err) {
      console.error('[sme-outbox] run after request failed', err);
    }
  });
}
