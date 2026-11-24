import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createIntl, createIntlCache, type IntlShape } from 'react-intl';
import { fromDbError } from '@/sme/api/errors';
import { todayInAmman } from '@/sme/ledger/domain/dates';
import { assessDataQuality, DATA_QUALITY_VERSION } from '@/sme/kpi/domain/dataQuality';
import { computeFinancialSummary, KPI_VERSION, type Metric, type Reason } from '@/sme/kpi/domain/summary';
import { loadKpiInputs } from '@/sme/kpi/server/summary';
import { ENGINE_VERSION } from '@/sme/forecast/domain/types';
import { INTL_LOCALE } from '@/sme/money';
import enMessages from '@/messages/en';
import arMessages from '@/messages/ar';
import { displayValue, type ReportCode, type ReportDoc, type ReportRow, type ReportSection } from '../domain/render';

export interface ReportRequest { code: ReportCode; period: { from: string; to: string }; locale: 'ar' | 'en' }

type Row = Record<string, unknown>;
const party = (company: unknown, contact: unknown) => (company ? `company:${company}` : contact ? `contact:${contact}` : null);

async function names(db: SupabaseClient, org: string): Promise<Map<string, string>> {
  const [companies, contacts] = await Promise.all([
    db.from('crm_companies').select('id, name').eq('org_id', org).limit(5000),
    db.from('crm_contacts').select('id, first_name, last_name').eq('org_id', org).limit(5000),
  ]);
  if (companies.error) throw fromDbError(companies.error);
  if (contacts.error) throw fromDbError(contacts.error);
  const m = new Map<string, string>();
  for (const c of companies.data ?? []) m.set(`company:${c.id}`, String(c.name));
  for (const c of contacts.data ?? []) m.set(`contact:${c.id}`, [c.first_name, c.last_name].filter(Boolean).join(' '));
  return m;
}

function reasonText(t: IntlShape, r: Reason, locale: 'ar' | 'en'): string {
  const values = Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'code').map(([k, v]) =>
    [k, k === 'from' || k === 'to' ? displayValue(String(v), 'date', locale) : typeof v === 'number' ? displayValue(String(v), 'count', locale) : k === 'percent' ? displayValue(String(v), 'count', locale) : String(v ?? '')]));
  return t.formatMessage({ id: `kpi.reason.${r.code}` }, values);
}

/**
 * Builds a report from organization-scoped reads with the caller's client, so RLS also applies
 * (W3a-10 step 4). Every query names the organization; a report never reads another one.
 */
