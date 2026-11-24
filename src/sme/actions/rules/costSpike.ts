import { computeCategoryBaselines, detectCategoryDeviations } from '@/sme/forecast/engine-core/categoryBaselines';
import { getCycleRange } from '@/sme/forecast/engine-core/cycles';
import { collectSeriesMemberIds, detectRecurringSeries } from '@/sme/forecast/engine-core/recurringSeries';
import type { EngineTransaction } from '@/sme/forecast/engine-core/engineTypes';
import type { Rule } from '../domain/types';

// This month's spending per category against its own median and spread over past months (the
// ported baselines: at least 3 months of history, pace-adjusted, quiet in the first days).
// Recurring payments such as rent are left out of both sides, as the baselines expect: a lump
// sum on the 1st would otherwise look like a month's pace exploding.
export const costSpike: Rule = {
  code: 'cost_spike',
  version: '1.0.0',
  defaults: {},
  evaluate(inputs) {
    const now = new Date(`${inputs.today}T12:00:00`);
    // Statistics on exact integer minor units; the action shows them back as bigint strings.
    const txs: EngineTransaction[] = inputs.expenses
      .filter(t => t.amountMinor < 0n && t.categoryCode)
      .map(t => ({ id: t.id, date: t.date, type: 'expense', category: t.categoryCode, description: t.description, amountBase: Number(-t.amountMinor) }));
    const recurring = collectSeriesMemberIds(detectRecurringSeries(txs, { now }));
    const baselines = computeCategoryBaselines(txs, { now, excludeTransactionIds: recurring });
    const cycle = getCycleRange({ mode: 'calendar', anchorDay: null, now });
    const month = inputs.today.slice(0, 7);
    return detectCategoryDeviations(baselines, txs, cycle, recurring).filter(d => d.severity !== 'none').map(d => ({
      rule_code: 'cost_spike', rule_version: this.version, dedupe_key: `cost_spike:${d.categoryId}:${month}`,
      subject_type: 'category', subject_id: null, severity: d.severity === 'high' ? 'warning' : 'info',
      title_key: 'actions.rule.cost_spike.title', body_key: 'actions.rule.cost_spike.body',
      params: { category: d.categoryId, spent: String(Math.round(d.currentSpend)), usual: String(Math.round(d.monthlyMedian)), percent: d.deviationPct },
      evidence: [
        { kind: 'category', id: d.categoryId, label_key: 'actions.evidence.spentThisMonth', value: String(Math.round(d.currentSpend)), format: 'money' },
        { kind: 'category', id: d.categoryId, label_key: 'actions.evidence.usualMonth', value: String(Math.round(d.monthlyMedian)), format: 'money' },
      ],
      competency_tags: ['costs'], required_perm: 'sme.ledger.read',
    }));
  },
};
