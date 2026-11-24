import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fromDbError } from '@/sme/api/errors';
import type { FieldSpec, PrefillSource } from '../core/types';

export interface PrefillSuggestion {
  field: string;
  source: PrefillSource;
  /** Minor units in the organization's base currency. */
  value_minor: string;
  as_of: string;
  /** Records the figure is built from, and records left out because of their currency. */
  count: number;
  excluded: number;
}

const OPEN_STATUSES = ['open', 'partially_paid', 'overdue'];

/**
 * Suggestions only (CAL-02): nothing runs a calculation here. Reads go through RLS, so a member
 * without access to the ledger or the registers gets no suggestion from them.
 */
export async function loadPrefill(db: SupabaseClient, org: string, fields: FieldSpec[], today: string): Promise<{ currency: string; suggestions: PrefillSuggestion[] }> {
  const { data: orgRow, error: orgError } = await db.from('organizations').select('currency').eq('id', org).single();
  if (orgError) throw fromDbError(orgError);
  const currency = (orgRow?.currency as string | null) ?? 'JOD';

  const suggestions: PrefillSuggestion[] = [];
  for (const field of fields) {
    if (field.kind !== 'money' || !field.prefill) continue;
    const s = await suggest(db, org, field.prefill, currency, today);
    if (s && s.count > 0) suggestions.push({ field: field.key, ...s });
  }
  return { currency, suggestions };
}

async function suggest(db: SupabaseClient, org: string, source: PrefillSource, currency: string, today: string) {
  if (source === 'cash_total') {
    // Balances in the base currency, as the accounts screen shows them.
    const { data, error } = await db.from('sme_account_balances')
      .select('base_balance_minor::text, last_value_date').eq('org_id', org).eq('status', 'active');
    if (error) throw fromDbError(error);
    const rows = (data ?? []) as { base_balance_minor: string; last_value_date: string | null }[];
    const asOf = rows.map(r => r.last_value_date).filter((d): d is string => !!d).sort().at(-1) ?? today;
    return { source, value_minor: rows.reduce((s, r) => s + BigInt(r.base_balance_minor), 0n).toString(), as_of: asOf, count: rows.length, excluded: 0 };
  }
  const view = source === 'receivables_outstanding' ? 'sme_invoice_balances' : 'sme_bill_balances';
  const { data, error } = await db.from(view)
    .select('currency, outstanding_minor::text').eq('org_id', org).in('derived_status', OPEN_STATUSES);
  if (error) throw fromDbError(error);
  const rows = (data ?? []) as { currency: string; outstanding_minor: string }[];
  const inBase = rows.filter(r => r.currency === currency);
  return {
    source, value_minor: inBase.reduce((s, r) => s + BigInt(r.outstanding_minor), 0n).toString(), as_of: today,
    count: inBase.length, excluded: rows.length - inBase.length,
  };
}