export async function buildReport(db: SupabaseClient, org: string, req: ReportRequest): Promise<ReportDoc> {
  const { code, period, locale } = req;
  const t = createIntl({ locale: INTL_LOCALE[locale], messages: locale === 'ar' ? arMessages : enMessages }, createIntlCache());
  const tr = (id: string, values?: Record<string, string | number>) => t.formatMessage({ id }, values);
  const asOf = todayInAmman();
  const [orgRow, quality, categories] = await Promise.all([
    db.from('organizations').select('name, name_ar').eq('id', org).maybeSingle(),
    db.rpc('sme_data_quality_inputs', { p_org: org }),
    db.from('sme_categories').select('id, code, name_en, name_ar').or(`org_id.is.null,org_id.eq.${org}`),
  ]);
  for (const r of [orgRow, quality, categories]) if (r.error) throw fromDbError(r.error);
  const catName = (code: string | null) => {
    if (!code) return tr('reports.value.uncategorized');
    const c = (categories.data ?? []).find(x => x.code === code);
    return c ? String(locale === 'ar' ? c.name_ar : c.name_en) : code;
  };
  const channelName = (c: string | null) => (c && t.messages[`sme.channel.${c}`] ? tr(`sme.channel.${c}`) : tr('reports.value.unknown'));
  const q = quality.data as { accounts: Array<{ account_id: string; first_date: string | null; last_date: string | null; last_import_date: string | null }>; transaction_count: number; categorized_count: number; unresolved_import_rows: number };
  const grade = assessDataQuality({
    today: asOf, transactionCount: q.transaction_count, categorizedCount: q.categorized_count, unresolvedImportRows: q.unresolved_import_rows,
    accounts: q.accounts.map(a => ({ accountId: a.account_id, firstDate: a.first_date, lastDate: a.last_date, lastImportDate: a.last_import_date })),
  }).grade;

  let sections: ReportSection[] = [];
  const usesPeriod = code === 'cash_summary' || code === 'income_expense' || code === 'transactions';

  if (code === 'cash_summary' || code === 'income_expense') {
    const inputs = await loadKpiInputs(db, org, period, asOf);
    const summary = computeFinancialSummary(inputs);
    const m = (key: Metric['key']) => summary.metrics.find(x => x.key === key)!;
    if (code === 'cash_summary') {
      const { data: accounts, error } = await db.from('sme_accounts').select('id, kind, currency').eq('org_id', org).eq('status', 'active');
      if (error) throw fromDbError(error);
      const meta = new Map((accounts ?? []).map(a => [a.id, a]));
      const breakdown = m('cleared_cash').breakdown as { by_account: Array<{ id: string; name: string; minor: string }>; by_channel: Array<{ channel: string; in_minor: string; out_minor: string }> };
      const last = new Map(inputs.accounts.map(a => [a.id, a.lastActivity]));
      sections = [
        {
          title: tr('reports.section.byAccount'),
          columns: [
            { key: 'account', label: tr('reports.col.account'), kind: 'text' }, { key: 'kind', label: tr('reports.col.kind'), kind: 'text' },
            { key: 'currency', label: tr('reports.col.currency'), kind: 'text' }, { key: 'last', label: tr('reports.col.lastActivity'), kind: 'date' },
            { key: 'balance', label: tr('reports.col.balance'), kind: 'money' },
          ],
          rows: [
            ...breakdown.by_account.map(a => ({
              account: a.name, kind: meta.get(a.id) ? tr(`sme.accountKind.${meta.get(a.id)!.kind}`) : '', currency: String(meta.get(a.id)?.currency ?? ''),
              last: last.get(a.id) ?? null, balance: a.minor,
            })),
            { account: tr('kpi.metric.cleared_cash'), kind: '', currency: 'JOD', last: null, balance: m('cleared_cash').value },
          ],
        },
        {
          title: tr('reports.section.byChannel'),
          columns: [
            { key: 'channel', label: tr('reports.col.channel'), kind: 'text' }, { key: 'in', label: tr('reports.col.in'), kind: 'money' },
            { key: 'out', label: tr('reports.col.out'), kind: 'money' }, { key: 'net', label: tr('reports.col.net'), kind: 'money' },
          ],
          rows: breakdown.by_channel.map(c => ({ channel: channelName(c.channel === 'unknown' ? null : c.channel), in: c.in_minor, out: c.out_minor, net: (BigInt(c.in_minor) - BigInt(c.out_minor)).toString() })),
        },
        metricSection(tr('reports.section.totals'), ['cash_in', 'cash_out', 'net_cash_flow']),
      ];
    } else {
      const byCategory = new Map<string, { in: bigint; out: bigint }>();
      for (const x of inputs.transactions) {
        if (x.categoryKind === 'transfer' || x.categoryKind === 'opening_balance') continue;
        const e = byCategory.get(x.categoryCode ?? '') ?? { in: 0n, out: 0n };
        if (x.amountMinor > 0n) e.in += x.amountMinor; else e.out -= x.amountMinor;
        byCategory.set(x.categoryCode ?? '', e);
      }
      sections = [
        { ...metricSection(tr('reports.section.recognized'), ['revenue_recognized', 'expenses_recognized', 'profit_estimate', 'gross_margin']), note: tr('reports.section.recognizedNote') },
        { ...metricSection(tr('reports.section.cash'), ['cash_in', 'cash_out', 'net_cash_flow']), note: tr('reports.section.cashNote') },
        {
          title: tr('reports.section.byCategory'),
          columns: [{ key: 'category', label: tr('reports.col.category'), kind: 'text' }, { key: 'in', label: tr('reports.col.in'), kind: 'money' }, { key: 'out', label: tr('reports.col.out'), kind: 'money' }],
          rows: [...byCategory.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([c, v]) => ({ category: catName(c || null), in: v.in.toString(), out: v.out.toString() })),
        },
      ];
    }

    function metricSection(title: string, keys: Metric['key'][]): ReportSection {
      return {
        title,
        columns: [{ key: 'measure', label: tr('reports.col.measure'), kind: 'text' }, { key: 'amount', label: tr('reports.col.amount'), kind: 'money' }, { key: 'status', label: tr('reports.col.status'), kind: 'text' }],
        rows: keys.map(k => {
          const metric = m(k);
          const withheld = metric.value === null
            ? tr('reports.value.withheld', { reasons: metric.reasons.map(r => reasonText(t, r, locale)).join('; ') }) : tr(`kpi.status.${metric.status}`);
          // Percent metrics go in the status column; the amount column holds money only.
          return { measure: tr(`kpi.metric.${k}`), amount: metric.unit === 'JOD' ? metric.value : null, status: metric.unit === 'percent' && metric.value !== null ? `${displayValue(metric.value, 'percent', locale)}` : withheld };
        }),
      };
    }
  } else if (code === 'receivables_ageing') {
    const people = await names(db, org);
    const [ageing, open] = await Promise.all([
      db.from('sme_receivables_ageing').select('customer_company_id, customer_contact_id, currency, is_total, current_minor::text, d1_30_minor::text, d31_60_minor::text, d61_90_minor::text, d90_plus_minor::text, total_minor::text').eq('org_id', org),
      db.from('sme_invoice_balances').select('number, customer_company_id, customer_contact_id, issue_date, due_date, currency, total_minor::text, outstanding_minor::text, days_overdue')
        .eq('org_id', org).in('derived_status', ['open', 'partially_paid', 'overdue']).order('due_date').limit(5000),
    ]);
    if (ageing.error) throw fromDbError(ageing.error);
    if (open.error) throw fromDbError(open.error);
    const buckets = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus', 'total'] as const;
    sections = [
      {
        title: tr('reports.section.byCustomer'),
        columns: [{ key: 'customer', label: tr('reports.col.customer'), kind: 'text' }, { key: 'currency', label: tr('reports.col.currency'), kind: 'text' },
          ...buckets.map(b => ({ key: b, label: tr(b === 'total' ? 'reports.col.total' : `reports.col.${b}`), kind: 'money' as const }))],
        rows: ((ageing.data ?? []) as Row[]).sort((a, b) => Number(a.is_total) - Number(b.is_total)).map(r => ({
          customer: r.is_total ? tr('reports.col.total') : people.get(party(r.customer_company_id, r.customer_contact_id) ?? '') ?? '',
          currency: String(r.currency), ...Object.fromEntries(buckets.map(b => [b, String(r[`${b}_minor`])])),
        })),
      },
      {
        title: tr('reports.section.openInvoices'),
        columns: [
          { key: 'number', label: tr('reports.col.number'), kind: 'text' }, { key: 'customer', label: tr('reports.col.customer'), kind: 'text' },
          { key: 'issue', label: tr('reports.col.issueDate'), kind: 'date' }, { key: 'due', label: tr('reports.col.dueDate'), kind: 'date' },
          { key: 'currency', label: tr('reports.col.currency'), kind: 'text' }, { key: 'total', label: tr('reports.col.total'), kind: 'money' },
          { key: 'outstanding', label: tr('reports.col.outstanding'), kind: 'money' }, { key: 'late', label: tr('reports.col.daysOverdue'), kind: 'count' },
        ],
        rows: ((open.data ?? []) as Row[]).map(r => ({
          number: String(r.number), customer: people.get(party(r.customer_company_id, r.customer_contact_id) ?? '') ?? '', issue: String(r.issue_date), due: String(r.due_date),
          currency: String(r.currency), total: String(r.total_minor), outstanding: String(r.outstanding_minor), late: String(r.days_overdue),
        })),
      },
    ];
  } else if (code === 'payables_due') {
    const people = await names(db, org);
    const { data, error } = await db.from('sme_bill_balances').select('supplier_reference, supplier_company_id, supplier_contact_id, issue_date, due_date, currency, total_minor::text, outstanding_minor::text, derived_status')
      .eq('org_id', org).in('derived_status', ['open', 'partially_paid', 'overdue']).order('due_date').limit(5000);
    if (error) throw fromDbError(error);
    sections = [{
      title: tr('reports.section.openBills'),
      columns: [
        { key: 'supplier', label: tr('reports.col.supplier'), kind: 'text' }, { key: 'reference', label: tr('reports.col.reference'), kind: 'text' },
        { key: 'issue', label: tr('reports.col.issueDate'), kind: 'date' }, { key: 'due', label: tr('reports.col.dueDate'), kind: 'date' },
        { key: 'currency', label: tr('reports.col.currency'), kind: 'text' }, { key: 'total', label: tr('reports.col.total'), kind: 'money' },
        { key: 'outstanding', label: tr('reports.col.outstanding'), kind: 'money' }, { key: 'status', label: tr('reports.col.status'), kind: 'text' },
      ],
      rows: ((data ?? []) as Row[]).map(r => ({
        supplier: people.get(party(r.supplier_company_id, r.supplier_contact_id) ?? '') ?? '', reference: String(r.supplier_reference ?? ''),
        issue: String(r.issue_date), due: String(r.due_date), currency: String(r.currency), total: String(r.total_minor), outstanding: String(r.outstanding_minor),
        status: tr(r.derived_status === 'overdue' ? 'reports.value.overdue' : 'reports.value.open'),
      })),
    }];
  } else {
    const people = await names(db, org);
    const [txs, accounts] = await Promise.all([
      db.from('sme_transactions_current').select('id, value_date, account_id, description, category_id, channel, counterparty_company_id, counterparty_contact_id, amount_minor::text, currency, base_amount_minor::text, is_reversal, is_reversed')
        .eq('org_id', org).gte('value_date', period.from).lte('value_date', period.to).order('value_date').order('id').limit(20000),
      db.from('sme_accounts').select('id, name').eq('org_id', org),
    ]);
    if (txs.error) throw fromDbError(txs.error);
    if (accounts.error) throw fromDbError(accounts.error);
    const accountName = new Map((accounts.data ?? []).map(a => [a.id, String(a.name)]));
    const catCode = new Map((categories.data ?? []).map(c => [c.id, String(c.code)]));
    sections = [{
      title: tr('reports.section.transactions'),
      columns: [
        { key: 'date', label: tr('reports.col.date'), kind: 'date' }, { key: 'account', label: tr('reports.col.account'), kind: 'text' },
        { key: 'description', label: tr('reports.col.description'), kind: 'text' }, { key: 'category', label: tr('reports.col.category'), kind: 'text' },
        { key: 'channel', label: tr('reports.col.channel'), kind: 'text' }, { key: 'counterparty', label: tr('reports.col.counterparty'), kind: 'text' },
        { key: 'currency', label: tr('reports.col.currency'), kind: 'text' }, { key: 'amount', label: tr('reports.col.amountOriginal'), kind: 'text' },
        { key: 'base', label: tr('reports.col.amountJod'), kind: 'money' }, { key: 'status', label: tr('reports.col.status'), kind: 'text' },
      ],
      rows: ((txs.data ?? []) as Row[]).map((r): ReportRow => ({
        date: String(r.value_date), account: accountName.get(String(r.account_id)) ?? '', description: String(r.description ?? ''),
        category: catName(r.category_id ? catCode.get(String(r.category_id)) ?? null : null), channel: channelName((r.channel as string | null) ?? null),
        counterparty: people.get(party(r.counterparty_company_id, r.counterparty_contact_id) ?? '') ?? '', currency: String(r.currency),
        // The original amount keeps its own currency's decimals, so it is written as text.
        amount: String(r.amount_minor), base: String(r.base_amount_minor),
        status: tr(r.is_reversal ? 'reports.value.reversal' : r.is_reversed ? 'reports.value.reversed' : 'reports.value.posted'),
      })),
    }];
  }

  const orgName = String((locale === 'ar' ? orgRow.data?.name_ar || orgRow.data?.name : orgRow.data?.name || orgRow.data?.name_ar) ?? '');
  const rows = sections.reduce((n, s) => n + s.rows.length, 0);
  const periodText = tr('reports.period.range', { from: displayValue(period.from, 'date', locale), to: displayValue(period.to, 'date', locale) });
  return {
    code, locale,
    title: tr(`reports.report.${code}`),
    subtitle: `${orgName} · ${usesPeriod ? periodText : displayValue(asOf, 'date', locale)}`,
    provenance: [
      { label: tr('reports.prov.organization'), value: orgName },
      { label: tr('reports.prov.period'), value: usesPeriod ? periodText : tr('reports.prov.none') },
      { label: tr('reports.prov.asOf'), value: displayValue(asOf, 'date', locale) },
      { label: tr('reports.prov.generatedAt'), value: new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC' },
      { label: tr('reports.prov.versions'), value: `KPI ${KPI_VERSION} · forecast ${ENGINE_VERSION} · data quality ${DATA_QUALITY_VERSION}` },
      { label: tr('reports.prov.filters'), value: usesPeriod ? `${period.from}..${period.to}` : tr('reports.prov.none') },
      { label: tr('reports.prov.rows'), value: displayValue(String(rows), 'count', locale) },
      { label: tr('reports.prov.dataQuality'), value: grade === 'insufficient' ? tr('kpi.status.insufficient_data') : grade },
      { label: tr('reports.prov.note'), value: tr('reports.note') },
    ],
    sections,
  };
}
