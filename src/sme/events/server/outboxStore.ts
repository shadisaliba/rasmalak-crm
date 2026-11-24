import 'server-only';
import { serviceDb } from '@/lib/supabaseServer';
import type { OutboxStore } from '../worker';

// Worker-only: uses the service role (rule R11). Every row carries its own org_id.
export const supabaseOutboxStore: OutboxStore = {
  async claim(limit) {
    const { data, error } = await serviceDb().rpc('sme_outbox_claim', { p_limit: limit });
    if (error) throw new Error(`outbox claim failed: ${error.message}`);
    return (data ?? []).map((r: { id: number; org_id: string; event_type: string; payload: unknown; attempts: number; created_at: string }) => ({
      id: r.id, orgId: r.org_id, eventType: r.event_type, payload: r.payload, attempts: r.attempts, createdAt: r.created_at,
    }));
  },
  async complete(id) {
    const { error } = await serviceDb().rpc('sme_outbox_complete', { p_id: id });
    if (error) throw new Error(`outbox complete failed: ${error.message}`);
  },
  async fail(id, message) {
    const { error } = await serviceDb().rpc('sme_outbox_fail', { p_id: id, p_error: message });
    if (error) throw new Error(`outbox fail failed: ${error.message}`);
  },
};

export async function purgeIdempotencyKeys(): Promise<number> {
  const { data, error } = await serviceDb().rpc('sme_idem_purge');
  if (error) throw new Error(`idempotency purge failed: ${error.message}`);
  return data as number;
}
