import { describe, expect, it } from 'vitest';
import { SmeError, fromDbError, toResponse } from './errors';
import { idempotencyKeyFrom, correlationIdFrom, callRpc } from './route';
import type { SupabaseClient } from '@supabase/supabase-js';

const dbError = (code: string, message: string, details: string | null = null) =>
  ({ code, message, details, hint: null, name: 'PostgrestError' }) as never;

describe('SME error contract', () => {
  it('maps coded SQL exceptions with their details', () => {
    const err = fromDbError(dbError('P0001', 'OVER_ALLOCATION', '{"outstanding":500000}'));
    expect(err).toMatchObject({ code: 'OVER_ALLOCATION', details: { outstanding: 500000 } });
  });

  it('maps RLS refusals to ACCESS_DENIED and hides other database messages', () => {
    expect(fromDbError(dbError('42501', 'new row violates row-level security policy')).code).toBe('ACCESS_DENIED');
    expect(fromDbError(dbError('23505', 'duplicate key value violates unique constraint "x_pkey"')).code).toBe('INTERNAL');
    expect(fromDbError(dbError('P0001', 'Some free text')).code).toBe('INTERNAL');
  });

  it('renders the R13 shape with status, both languages and the correlation id', async () => {
    const res = toResponse(new SmeError('IDEMPOTENCY_CONFLICT', { operation: 'x' }), 'c0ffee00-0000-4000-8000-000000000000');
    expect(res.status).toBe(409);
    expect(res.headers.get('x-correlation-id')).toBe('c0ffee00-0000-4000-8000-000000000000');
    const body = await res.json();
    expect(body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(body.error.message_en).toBeTruthy();
    expect(body.error.message_ar).toMatch(/[؀-ۿ]/);
    expect(body.error.details).toEqual({ operation: 'x' });
  });

  it('never leaks unexpected errors', async () => {
    const res = toResponse(new Error('connection string postgres://secret'), 'id');
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret');
  });
});

describe('request plumbing', () => {
  it('requires a well-formed Idempotency-Key', () => {
    const req = (h: Record<string, string>) => new Request('http://x', { method: 'POST', headers: h });
    expect(() => idempotencyKeyFrom(req({}))).toThrow(SmeError);
    expect(() => idempotencyKeyFrom(req({ 'Idempotency-Key': 'has space' }))).toThrow(SmeError);
    expect(idempotencyKeyFrom(req({ 'Idempotency-Key': 'abc-123' }))).toBe('abc-123');
  });

  it('keeps a valid correlation id and replaces anything else', () => {
    const valid = '11111111-1111-4111-8111-111111111111';
    expect(correlationIdFrom(new Request('http://x', { headers: { 'x-correlation-id': valid } }))).toBe(valid);
    expect(correlationIdFrom(new Request('http://x', { headers: { 'x-correlation-id': '<script>' } }))).not.toBe('<script>');
  });

  it('turns an idempotency conflict from an RPC into a 409', async () => {
    const db = { rpc: async () => ({ data: null, error: dbError('P0001', 'IDEMPOTENCY_CONFLICT', '{"operation":"ledger.post"}') }) } as unknown as SupabaseClient;
    await expect(callRpc(db, 'sme_post_transaction', {})).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });
});
