'use client';

import { useLedgerText, type CategoryOption } from '@/sme/ledger/ui/shared';
import { actionValues } from '../domain/text';
import type { Evidence } from '../domain/types';

export interface ActionRow {
  id: string;
  rule_code: string;
  subject_type: string | null;
  subject_id: string | null;
  severity: 'info' | 'warning' | 'critical';
  title_key: string;
  body_key: string;
  params: Record<string, unknown>;
  evidence: Evidence[];
  status: 'open' | 'snoozed' | 'resolved' | 'dismissed';
  snooze_until: string | null;
  decided_at: string | null;
  decision_reason: string | null;
  crm_task_id: string | null;
  created_at: string;
}

/** Action text in the UI locale: titles, bodies and evidence values with their own formats. */
export function useActionText(categories: CategoryOption[]) {
  const L = useLedgerText();
  const values = (params: Record<string, unknown>) => {
    // profile.missing_fact (W2-03) names the missing item; show its label.
    if (typeof params.item === 'string') {
      const item = params.item;
      const id = item.startsWith('fact.') ? `sme.${item}.label` : `sme.profile.field.${item.replace(/^profile\./, '')}`;
      return { item: L.intl.messages[id] ? L.t(id) : item };
    }
    return actionValues(params, {
      money: minor => L.amount(minor, 'JOD'),
      date: iso => L.date(iso),
      number: n => L.number(n),
      category: code => { const c = categories.find(x => x.code === code); return c ? L.localName(c.nameEn, c.nameAr) : code; },
    });
  };
  const evidenceValue = (e: Evidence) => {
    switch (e.format) {
      case 'money': return L.amount(e.value, 'JOD');
      case 'date': return L.date(e.value);
      case 'percent': return `${L.number(Number(e.value))}${L.isAr ? '٪' : '%'}`;
      case 'days':
      case 'count': return L.number(Number(e.value));
      default: return e.value;
    }
  };
  return {
    ...L,
    title: (a: ActionRow) => L.t(a.title_key, values(a.params)),
    body: (a: ActionRow) => L.t(a.body_key, values(a.params)),
    evidenceValue,
  };
}

/** Where an action's figures live, for the drill-down link (R4). */
export function actionHref(a: ActionRow): string | null {
  switch (a.rule_code) {
    case 'receivable_overdue': return a.subject_id ? `/crm/money/receivables/${a.subject_id}` : '/crm/money/receivables';
    case 'payables_due_soon': return a.subject_id ? `/crm/money/payables/${a.subject_id}` : '/crm/money/payables';
    case 'forecast_shortfall': return '/crm/money/forecast';
    case 'cost_spike':
    case 'uncategorized_backlog': return '/crm/money/transactions';
    case 'stale_account_data': return '/crm/money/transactions/import';
    case 'concentration_risk': return a.subject_id ? `/crm/companies/${a.subject_id}` : '/crm/money/receivables';
    case 'profile.missing_fact': return '/crm/settings/business/profile';
    default: return null;
  }
}
