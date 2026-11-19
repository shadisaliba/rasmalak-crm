'use client';

import { supabase } from '@/lib/supabaseClient';

export interface SmeApiError {
  code: string;
  message_en: string;
  message_ar: string;
  details?: Record<string, unknown>;
}

export type SmeResult<T> = { ok: true; data: T } | { ok: false; status: number; error: SmeApiError };

const NETWORK_ERROR: SmeApiError = {
  code: 'NETWORK',
  message_en: 'The server could not be reached. Check your connection and try again.',
  message_ar: 'تعذّر الوصول إلى الخادم. تحقّق من الاتصال وحاول مرة أخرى.',
};

/**
 * Calls /api/sme/v1/*. Writes carry an Idempotency-Key: a form keeps the same key across retries
 * of one submission, so a double click or a retried request posts once.
 */
export async function smeApi<T>(
  path: string,
  options: { orgId: string; method?: 'GET' | 'POST'; body?: unknown; idempotencyKey?: string },
): Promise<SmeResult<T>> {
  const { data } = await supabase.auth.getSession();
  const headers: Record<string, string> = { 'x-org-id': options.orgId, 'x-correlation-id': crypto.randomUUID() };
  if (data.session?.access_token) headers.authorization = `Bearer ${data.session.access_token}`;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.method === 'POST') headers['idempotency-key'] = options.idempotencyKey ?? crypto.randomUUID();

  let res: Response;
  try {
    res = await fetch(`/api/sme/v1/${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    return { ok: false, status: 0, error: NETWORK_ERROR };
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const error = json?.error && typeof json.error.code === 'string' ? (json.error as SmeApiError) : { ...NETWORK_ERROR, code: 'INTERNAL' };
    return { ok: false, status: res.status, error };
  }
  return { ok: true, data: json as T };
}

export function errorText(error: SmeApiError, locale: string): string {
  return locale.startsWith('ar') ? error.message_ar : error.message_en;
}
