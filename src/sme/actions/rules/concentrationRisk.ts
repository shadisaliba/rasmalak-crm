import type { Rule } from '../domain/types';

// When one customer brings most of the revenue, losing them is the biggest cash risk.
export const concentrationRisk: Rule = {
  code: 'concentration_risk',
  version: '1.0.0',
  defaults: { top_share_percent: 50, min_customers: 2, min_invoices: 3 },
  evaluate(inputs, p) {
    const total = inputs.revenue.reduce((s, r) => s + r.minor, 0n);
    const invoices = inputs.revenue.reduce((s, r) => s + r.invoices, 0);
    if (total <= 0n || inputs.revenue.length < p.min_customers || invoices < p.min_invoices) return [];
    const top = [...inputs.revenue].sort((a, b) => (b.minor > a.minor ? 1 : b.minor < a.minor ? -1 : a.partyKey < b.partyKey ? -1 : 1))[0];
    // Floor, so 49.9 % does not pass a 50 % threshold.
    const share = Number((top.minor * 100n) / total);
    if (share < p.top_share_percent) return [];
    return [{
      rule_code: 'concentration_risk', rule_version: this.version, dedupe_key: `concentration_risk:${top.partyKey}`,
      subject_type: top.companyId ? 'company' : null, subject_id: top.companyId, severity: 'info',
      title_key: 'actions.rule.concentration_risk.title', body_key: 'actions.rule.concentration_risk.body',
      params: { customer: top.partyName, percent: share, amount: top.minor.toString(), total: total.toString() },
      evidence: [
        { kind: 'customer', id: top.companyId ?? undefined, label_key: 'actions.evidence.customerRevenue', value: top.minor.toString(), format: 'money' },
        { kind: 'customer', label_key: 'actions.evidence.totalRevenue', value: total.toString(), format: 'money' },
        { kind: 'customer', label_key: 'actions.evidence.share', value: String(share), format: 'percent' },
      ],
      competency_tags: ['sales', 'risk'], required_perm: 'sme.receivables.read',
    }];
  },
};
