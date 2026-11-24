import { describe, expect, it } from 'vitest';
import en from '@/messages/en';
import ar from '@/messages/ar';
import { contextWithoutRules, listCalculators, runCalculation } from '../core/run';
import type { CalcOutcome, FieldSpec, ResultValue } from '../core/types';

// Calculator text is looked up by keys built at runtime, which the static i18n check cannot see.
// This runs every calculator's example and checks each key it can show exists in both locales.

function fieldKeys(fields: FieldSpec[]): string[] {
  return fields.flatMap(f => [
    f.labelKey, ...(f.helpKey ? [f.helpKey] : []),
    ...(f.kind === 'select' ? f.options.map(o => o.labelKey) : []),
    ...(f.kind === 'items' ? [f.addLabelKey, ...fieldKeys(f.itemFields)] : []),
  ]);
}

function valueKeys(v: ResultValue): string[] {
  if (v.kind === 'none') return [v.reasonKey];
  if (v.kind === 'text') return [v.textKey];
  return [];
}

function outcomeKeys(outcome: CalcOutcome): string[] {
  if (!outcome.ok) return outcome.errors.map(e => e.messageKey);
  const { figures, tables } = outcome.output;
  return [
    ...figures.flatMap(f => [f.labelKey, ...valueKeys(f.value)]),
    ...tables.flatMap(t => [
      t.titleKey, ...t.columns.map(c => c.labelKey),
      ...t.rows.flatMap(r => [...(r.labelKey ? [r.labelKey] : []), ...Object.values(r.cells).flatMap(valueKeys)]),
    ]),
    ...outcome.trace.map(s => s.labelKey),
    ...outcome.assumptions.map(a => a.messageKey),
    ...outcome.warnings.map(w => w.messageKey),
  ];
}

describe('calculator text', () => {
  const ctx = contextWithoutRules('2026-11-22');
  for (const calc of listCalculators()) {
    it(`${calc.code}: every key it can show exists in Arabic and English`, () => {
      const keys = new Set([`calc.${calc.code}.title`, `calc.${calc.code}.description`, ...fieldKeys(calc.fields)]);
      if (calc.unavailableReasonKey) keys.add(calc.unavailableReasonKey);
      else for (const k of outcomeKeys(runCalculation(calc.code, calc.example, ctx).outcome)) keys.add(k);
      const missing = [...keys].filter(k => !(k in en) || !(k in ar));
      expect(missing).toEqual([]);
    });

    it(`${calc.code}: the example runs`, () => {
      if (calc.unavailableReasonKey || calc.screen) return;
      const outcome = runCalculation(calc.code, calc.example, ctx).outcome;
      // Regulated calculators may fail closed without a reviewed rule; anything else must succeed.
      if (!outcome.ok) expect(outcome.errors.map(e => e.code)).toEqual(['RULE_NOT_VERIFIED']);
    });
  }
});
