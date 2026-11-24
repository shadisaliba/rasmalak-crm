import type { Rule } from '../domain/types';

// From the latest baseline forecast run (W3a-07): below zero is critical, below the buffer a warning.
export const forecastShortfall: Rule = {
  code: 'forecast_shortfall',
  version: '1.0.0',
  defaults: {},
  evaluate(inputs) {
    const f = inputs.forecast;
    if (!f) return [];
    const hit = f.belowZero ? { kind: 'zero' as const, ...f.belowZero } : f.belowBuffer ? { kind: 'buffer' as const, ...f.belowBuffer } : null;
    if (!hit) return [];
    return [{
      rule_code: 'forecast_shortfall', rule_version: this.version, dedupe_key: `forecast_shortfall:${hit.kind}`,
      subject_type: 'forecast', subject_id: f.runId, severity: hit.kind === 'zero' ? 'critical' : 'warning',
      title_key: `actions.rule.forecast_shortfall.${hit.kind}.title`, body_key: `actions.rule.forecast_shortfall.${hit.kind}.body`,
      params: { week: hit.weekStart, amount: hit.closingMinor.toString(), ...(hit.kind === 'buffer' ? { buffer: f.belowBuffer!.bufferMinor.toString() } : {}) },
      evidence: [
        { kind: 'forecast', id: f.runId, label_key: 'actions.evidence.week', value: hit.weekStart, format: 'date' },
        { kind: 'forecast', id: f.runId, label_key: 'actions.evidence.closing', value: hit.closingMinor.toString(), format: 'money' },
      ],
      competency_tags: ['cash_planning'], required_perm: 'sme.forecast.read',
    }];
  },
};
