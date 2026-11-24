import { isSmeEventType, type OutboxEvent, type SmeEventType } from './types';
import type { EventHandler } from './handlers';

export const MAX_ATTEMPTS = 10;

/** Storage operations the worker needs; the Supabase version lives in ./server. */
export interface OutboxStore {
  claim(limit: number): Promise<Array<{ id: number; orgId: string; eventType: string; payload: unknown; attempts: number; createdAt?: string }>>;
  complete(id: number): Promise<void>;
  fail(id: number, error: string): Promise<void>;
}

export interface OutboxRunResult {
  claimed: number;
  processed: number;
  failed: number;
  abandoned: number[];
}

/**
 * Processes one batch. Exactly-once processing rests on the store's claim being atomic (the
 * SQL claim uses FOR UPDATE SKIP LOCKED and leases rows); handlers must still be idempotent
 * because a crash after a handler runs but before complete() retries the event.
 */
export async function runOutboxBatch(
  store: OutboxStore,
  handlers: Record<SmeEventType, EventHandler>,
  limit = 100,
): Promise<OutboxRunResult> {
  const rows = await store.claim(limit);
  const result: OutboxRunResult = { claimed: rows.length, processed: 0, failed: 0, abandoned: [] };

  for (const row of rows) {
    try {
      if (!isSmeEventType(row.eventType)) throw new Error(`Unknown event type ${row.eventType}`);
      await handlers[row.eventType]({ ...row, eventType: row.eventType, payload: row.payload } as OutboxEvent);
      await store.complete(row.id);
      result.processed++;
    } catch (err) {
      result.failed++;
      await store.fail(row.id, err instanceof Error ? err.message : String(err));
      if (row.attempts >= MAX_ATTEMPTS) result.abandoned.push(row.id);
    }
  }
  return result;
}
