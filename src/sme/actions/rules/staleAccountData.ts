import { STALE_AFTER_DAYS, daysBetween } from '@/sme/ledger/domain/dates';
import type { Rule } from '../domain/types';

// Figures are only as current as the least current account (W2-07), so a quiet account is flagged.
export const staleAccountData: Rule = {
  code: 'stale_account_data',
  version: '1.0.0',
  defaults: { days: STALE_AFTER_DAYS },
  evaluate(inputs, p) {
    return inputs.accounts.flatMap(a => {
      const days = a.lastActivity ? daysBetween(a.lastActivity, inputs.today) : null;
      if (days !== null && days <= p.days) return [];
      return [{
        rule_code: 'stale_account_data', rule_version: this.version, dedupe_key: `stale_account_data:${a.id}`,
        subject_type: 'account', subject_id: a.id, severity: 'info',
        title_key: days === null ? 'actions.rule.stale_account_data.empty.title' : 'actions.rule.stale_account_data.title',
        body_key: 'actions.rule.stale_account_data.body',
        params: { account: a.name, ...(days === null ? {} : { days, date: a.lastActivity! }) },
        evidence: days === null ? [] : [{ kind: 'account', id: a.id, label_key: 'actions.evidence.lastActivity', value: a.lastActivity!, format: 'date' }],
        competency_tags: ['bookkeeping'], required_perm: 'sme.ledger.read',
      }];
    });
  },
};
