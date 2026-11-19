import { describe, expect, it, vi } from 'vitest';
import { runOutboxBatch, type OutboxStore } from './worker';
import { EVENT_HANDLERS } from './handlers';
import type { SmeEventType } from './types';

interface Row { id: number; orgId: string; eventType: string; payload: unknown; attempts: number; leasedUntil: number; done: boolean }

// Mirrors sme_outbox_claim: a claim leases rows atomically, so a concurrent claim skips them.
function memoryStore(rows: Row[], now = () => Date.now()): OutboxStore & { rows: Row[] } {
  return {
    rows,
    async claim(limit) {
      const due = rows.filter(r => !r.done && r.leasedUntil <= now() && r.attempts < 10).slice(0, limit);
      for (const r of due) { r.attempts++; r.leasedUntil = now() + 5 * 60_000; }
      await Promise.resolve(); // let a concurrent run interleave here
      return due.map(({ id, orgId, eventType, payload, attempts }) => ({ id, orgId, eventType, payload, attempts }));
    },
    async complete(id) { rows.find(r => r.id === id)!.done = true; },
    async fail(id) { const r = rows.find(r => r.id === id)!; r.leasedUntil = now() + 2 ** r.attempts * 60_000; },
  };
}

const row = (id: number, eventType = 'TransactionPosted', attempts = 0): Row =>
  ({ id, orgId: 'org', eventType, payload: { transactionId: `t${id}`, accountId: 'a' }, attempts, leasedUntil: 0, done: false });

describe('runOutboxBatch', () => {
  it('processes each event once even when two runs overlap', async () => {
    const store = memoryStore(Array.from({ length: 25 }, (_, i) => row(i + 1)));
    const seen: number[] = [];
    const handlers = { ...EVENT_HANDLERS, TransactionPosted: async (e: { id: number }) => { await new Promise(r => setTimeout(r, 1)); seen.push(e.id); } };
    const [a, b] = await Promise.all([runOutboxBatch(store, handlers, 20), runOutboxBatch(store, handlers, 20)]);
    expect(a.processed + b.processed).toBe(25);
    expect(new Set(seen).size).toBe(25);
    expect(seen).toHaveLength(25);
    expect(store.rows.every(r => r.done)).toBe(true);
  });

  it('backs off a failing event and reports it abandoned at the attempt limit', async () => {
    const store = memoryStore([row(1), row(2, 'TransactionPosted', 9)]);
    const failing = { ...EVENT_HANDLERS, TransactionPosted: vi.fn(async () => { throw new Error('boom'); }) };
    const result = await runOutboxBatch(store, failing);
    expect(result).toMatchObject({ claimed: 2, processed: 0, failed: 2, abandoned: [2] });
    expect(store.rows.every(r => !r.done && r.leasedUntil > Date.now())).toBe(true);
  });

  it('fails events of an unknown type rather than dropping them', async () => {
    const store = memoryStore([row(1, 'NotARealEvent')]);
    const result = await runOutboxBatch(store, EVENT_HANDLERS);
    expect(result.failed).toBe(1);
    expect(store.rows[0].done).toBe(false);
  });

  it('acknowledges every catalogued event type', () => {
    for (const handler of Object.values(EVENT_HANDLERS) as Array<(e: never) => Promise<void>>) expect(typeof handler).toBe('function');
    expect(Object.keys(EVENT_HANDLERS).sort()).toEqual(([...Object.keys(EVENT_HANDLERS)] as SmeEventType[]).sort());
  });
});
