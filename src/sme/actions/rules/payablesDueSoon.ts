import { daysBetween } from '@/sme/ledger/domain/dates';
import type { Rule } from '../domain/types';

// One action per bill that is overdue or due within the window, so nothing is paid late by surprise.
export const payablesDueSoon: Rule = {
  code: 'payables_due_soon',
  version: '1.0.0',
  defaults: { days_ahead: 7 },
  evaluate(inputs, p) {
    return inputs.bills.flatMap(bill => {
      const daysLeft = daysBetween(inputs.today, bill.dueDate);
      if (daysLeft > p.days_ahead || bill.outstandingMinor <= 0n) return [];
      const overdue = daysLeft < 0;
      return [{
        rule_code: 'payables_due_soon', rule_version: this.version, dedupe_key: `payables_due_soon:${bill.id}`,
        subject_type: 'bill', subject_id: bill.id, severity: overdue ? 'warning' : 'info',
        title_key: `actions.rule.payables_due_soon.${overdue ? 'overdue' : 'soon'}.title`, body_key: 'actions.rule.payables_due_soon.body',
        params: { supplier: bill.partyName, reference: bill.reference, amount: bill.outstandingMinor.toString(), due: bill.dueDate, days: Math.abs(daysLeft) },
        evidence: [
          { kind: 'bill', id: bill.id, label_key: 'actions.evidence.outstanding', value: bill.outstandingMinor.toString(), format: 'money' },
          { kind: 'bill', id: bill.id, label_key: 'actions.evidence.dueDate', value: bill.dueDate, format: 'date' },
        ],
        competency_tags: ['cash_planning', 'suppliers'], required_perm: 'sme.payables.read',
      }];
    });
  },
};
