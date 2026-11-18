/**
 * Billing route auth helper.
 * Billing actions are limited to the organization's owners and admins, and run with a client
 * that acts as the caller so row-level security still applies.
 */
import 'server-only';
import type { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireUser } from '@/lib/serverAuth';
import { errorResponse } from '@/lib/apiError';

export async function requireBillingAdmin(
  request: Request,
  orgId: unknown,
): Promise<{ userId: string; supabase: SupabaseClient } | { error: NextResponse }> {
  if (typeof orgId !== 'string' || !orgId) return { error: errorResponse('VALIDATION_FAILED', { field: 'orgId' }) };
  const auth = await requireUser(request);
  if ('error' in auth) return auth;
  const { data: role } = await auth.client.rpc('get_org_role', { check_org_id: orgId });
  if (role !== 'owner' && role !== 'admin') return { error: errorResponse('ACCESS_DENIED') };
  return { userId: auth.userId, supabase: auth.client };
}
