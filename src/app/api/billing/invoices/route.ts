/**
 * GET Invoice List
 */

import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/serverAuth';
import { mapFromDb } from '@/types/crm';
import type { Invoice } from '@/types/crm';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const orgId = url.searchParams.get('orgId');
  if (!orgId) return NextResponse.json({ error: { code: 'MISSING_ORG', message: 'orgId required' } }, { status: 400 });
  // Acting as the caller: row-level security limits results to organizations they belong to.
  const auth = await requireUser(request);
  if ('error' in auth) return auth.error;
  const supabase = auth.client;

  try {
    const { data, error } = await supabase
      .from('billing_invoices')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) return NextResponse.json({ error: { code: 'FETCH_FAILED', message: error.message } }, { status: 500 });
    return NextResponse.json({ data: (data || []).map(r => mapFromDb<Invoice>(r)) });
  } catch {
    return NextResponse.json({ error: { code: 'FETCH_FAILED', message: 'Failed to fetch invoices' } }, { status: 500 });
  }
}
