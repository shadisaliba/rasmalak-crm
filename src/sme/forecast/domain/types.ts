/**
 * Contracts of the 13-week cash forecast (W3a-07, F1.09, FIN-05). Amounts are JOD minor units
 * as bigint; `Wire<T>` is the JSON shape stored in sme_forecast_runs and sent to the browser.
 */

export const ENGINE_VERSION = '1.0.0';
export const HORIZON_WEEKS = 13;
/** Invoices overdue by more than this are left out of the baseline and listed as uncertain. */
export const UNCERTAIN_AFTER_DAYS = 60;
/** Paid invoices a customer needs before their own payment delay is used. */
export const MIN_PAID_FOR_HISTORY = 3;
/** Category codes counted as payroll by the payroll_delta_minor override. */
export const PAYROLL_CATEGORY_CODES = ['salaries_wages'] as const;

export type Recurrence = 'none' | 'weekly' | 'monthly' | 'quarterly' | 'annually';
export type CategoryKind = 'income' | 'expense' | 'transfer' | 'owner_equity' | 'financing' | 'tax' | 'opening_balance';

export interface ForecastAccount { id: string; name: string; clearedMinor: bigint }

export interface ForecastReceivable {
  id: string;
  number: string;
  partyKey: string;
  partyName: string;
  dueDate: string;
  outstandingMinor: bigint;
}

export interface ForecastPayable {
  id: string;
  reference: string;
  partyKey: string;
  partyName: string;
  dueDate: string;
  outstandingMinor: bigint;
}

export interface ForecastScheduledItem {
  id: string;
  label: string;
  direction: 'in' | 'out';
  amountMinor: bigint;
  startDate: string;
  recurrence: Recurrence;
  endDate: string | null;
  categoryCode: string | null;
  isEstimate: boolean;
  source: 'owner_entered' | 'detected_confirmed';
  seriesKey: string | null;
}

/** A posted, unreversed transaction from the trailing history, in JOD. */
export interface ForecastHistoryTransaction {
  id: string;
  date: string;
  /** Signed: + inflow, − outflow. */
  amountMinor: bigint;
  categoryCode: string | null;
  categoryKind: CategoryKind | null;
  costBehavior: 'fixed' | 'variable' | null;
  description: string;
  /** Matched to an invoice or bill, so the register already covers it. */
  matched: boolean;
}

/** A foreign-currency invoice or bill converted to JOD by the loader. */
export interface ForecastConversion { currency: string; rate: string; rateDate: string; count: number }

export interface ForecastInputs {
  /** YYYY-MM-DD in Jordan. */
  asOf: string;
  /** 0 = Sunday. */
  weekStart: number;
  bufferMinor: bigint;
  accounts: ForecastAccount[];
  receivables: ForecastReceivable[];
  /** Days late of each fully paid invoice, by party key. */
  paymentHistory: Record<string, number[]>;
  payables: ForecastPayable[];
  scheduled: ForecastScheduledItem[];
  history: ForecastHistoryTransaction[];
  dismissedSeries: string[];
  conversions: ForecastConversion[];
  /** Foreign-currency items left out because no stored rate exists. */
  unconverted: Array<{ currency: string; count: number }>;
}

export type ScenarioOverride =
  | { type: 'shift_receipts_days'; days: number }
  | { type: 'move_bill'; bill_id: string; new_date: string }
  | { type: 'add_item'; label: string; direction: 'in' | 'out'; amount_minor: string; date: string; recurrence?: Recurrence; end_date?: string | null }
  | { type: 'remove_item'; item_id: string }
  | { type: 'include_uncertain_receivables' }
  | { type: 'revenue_delta_pct'; pct: string }
  | { type: 'payroll_delta_minor'; amount_minor: string };

export type OverrideType = ScenarioOverride['type'];

export type InflowSource = 'receivable' | 'scheduled' | 'detected' | 'scenario';
export type OutflowSource = 'payable' | 'scheduled' | 'detected' | 'scenario';

export interface ForecastLine {
  id: string;
  source: InflowSource | OutflowSource;
  direction: 'in' | 'out';
  date: string;
  amountMinor: bigint;
  label: string;
  /** The invoice, bill or scheduled item behind the line, for drill-down. */
  refId: string | null;
  categoryCode: string | null;
  isEstimate: boolean;
  assumptionIds: string[];
}

export interface ForecastWeek {
  index: number;
  start: string;
  end: string;
  openingMinor: bigint;
  inflows: Record<InflowSource, bigint>;
  outflows: Record<OutflowSource, bigint>;
  inMinor: bigint;
  outMinor: bigint;
  closingMinor: bigint;
  /** Closing after unplanned variable spend at P75 (low) and P25 (high); never part of the base line. */
  bandLowMinor: bigint;
  bandHighMinor: bigint;
  lines: ForecastLine[];
}

export interface ForecastAssumption {
  id: string;
  /** Message id under forecast.assumption.* */
  key: string;
  params: Record<string, string | number>;
  /** The override that edits this assumption in a scenario. */
  handle?: { type: OverrideType; target?: string };
}

export interface TraceRounding { key: string; exact: string; rounded: string; mode: 'half_away_from_zero' }

export interface DetectedSeriesSummary {
  key: string;
  label: string;
  direction: 'in' | 'out';
  cadence: string;
  amountMinor: bigint;
  nextDate: string;
  confidence: 'low' | 'medium' | 'high';
  status: 'included' | 'dismissed' | 'removed_in_scenario' | 'confirmed' | 'covered';
}

export interface UncertainReceivable {
  id: string;
  number: string;
  partyName: string;
  dueDate: string;
  daysOverdue: number;
  outstandingMinor: bigint;
  included: boolean;
}

export interface ForecastResult {
  engineVersion: string;
  asOf: string;
  weekStart: number;
  currency: 'JOD';
  openingClearedMinor: bigint;
  accounts: ForecastAccount[];
  weeks: ForecastWeek[];
  minimum: { minor: bigint; weekIndex: number };
  firstBelowZeroWeek: number | null;
  firstBelowBufferWeek: number | null;
  bufferMinor: bigint;
  variableSpend: { p25Minor: bigint; p50Minor: bigint; p75Minor: bigint; weeksObserved: number } | null;
  uncertainReceivables: UncertainReceivable[];
  detectedSeries: DetectedSeriesSummary[];
  assumptions: ForecastAssumption[];
  overrides: ScenarioOverride[];
  trace: TraceRounding[];
}

export type Wire<T> = T extends bigint
  ? string
  : T extends Array<infer U>
    ? Array<Wire<U>>
    : T extends object
      ? { [K in keyof T]: Wire<T[K]> }
      : T;

/** JSON-safe copy: bigint becomes its decimal string. */
export function toWire<T>(value: T): Wire<T> {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))) as Wire<T>;
}
