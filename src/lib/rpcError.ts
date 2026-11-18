import type { PostgrestError } from '@supabase/supabase-js';

export interface RpcFailure {
  code: string;
  details: Record<string, unknown>;
}

// SQL functions raise `MESSAGE = '<CODE>', DETAIL = '<json>'`; anything else is unexpected.
export function parseRpcError(error: PostgrestError | null | undefined): RpcFailure {
  if (!error) return { code: 'INTERNAL', details: {} };
  if (error.code === 'P0001' && /^[A-Z_]+$/.test(error.message)) {
    let details: Record<string, unknown> = {};
    try {
      details = error.details ? JSON.parse(error.details) : {};
    } catch {
      details = {};
    }
    return { code: error.message, details };
  }
  if (error.code === '42501') return { code: 'ACCESS_DENIED', details: {} };
  return { code: 'INTERNAL', details: {} };
}
