import 'server-only';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Service-role client: bypasses row-level security.
 *
 * Allowed only in cron and outbox workers, webhook handlers and the public API after the API
 * key has been resolved to an organization (rule R11). Every query through it must filter by
 * org_id explicitly. Never use it in a request made by a signed-in user; use
 * getSupabaseUserClient for that.
 *
 * There is deliberately no fallback to the anon key: a missing service key must fail loudly
 * rather than silently turn privileged jobs into no-ops behind RLS.
 */
let cachedClient: SupabaseClient | null = null;

export function getSupabaseServerClient(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set');
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  }

  cachedClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedClient;
}

/** Short alias for server-only modules that query in many places. Same rules as above. */
export const serviceDb = getSupabaseServerClient;

/**
 * Per-request client that acts AS the calling user: anon key + the user's
 * JWT on every request, so RLS resolves auth.uid() server-side.
 *
 * Use it for every route a signed-in user calls. Never cached: the token is request-scoped.
 */
export function getSupabaseUserClient(accessToken: string): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('Supabase URL / anon key not configured');
  }
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
