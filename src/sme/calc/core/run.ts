import { CALCULATORS } from '../calculators';
import { CALCULATOR_CODES, type CalcContext, type CalcOutcome, type CalculatorCode, type RegisteredCalculator } from './types';

const REGISTRY = new Map<CalculatorCode, RegisteredCalculator>(CALCULATORS.map(c => [c.code, c]));

export function isCalculatorCode(value: string): value is CalculatorCode {
  return (CALCULATOR_CODES as readonly string[]).includes(value);
}

export function getCalculator(code: CalculatorCode): RegisteredCalculator | undefined {
  return REGISTRY.get(code);
}

export function listCalculators(): RegisteredCalculator[] {
  return CALCULATOR_CODES.flatMap(code => REGISTRY.get(code) ?? []);
}

export type Availability = 'available' | 'needs_rule' | 'unavailable';

export interface CatalogueEntry {
  code: CalculatorCode;
  version: string;
  blueprintId: string;
  group: RegisteredCalculator['group'];
  complexity: RegisteredCalculator['complexity'];
  /** needs_rule: runs only with a rate the user enters, labelled unverified, until a rule is published. */
  availability: Availability;
  missingRules: string[];
  unavailableReasonKey?: string;
  screen?: string;
}

export function catalogueEntry(calc: RegisteredCalculator, ctx: CalcContext): CatalogueEntry {
  const missingRules = calc.ruleParams.filter(ref => !ctx.getRuleParam(ref, ctx.asOf)).map(ref => ref.key);
  const availability: Availability = calc.unavailableReasonKey ? 'unavailable' : missingRules.length > 0 ? 'needs_rule' : 'available';
  return {
    code: calc.code, version: calc.version, blueprintId: calc.blueprintId, group: calc.group, complexity: calc.complexity,
    availability, missingRules, unavailableReasonKey: calc.unavailableReasonKey, screen: calc.screen,
  };
}

export interface CalcRun {
  code: CalculatorCode;
  version: string;
  asOf: string;
  outcome: CalcOutcome;
}

/**
 * The only entry point for running a calculator. The calculator screens, the dashboard and the
 * assistant all call this, so the same inputs always give the same numbers (blueprint §8).
 */
export function runCalculation(code: CalculatorCode, input: unknown, ctx: CalcContext): CalcRun {
  const calc = REGISTRY.get(code);
  if (!calc) {
    return { code, version: '0.0.0', asOf: ctx.asOf, outcome: { ok: false, errors: [{ code: 'VALIDATION_FAILED', messageKey: 'tools.error.unknown_calculator' }] } };
  }
  if (calc.unavailableReasonKey) {
    return { code, version: calc.version, asOf: ctx.asOf, outcome: { ok: false, errors: [{ code: 'DATA_INCOMPLETE', messageKey: calc.unavailableReasonKey }] } };
  }
  return { code, version: calc.version, asOf: ctx.asOf, outcome: calc.run(input, ctx) };
}

/** A context with no published rule versions: regulated parameters are never invented (R16). */
export function contextWithoutRules(asOf: string): CalcContext {
  return { asOf, getRuleParam: () => null };
}
