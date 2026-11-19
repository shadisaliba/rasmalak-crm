import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SmeError, fromDbError } from '@/sme/api/errors';
import { encodeCursor, decodeCursor, type listTransactionsQuery } from '../api/schemas';
import type { z } from 'zod';
import { isStale, todayInAmman } from '../domain/dates';
import type { AccountSummary, TransactionRow } from '../types';

export async function listAccounts(db: SupabaseClient, orgId: string): Promise<AccountSummary[]> {
  const [accounts, balances] = await Promise.all([
    db.from('sme_accounts').select('id, kind, name, name_ar, institution, currency, status, created_at').eq('org_id', orgId).order('created_at'),
    db.from('sme_account_balances')
      .select('account_id, balance_minor::text, base_balance_minor::text, last_value_date, transaction_count, has_estimated_opening')
      .eq('org_id', orgId),
  ]);
  if (accounts.error) throw fromDbError(accounts.error);
  if (balances.error) throw fromDbError(balances.error);
  const byId = new Map((balances.data ?? []).map(b => [b.account_id, b]));
  const today = todayInAmman();
  return (accounts.data ?? []).map(a => {
    const b = byId.get(a.id);
    return {
      id: a.id, kind: a.kind, name: a.name, nameAr: a.name_ar, institution: a.institution, currency: a.currency, status: a.status,
      balanceMinor: b?.balance_minor ?? '0', baseBalanceMinor: b?.base_balance_minor ?? '0',
      lastValueDate: b?.last_value_date ?? null, transactionCount: b?.transaction_count ?? 0,
      hasEstimatedOpening: b?.has_estimated_opening ?? false,
      stale: isStale(b?.last_value_date ?? null, today),
    };
  });
}

export async function listTransactions(db: SupabaseClient, orgId: string, query: z.infer<typeof listTransactionsQuery>) {
  const after = query.cursor ? decodeCursor(query.cursor) : undefined;
  if (after === null) throw new SmeError('VALIDATION_FAILED', { field: 'cursor' });
  const filter = {
    account_id: query.account, category_id: query.category, channel: query.channel,
    from: query.from, to: query.to, q: query.q, after,
  };
  const { data, error } = await db.rpc('sme_transactions_page', { p_org: orgId, p_filter: filter, p_limit: query.limit });
  if (error) throw fromDbError(error);
  const rows = (data ?? []) as TransactionRow[];
  const hasMore = rows.length > query.limit;
  const items = hasMore ? rows.slice(0, query.limit) : rows;
  return { items, next_cursor: hasMore ? encodeCursor(items[items.length - 1]) : null };
}
