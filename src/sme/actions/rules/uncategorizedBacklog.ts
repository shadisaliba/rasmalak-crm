import type { Rule } from '../domain/types';

// Uncategorized lines weaken every figure built on categories (KPIs, cost spikes, the spending band).
export const uncategorizedBacklog: Rule = {
  code: 'uncategorized_backlog',
  version: '1.0.0',
  defaults: { min_count: 20, min_percent: 20 },
  evaluate(inputs, p) {
    const { count, total } = inputs.uncategorized;
    const percent = total > 0 ? Math.floor((count * 100) / total) : 0;
    if (count < p.min_count && percent < p.min_percent) return [];
    if (count === 0) return [];
    return [{
      rule_code: 'uncategorized_backlog', rule_version: this.version, dedupe_key: 'uncategorized_backlog',
      subject_type: null, subject_id: null, severity: 'info',
      title_key: 'actions.rule.uncategorized_backlog.title', body_key: 'actions.rule.uncategorized_backlog.body',
      params: { count, percent },
      evidence: [
        { kind: 'transactions', label_key: 'actions.evidence.uncategorized', value: String(count), format: 'count' },
        { kind: 'transactions', label_key: 'actions.evidence.share', value: String(percent), format: 'percent' },
      ],
      competency_tags: ['bookkeeping'], required_perm: 'sme.ledger.read',
    }];
  },
};
