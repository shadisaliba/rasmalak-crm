import type { z } from 'zod';
import type { CurrencyCode } from '@/sme/money';

// Blueprint §8: one formula service for the calculator screens, the dashboard and the assistant.
// Every calculator is a pure function with a version; any formula change bumps it (R19).

export const CALCULATOR_CODES = [
  'cash_forecast', 'break_even', 'margin_markup', 'working_capital', 'startup_cost',
  'loan_affordability', 'product_pricing', 'service_hourly_rate', 'employee_cost',
] as const;
export type CalculatorCode = (typeof CALCULATOR_CODES)[number];

export type CalculatorGroup = 'cash_planning' | 'pricing' | 'people_costs' | 'financing';
export const CALCULATOR_GROUPS: readonly CalculatorGroup[] = ['cash_planning', 'pricing', 'people_costs', 'financing'];
export type Complexity = 'basic' | 'intermediate' | 'advanced';

// ── Regulated parameters (R16) ──────────────────────────────

/** A rate, cap or threshold that only a published, effective-dated rule version may supply. */
export interface RuleParamRef {
  key: string;
}

export interface ApprovedParam {
  key: string;
  /** Decimal string. A percent is given as percent ("7.5" means 7.5 %). */
  value: string;
  unit: 'percent' | 'money_minor' | 'number';
  ruleVersionId: string;
  sourceUrl: string;
  validFrom: string;
  validTo: string | null;
}

export interface CalcContext {
  /** ISO date the calculation is made for. */
  asOf: string;
  /** Published rule versions only; null when none is effective on the date. */
  getRuleParam(ref: RuleParamRef, onDate: string): ApprovedParam | null;
}

// ── Inputs (UI metadata) ────────────────────────────────────

/** Organization data a field may be prefilled from. Prefill only suggests; the user confirms. */
export type PrefillSource = 'cash_total' | 'receivables_outstanding' | 'payables_outstanding';

export type FieldPeriod = 'one_off' | 'per_month' | 'per_year' | 'per_period' | 'per_unit' | 'per_hour';

interface FieldBase {
  key: string;
  labelKey: string;
  helpKey?: string;
  optional?: boolean;
}

/**
 * Wire format: every value is a string. Money is an integer string of minor units in the
 * calculation's currency (fils for JOD); percent and number fields are decimal strings.
 */
export type FieldSpec =
  | (FieldBase & { kind: 'money'; period?: FieldPeriod; allowNegative?: boolean; prefill?: PrefillSource })
  | (FieldBase & { kind: 'percent'; min?: string; max?: string })
  | (FieldBase & { kind: 'number'; unit?: 'units' | 'hours' | 'weeks' | 'months' | 'days' | 'years'; integer?: boolean; min?: string; max?: string })
  | (FieldBase & { kind: 'date' })
  | (FieldBase & { kind: 'text'; maxLength?: number })
  | (FieldBase & { kind: 'select'; options: { value: string; labelKey: string }[] })
  | (FieldBase & { kind: 'items'; itemFields: FieldSpec[]; addLabelKey: string; maxItems?: number });

// ── Outputs ─────────────────────────────────────────────────

/** JSON-safe result values; the UI formats each kind for the locale. */
export type ResultValue =
  | { kind: 'money'; minor: string; currency: CurrencyCode }
  | { kind: 'percent'; value: string }
  | { kind: 'ratio'; value: string }
  | { kind: 'count'; value: string }
  | { kind: 'days'; value: string }
  | { kind: 'hours'; value: string }
  | { kind: 'date'; value: string }
  | { kind: 'text'; textKey: string; values?: Record<string, string> }
  /** Not applicable, with the reason (e.g. markup when cost is zero). */
  | { kind: 'none'; reasonKey: string };

export interface ResultFigure {
  key: string;
  labelKey: string;
  value: ResultValue;
  /** The headline figure(s) of the calculator. */
  primary?: boolean;
}

export interface ResultTable {
  key: string;
  titleKey: string;
  /** best / base / worst views and stress tests are tables with kind 'sensitivity'. */
  kind: 'sensitivity' | 'schedule' | 'breakdown';
  columns: { key: string; labelKey: string }[];
  rows: { key: string; labelKey?: string; labelValues?: Record<string, string>; cells: Record<string, ResultValue> }[];
}

export interface CalcResult {
  figures: ResultFigure[];
  tables: ResultTable[];
}

// ── Explanations ────────────────────────────────────────────

export interface TraceStep {
  labelKey: string;
  /** Plain formula, e.g. "fixed_costs / (unit_price − unit_variable_cost)". */
  formula: string;
  inputs: Record<string, string>;
  result: string;
  /** Present when this step rounded: rounding happens once, half away from zero (R5). */
  rounding?: { mode: 'half_away_from_zero' | 'up'; exact: string; rounded: string };
}

export type AssumptionSource = 'user' | 'default' | 'rule' | 'unverified_user_rate' | 'prefill';

export interface Assumption {
  key: string;
  messageKey: string;
  values?: Record<string, string>;
  source: AssumptionSource;
}

export interface Warning {
  key: string;
  messageKey: string;
  values?: Record<string, string>;
}

export type CalcErrorCode =
  | 'VALIDATION_FAILED' | 'ZERO_DENOMINATOR' | 'NEGATIVE_CONTRIBUTION' | 'PERIOD_MISMATCH'
  | 'RULE_NOT_VERIFIED' | 'DATA_INCOMPLETE' | 'CURRENCY_MISMATCH';

export interface CalcError {
  code: CalcErrorCode;
  /** The input the error is about, when there is one. */
  field?: string;
  messageKey: string;
  values?: Record<string, string>;
}

export type CalcOutcome<O = CalcResult> =
  | { ok: true; output: O; trace: TraceStep[]; assumptions: Assumption[]; warnings: Warning[]; ruleVersionIds: string[] }
  | { ok: false; errors: CalcError[] };

// ── Definitions ─────────────────────────────────────────────

export interface CalculatorDef<I> {
  code: CalculatorCode;
  /** Semver; bump on any formula change. */
  version: string;
  blueprintId: string;
  group: CalculatorGroup;
  complexity: Complexity;
  /** Validates the wire input and converts it (strings to bigint and Decimal). */
  input: z.ZodType<I>;
  fields: FieldSpec[];
  ruleParams?: RuleParamRef[];
  /** A realistic wire input for "Try an example" and for the message-key test. */
  example: Record<string, unknown>;
  /** Set when the calculator cannot run in this build yet; the catalogue shows the reason. */
  unavailableReasonKey?: string;
  /** The screen this calculator is a view of; the catalogue opens it instead of a form. */
  screen?: string;
  compute(input: I, ctx: CalcContext): CalcOutcome;
}

/** A calculator with its input type erased, as the registry holds it. */
export interface RegisteredCalculator {
  code: CalculatorCode;
  version: string;
  blueprintId: string;
  group: CalculatorGroup;
  complexity: Complexity;
  fields: FieldSpec[];
  ruleParams: RuleParamRef[];
  example: Record<string, unknown>;
  unavailableReasonKey?: string;
  screen?: string;
  /** Parses the wire input, then computes. */
  run(raw: unknown, ctx: CalcContext): CalcOutcome;
}
