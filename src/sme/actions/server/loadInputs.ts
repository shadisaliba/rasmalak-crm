import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fromDbError } from '@/sme/api/errors';
import { isoAddDays } from '@/sme/forecast/engine-core/dates';
import { loadForecastInputs } from '@/sme/forecast/server/loadInputs';
import { recordForecast } from '@/sme/forecast/server/forecast';
import type { ActionInputs, CustomerRevenue, ForecastSummary, RuleCode, RuleSetting } from '../domain/types';

const CONCENTRATION_DAYS = 90;
const UNCATEGORIZED_DAYS = 90;
const EXPENSE_DAYS = 400;

const later = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);

/**
 * Inputs for every rule, from the worker's service client: each query filters by org_id. The
 * registers, history and accounts come from the forecast module's loader, so both see the same.
 */
export async function loadActionInputs(db: SupabaseClient, org: string, today: string): Promise<ActionInputs> {
  const f = await loadForecastInputs(db, org, today);

  // The baseline as of today: stored once per input digest, so this is cheap when nothing changed.
  const [quality, run, revenue] = await Promise.all([
    db.rpc('sme_data_quality_inputs', { p_org: org }),
    recordForecast(db, org, null, true),
    db.from('sme_invoice_balances').select('invoice_id, customer_company_id, customer_contact_id, currency, total_minor::text, derived_status')
      .eq('org_id', org).gte('issue_date', isoAddDays(today, -CONCENTRATION_DAYS)).not('derived_status', 'in', '(draft,void)'),
  ]);
  if (quality.error) throw fromDbError(quality.error);
  if (revenue.error) throw fromDbError(revenue.error);

  const activity = new Map(((quality.data as { accounts: Array<{ account_id: string; last_date: string | null; last_import_date: string | null }> }).accounts)
    .map(a => [a.account_id, later(a.last_date, a.last_import_date)]));

  const r = run.result;
  const week = (i: number | null) => (i === null || !r.weeks[i] ? null : { weekStart: r.weeks[i].start, closingMinor: BigInt(r.weeks[i].closingMinor) });
  const buffer = week(r.firstBelowBufferWeek);
  const forecast: ForecastSummary | null = r.accounts.length === 0 ? null
    : { runId: run.run.id, belowZero: week(r.firstBelowZeroWeek), belowBuffer: buffer ? { ...buffer, bufferMinor: BigInt(r.bufferMinor) } : null };

  // Concentration uses JOD invoices only; other currencies would need a rate per invoice date.
  const byParty = new Map<string, CustomerRevenue>();
  const names = new Map<string, string>([...f.receivables.map(r => [r.partyKey, r.partyName] as const)]);
  const rows = ((revenue.data ?? []) as Array<{ customer_company_id: string | null; customer_contact_id: string | null; currency: string; total_minor: string }>)
    .filter(r => r.currency === 'JOD');
  const missing = [...new Set(rows.filter(r => r.customer_company_id).map(r => r.customer_company_id!))].filter(id => !names.has(`company:${id}`));
  if (missing.length) {
    const { data, error } = await db.from('crm_companies').select('id, name').eq('org_id', org).in('id', missing);
    if (error) throw fromDbError(error);
    for (const c of data ?? []) names.set(`company:${c.id}`, String(c.name));
  }
  for (const r of rows) {
    const key = r.customer_company_id ? `company:${r.customer_company_id}` : `contact:${r.customer_contact_id}`;
    const entry = byParty.get(key) ?? { partyKey: key, partyName: names.get(key) ?? '', companyId: r.customer_company_id, minor: 0n, invoices: 0 };
    entry.minor += BigInt(r.total_minor);
    entry.invoices += 1;
    byParty.set(key, entry);
  }

  const recent = f.history.filter(t => t.date >= isoAddDays(today, -UNCATEGORIZED_DAYS) && t.categoryKind !== 'transfer' && t.categoryKind !== 'opening_balance');
  return {
    today,
    invoices: f.receivables.map(r => ({ id: r.id, number: r.number, partyKey: r.partyKey, partyName: r.partyName, dueDate: r.dueDate, outstandingMinor: r.outstandingMinor })),
    bills: f.payables.map(b => ({ id: b.id, reference: b.reference, partyName: b.partyName, dueDate: b.dueDate, outstandingMinor: b.outstandingMinor })),
    forecast,
    accounts: f.accounts.map(a => ({ id: a.id, name: a.name, lastActivity: activity.get(a.id) ?? null })),
    uncategorized: { count: recent.filter(t => !t.categoryCode).length, total: recent.length },
    expenses: f.history
      .filter(t => t.amountMinor < 0n && !t.matched && t.categoryKind === 'expense' && t.date >= isoAddDays(today, -EXPENSE_DAYS))
      .map(t => ({ id: t.id, date: t.date, amountMinor: t.amountMinor, categoryCode: t.categoryCode, description: t.description })),
    revenue: [...byParty.values()].sort((a, b) => (a.partyKey < b.partyKey ? -1 : 1)),
  };
}

export async function loadRuleSettings(db: SupabaseClient, org: string): Promise<Partial<Record<RuleCode, RuleSetting>>> {
  const { data, error } = await db.from('sme_action_settings').select('rule_code, enabled, params').eq('org_id', org);
  if (error) throw fromDbError(error);
  return Object.fromEntries((data ?? []).map(r => [r.rule_code, { enabled: Boolean(r.enabled), params: (r.params ?? {}) as Record<string, number> }]));
}
