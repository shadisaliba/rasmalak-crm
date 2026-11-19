import 'server-only';
import type { PostgrestError } from '@supabase/supabase-js';
import type { NextResponse } from 'next/server';
import { errorResponse, isErrorCode } from '@/lib/apiError';
import type { ErrorCode } from '@/lib/errorCodes';

/** An expected failure with a code from playbook Appendix C (rule R13). */
export class SmeError extends Error {
  constructor(readonly code: ErrorCode, readonly details?: Record<string, unknown>) {
    super(code);
    this.name = 'SmeError';
  }
}

/**
 * Maps a database error to an SmeError. SQL functions raise MESSAGE '<CODE>', DETAIL '<json>';
 * row-level security refusals become ACCESS_DENIED. Anything else is INTERNAL, without the
 * database's own message, which can describe schema internals.
 */
export function fromDbError(error: PostgrestError): SmeError {
  if (error.code === 'P0001' && isErrorCode(error.message)) {
    let details: Record<string, unknown> | undefined;
    try {
      details = error.details ? JSON.parse(error.details) : undefined;
    } catch {
      details = undefined;
    }
    return new SmeError(error.message, details);
  }
  if (error.code === '42501') return new SmeError('ACCESS_DENIED');
  return new SmeError('INTERNAL');
}

export function toResponse(err: unknown, correlationId: string): NextResponse {
  const headers = { 'x-correlation-id': correlationId };
  if (err instanceof SmeError) return errorResponse(err.code, err.details, headers);
  console.error('[sme] unexpected error', { correlationId, err });
  return errorResponse('INTERNAL', { correlation_id: correlationId }, headers);
}
