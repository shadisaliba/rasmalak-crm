import en from '@/messages/en';
import type { CurrencyCode } from '@/sme/money';
import ar from '@/messages/ar';
import type { ApprovedParam, CalcContext, CalcOutcome, ResultTable, ResultValue } from '../core/types';

// Shared by the calculator tests only.

export function ok(outcome: CalcOutcome) {
  if (!outcome.ok) throw new Error(`expected success, got ${JSON.stringify(outcome.errors)}`);
  return outcome;
}

export function figure(outcome: CalcOutcome, key: string): ResultValue | undefined {
  return ok(outcome).output.figures.find(f => f.key === key)?.value;
}

export function table(outcome: CalcOutcome, key: string): ResultTable {
  const found = ok(outcome).output.tables.find(t => t.key === key);
  if (!found) throw new Error(`no table ${key}`);
  return found;
}

export function moneyResult(minor: string | bigint, currency: CurrencyCode = 'JOD'): ResultValue {
  return { kind: 'money', minor: minor.toString(), currency };
}

function valueKeys(v: ResultValue): string[] {
  if (v.kind === 'none') return [v.reasonKey];
  if (v.kind === 'text') return [v.textKey];
  return [];
}

/** Every message key an outcome can show that is missing from either locale. */
export function missingMessageKeys(outcome: CalcOutcome): string[] {
  const keys = !outcome.ok
    ? outcome.errors.map(e => e.messageKey)
    : [
      ...outcome.output.figures.flatMap(f => [f.labelKey, ...valueKeys(f.value)]),
      ...outcome.output.tables.flatMap(t => [
        t.titleKey, ...t.columns.map(c => c.labelKey),
        ...t.rows.flatMap(r => [...(r.labelKey ? [r.labelKey] : []), ...Object.values(r.cells).flatMap(valueKeys)]),
      ]),
      ...outcome.trace.map(s => s.labelKey),
      ...outcome.assumptions.map(a => a.messageKey),
      ...outcome.warnings.map(w => w.messageKey),
    ];
  return [...new Set(keys)].filter(k => !(k in en) || !(k in ar));
}

export type TestParam = Pick<ApprovedParam, 'value' | 'unit'> & Partial<ApprovedParam>;

/**
 * A context with obviously fictional rule versions (R16): ids start with TEST_ and sources point
 * at example.test. Records the date each parameter was asked for.
 */
export function testRuleContext(asOf: string, params: Record<string, TestParam>): CalcContext & { askedOn: Record<string, string> } {
  const askedOn: Record<string, string> = {};
  return {
    asOf,
    askedOn,
    getRuleParam(ref, onDate) {
      askedOn[ref.key] = onDate;
      const p = params[ref.key];
      if (!p) return null;
      return {
        key: ref.key, ruleVersionId: `TEST_${ref.key}`, sourceUrl: 'https://example.test/TEST',
        validFrom: '2000-01-01', validTo: null, ...p,
      };
    },
  };
}
