import { daysBetween } from '@/sme/ledger/domain/dates';
import type { Rule } from '../domain/types';

// One action per overdue invoice; it resolves itself once the invoice is paid, voided or written off.
export const receivableOverdue: Rule = {
  code: 'receivable_overdue',
  version: '1.0.0',
  defaults: { min_days_overdue: 1, critical_days: 30 },
  evaluate(inputs, p) {
    return inputs.invoices.flatMap(inv => {
      const days = daysBetween(inv.dueDate, inputs.today);
      if (days < p.min_days_overdue || inv.outstandingMinor <= 0n) return [];
      return [{
        rule_code: 'receivable_overdue', rule_version: this.version, dedupe_key: `receivable_overdue:${inv.id}`,
        subject_type: 'invoice', subject_id: inv.id, severity: days >= p.critical_days ? 'critical' : 'warning',
        title_key: 'actions.rule.receivable_overdue.title', body_key: 'actions.rule.receivable_overdue.body',
        params: { customer: inv.partyName, number: inv.number, amount: inv.outstandingMinor.toString(), days, due: inv.dueDate },
        evidence: [
          { kind: 'invoice', id: inv.id, label_key: 'actions.evidence.outstanding', value: inv.outstandingMinor.toString(), format: 'money' },
          { kind: 'invoice', id: inv.id, label_key: 'actions.evidence.dueDate', value: inv.dueDate, format: 'date' },
          { kind: 'invoice', id: inv.id, label_key: 'actions.evidence.daysOverdue', value: String(days), format: 'days' },
        ],
        competency_tags: ['collections'], required_perm: 'sme.receivables.read',
      }];
    });
  },
};
