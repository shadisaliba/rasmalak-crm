import 'server-only';
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { z } from 'zod';
import { requireUser } from '@/lib/serverAuth';
import { SmeError, fromDbError, toResponse } from './errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY = /^[\x21-\x7e]{1,200}$/;

export function correlationIdFrom(request: Request): string {
  const given = request.headers.get('x-correlation-id');
  return given && UUID.test(given) ? given.toLowerCase() : randomUUID();
}

export function idempotencyKeyFrom(request: Request): string {
  const key = request.headers.get('idempotency-key')?.trim();
  if (!key) throw new SmeError('IDEMPOTENCY_KEY_REQUIRED');
  if (!IDEMPOTENCY_KEY.test(key)) throw new SmeError('VALIDATION_FAILED', { field: 'Idempotency-Key' });
  return key;
}

export interface SmeRequestContext {
  request: Request;
  correlationId: string;
  userId: string;
  /** Acts as the signed-in user; RLS and sme_has_perm apply to everything it does. */
  db: SupabaseClient;
}

/**
 * Wraps an SME route handler: authenticates the caller, attaches a correlation id to the
 * response, and turns every failure into the R13 error shape.
 */
export function smeRoute<T>(handler: (ctx: SmeRequestContext) => Promise<{ status?: number; body: T }>) {
  return async (request: Request): Promise<NextResponse> => {
    const correlationId = correlationIdFrom(request);
    try {
      const auth = await requireUser(request);
      if ('error' in auth) {
        auth.error.headers.set('x-correlation-id', correlationId);
        return auth.error;
      }
      const { status = 200, body } = await handler({ request, correlationId, userId: auth.userId, db: auth.client });
      return NextResponse.json(body, { status, headers: { 'x-correlation-id': correlationId } });
    } catch (err) {
      return toResponse(err, correlationId);
    }
  };
}

export async function parseBody<S extends z.ZodType>(request: Request, schema: S): Promise<z.infer<S>> {
  const raw = await request.json().catch(() => {
    throw new SmeError('VALIDATION_FAILED', { reason: 'invalid_json' });
  });
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new SmeError('VALIDATION_FAILED', {
      fields: parsed.error.issues.map(i => ({ path: i.path.join('.'), code: i.code })),
    });
  }
  return parsed.data;
}

/** Calls an sme_* RPC as the user and maps its errors to the contract. */
export async function callRpc<T>(db: SupabaseClient, fn: string, params: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, params);
  if (error) throw fromDbError(error);
  return data as T;
}
