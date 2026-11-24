import { MoneyError } from '@/sme/money';
import type { CalcError, CalcOutcome, CalculatorDef, RegisteredCalculator } from './types';

/** Registers a calculator: parsing and computing stay typed inside, the registry sees `unknown`. */
export function defineCalculator<I>(def: CalculatorDef<I>): RegisteredCalculator {
  return {
    code: def.code,
    version: def.version,
    blueprintId: def.blueprintId,
    group: def.group,
    complexity: def.complexity,
    fields: def.fields,
    ruleParams: def.ruleParams ?? [],
    example: def.example,
    unavailableReasonKey: def.unavailableReasonKey,
    screen: def.screen,
    run(raw, ctx): CalcOutcome {
      const parsed = def.input.safeParse(raw);
      if (!parsed.success) {
        return {
          ok: false,
          errors: parsed.error.issues.map((issue): CalcError => ({
            code: 'VALIDATION_FAILED',
            field: issue.path.map(String).join('.') || undefined,
            messageKey: `tools.error.${issueReason(issue.message, issue.code, valueAt(raw, issue.path))}`,
          })),
        };
      }
      try {
        return def.compute(parsed.data, ctx);
      } catch (err) {
        // Results beyond the money range are an input problem, not a crash.
        if (err instanceof MoneyError) {
          return { ok: false, errors: [{ code: 'VALIDATION_FAILED', messageKey: 'tools.error.too_large' }] };
        }
        throw err;
      }
    },
  };
}

const KNOWN_REASONS = new Set([
  'not_an_amount', 'not_a_number', 'not_an_integer', 'not_a_date', 'too_large', 'negative_not_allowed',
  'below_minimum', 'above_maximum',
]);

function valueAt(raw: unknown, path: PropertyKey[]): unknown {
  return path.reduce<unknown>((v, k) => (v !== null && typeof v === 'object' ? (v as Record<PropertyKey, unknown>)[k] : undefined), raw);
}

// zod reports a missing select as invalid_value, not invalid_type, so a missing value decides "required".
function issueReason(message: string, code: string, value: unknown): string {
  if (value === undefined || value === '') return 'required';
  if (KNOWN_REASONS.has(message)) return message;
  return code === 'invalid_type' ? 'required' : 'invalid';
}
