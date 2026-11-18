import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import type { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseUserClient } from '@/lib/supabaseServer';
import { errorResponse } from '@/lib/apiError';

export interface AuthedRequest {
  userId: string;
  accessToken: string;
  client: SupabaseClient;
}

/**
 * Resolves the signed-in user from `Authorization: Bearer <access token>` and returns a client
 * that acts as that user, so row-level security applies to everything it does.
 */
export async function requireUser(request: Request): Promise<AuthedRequest | { error: NextResponse }> {
  const header = request.headers.get('authorization') ?? '';
  const accessToken = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!accessToken) return { error: errorResponse('UNAUTHENTICATED') };

  const client = getSupabaseUserClient(accessToken);
  // getUser asks the auth server, so a forged or revoked token is rejected here.
  const { data, error } = await client.auth.getUser(accessToken);
  if (error || !data.user) return { error: errorResponse('UNAUTHENTICATED') };

  return { userId: data.user.id, accessToken, client };
}

/** CRM permission check (member override, then role default; owners hold all). */
export async function requireOrgPermission(
  client: SupabaseClient,
  orgId: string,
  permission: string,
): Promise<{ error: NextResponse } | null> {
  const { data, error } = await client.rpc('org_has_permission', { p_org: orgId, p_perm: permission });
  if (error || data !== true) return { error: errorResponse('ACCESS_DENIED') };
  return null;
}

/** Cron and internal-webhook routes authenticate with `Authorization: Bearer ${secret}`. */
export function hasBearerSecret(request: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const given = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function requireCronSecret(request: Request): { error: NextResponse } | null {
  return hasBearerSecret(request, process.env.CRON_SECRET) ? null : { error: errorResponse('UNAUTHENTICATED') };
}
