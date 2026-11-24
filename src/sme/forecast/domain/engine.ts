import Decimal from 'decimal.js';
import { detectRecurringSeries, type RecurringSeries } from '../engine-core/recurringSeries';
import { median, quantile } from '../engine-core/stats';
import { isoAddDays, isoAddMonthsClamped, isoToDayNumber } from '../engine-core/dates';
import type { EngineTransaction } from '../engine-core/engineTypes';
import {
  ENGINE_VERSION, HORIZON_WEEKS, MIN_PAID_FOR_HISTORY, PAYROLL_CATEGORY_CODES, UNCERTAIN_AFTER_DAYS,
  type CategoryKind, type DetectedSeriesSummary, type ForecastAssumption, type ForecastInputs, type ForecastLine,
  type ForecastResult, type ForecastWeek, type InflowSource, type OutflowSource, type Recurrence,
  type ScenarioOverride, type TraceRounding, type UncertainReceivable,
} from './types';

export { ENGINE_VERSION };

// Kept out of series detection and the variable-spend band: they move money without being
// operating cash flows (playbook W3a-07 step 1).
const NON_OPERATING_KINDS: ReadonlySet<CategoryKind> = new Set(['transfer', 'opening_balance', 'owner_equity', 'financing']);

const day = (iso: string) => isoToDayNumber(iso);
const later = (a: string, b: string) => (a > b ? a : b);

function roundHalfAway(value: Decimal.Value): bigint {
  return BigInt(new Decimal(value).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0));
}

/** The first day of the week holding `iso`, for a week starting on `weekStart` (0 = Sunday). */
export function weekStartOf(iso: string, weekStart: number): string {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return isoAddDays(iso, -((dow - weekStart + 7) % 7));
}

function stepRecurrence(iso: string, recurrence: Exclude<Recurrence, 'none'>, anchorDay: number): string {
  switch (recurrence) {
    case 'weekly': return isoAddDays(iso, 7);
    case 'monthly': return isoAddMonthsClamped(iso, 1, anchorDay);
    case 'quarterly': return isoAddMonthsClamped(iso, 3, anchorDay);
    case 'annually': return isoAddMonthsClamped(iso, 12, anchorDay);
  }
}

/** Occurrence dates of a scheduled item from `from` to `to`, both inclusive. */
export function occurrences(start: string, recurrence: Recurrence, end: string | null, from: string, to: string): string[] {
  const last = end && end < to ? end : to;
  if (recurrence === 'none') return start >= from && start <= last ? [start] : [];
  const anchor = Number(start.slice(8, 10));
  const dates: string[] = [];
  // Monthly steps are computed from the start each time so a 31st does not drift to the 28th.
  for (let n = 0, d = start; d <= last && n < 1000; n++) {
    if (d >= from) dates.push(d);
    d = recurrence === 'weekly' ? isoAddDays(start, 7 * (n + 1)) : stepFromStart(start, recurrence, n + 1, anchor);
  }
  return dates;
}

function stepFromStart(start: string, recurrence: 'monthly' | 'quarterly' | 'annually', n: number, anchor: number): string {
  const months = recurrence === 'monthly' ? n : recurrence === 'quarterly' ? 3 * n : 12 * n;
  return isoAddMonthsClamped(start, months, anchor);
}

function seriesStep(iso: string, cadence: RecurringSeries['cadence'], anchor: number | null): string {
  switch (cadence) {
    case 'weekly': return isoAddDays(iso, 7);
    case 'biweekly': return isoAddDays(iso, 14);
    case 'monthly': return stepRecurrence(iso, 'monthly', anchor ?? Number(iso.slice(8, 10)));
    case 'quarterly': return stepRecurrence(iso, 'quarterly', anchor ?? Number(iso.slice(8, 10)));
    case 'yearly': return stepRecurrence(iso, 'annually', anchor ?? Number(iso.slice(8, 10)));
  }
}

function emptyIn(): Record<InflowSource, bigint> { return { receivable: 0n, scheduled: 0n, detected: 0n, scenario: 0n }; }
function emptyOut(): Record<OutflowSource, bigint> { return { payable: 0n, scheduled: 0n, detected: 0n, scenario: 0n }; }

/**
 * The 13-week cash forecast. Pure and deterministic for given inputs and overrides: opening
 * cleared cash plus dated expected inflows minus outflows, week by week (blueprint §5).
 */
export function runForecast(inputs: ForecastInputs, overrides: ScenarioOverride[] = []): ForecastResult {
  const { asOf } = inputs;
  const firstWeek = weekStartOf(asOf, inputs.weekStart);
  const horizonEnd = isoAddDays(firstWeek, HORIZON_WEEKS * 7 - 1);
  const assumptions = new Map<string, ForecastAssumption>();
  const trace: TraceRounding[] = [];
  const lines: ForecastLine[] = [];
  const assume = (a: ForecastAssumption) => { if (!assumptions.has(a.id)) assumptions.set(a.id, a); return a.id; };

  const shiftDays = overrides.reduce((n, o) => (o.type === 'shift_receipts_days' ? n + o.days : n), 0);
  const moved = new Map(overrides.flatMap(o => (o.type === 'move_bill' ? [[o.bill_id, o.new_date] as const] : [])));
  const removed = new Set(overrides.flatMap(o => (o.type === 'remove_item' ? [o.item_id] : [])));
  const includeUncertain = overrides.some(o => o.type === 'include_uncertain_receivables');

  // ── Receivables: due date plus the customer's own median delay ──
  const uncertain: UncertainReceivable[] = [];
  for (const r of inputs.receivables) {
    if (r.outstandingMinor <= 0n) continue;
    const daysOverdue = Math.max(0, day(asOf) - day(r.dueDate));
    if (daysOverdue > UNCERTAIN_AFTER_DAYS) {
      uncertain.push({ id: r.id, number: r.number, partyName: r.partyName, dueDate: r.dueDate, daysOverdue, outstandingMinor: r.outstandingMinor, included: includeUncertain });
      if (!includeUncertain) continue;
      lines.push({
        id: `invoice:${r.id}`, source: 'receivable', direction: 'in', date: asOf, amountMinor: r.outstandingMinor,
        label: r.number, refId: r.id, categoryCode: null, isEstimate: true,
        assumptionIds: [assume({ id: 'uncertain_included', key: 'uncertain_included', params: {}, handle: { type: 'include_uncertain_receivables' } })],
      });
      continue;
    }
    const history = inputs.paymentHistory[r.partyKey] ?? [];
    let lag = 0;
    let timing: string;
    if (history.length >= MIN_PAID_FOR_HISTORY) {
      lag = Math.round(median(history));
      timing = assume({ id: `receipts:${r.partyKey}`, key: 'receipt_timing_history', params: { customer: r.partyName, days: lag, invoices: history.length }, handle: { type: 'shift_receipts_days' } });
    } else {
      timing = assume({ id: `receipts:${r.partyKey}`, key: 'receipt_no_history', params: { customer: r.partyName }, handle: { type: 'shift_receipts_days' } });
    }
    const ids = [timing];
    if (shiftDays) ids.push(assume({ id: 'receipts_shifted', key: 'receipts_shifted', params: { days: shiftDays }, handle: { type: 'shift_receipts_days' } }));
    const date = later(isoAddDays(r.dueDate, lag + shiftDays), asOf);
    if (date > horizonEnd) continue;
    lines.push({ id: `invoice:${r.id}`, source: 'receivable', direction: 'in', date, amountMinor: r.outstandingMinor, label: r.number, refId: r.id, categoryCode: null, isEstimate: false, assumptionIds: ids });
  }

  // ── Payables: on the due date, unless a scenario moves the bill ──
  for (const b of inputs.payables) {
    if (b.outstandingMinor <= 0n) continue;
    const target = moved.get(b.id);
    const ids = [target
      ? assume({ id: `bill_moved:${b.id}`, key: 'bill_moved', params: { bill: b.reference || b.partyName, date: target }, handle: { type: 'move_bill', target: b.id } })
      : assume({ id: 'bills_on_due_date', key: 'bills_on_due_date', params: {}, handle: { type: 'move_bill' } })];
    if (!target && b.dueDate < asOf) ids.push(assume({ id: 'overdue_bills_now', key: 'overdue_bills_now', params: {} }));
    const date = later(target ?? b.dueDate, asOf);
    if (date > horizonEnd) continue;
    lines.push({ id: `bill:${b.id}`, source: 'payable', direction: 'out', date, amountMinor: b.outstandingMinor, label: b.reference || b.partyName, refId: b.id, categoryCode: null, isEstimate: false, assumptionIds: ids });
  }

  // ── Scheduled items the owner entered ──
  const activeScheduled = inputs.scheduled.filter(s => !removed.has(s.id));
  for (const s of activeScheduled) {
    const ids = s.isEstimate ? [assume({ id: `estimate:${s.id}`, key: 'estimate_item', params: { label: s.label }, handle: { type: 'remove_item', target: s.id } })] : [];
    for (const date of occurrences(s.startDate, s.recurrence, s.endDate, asOf, horizonEnd)) {
      lines.push({ id: `scheduled:${s.id}:${date}`, source: 'scheduled', direction: s.direction, date, amountMinor: s.amountMinor, label: s.label, refId: s.id, categoryCode: s.categoryCode, isEstimate: s.isEstimate, assumptionIds: ids });
    }
  }
  for (const id of removed) {
    const s = inputs.scheduled.find(x => x.id === id);
    if (s) assume({ id: `removed:${id}`, key: 'item_removed', params: { label: s.label }, handle: { type: 'remove_item', target: id } });
  }

  // ── Items a scenario adds ──
  overrides.forEach((o, n) => {
    if (o.type !== 'add_item') return;
    const ids = [assume({ id: `added:${n}`, key: 'item_added', params: { label: o.label }, handle: { type: 'add_item' } })];
    for (const date of occurrences(o.date, o.recurrence ?? 'none', o.end_date ?? null, asOf, horizonEnd)) {
      lines.push({ id: `added:${n}:${date}`, source: 'scenario', direction: o.direction, date, amountMinor: BigInt(o.amount_minor), label: o.label, refId: null, categoryCode: null, isEstimate: true, assumptionIds: ids });
    }
  });

  // ── Detected recurring series not yet confirmed ──
  const operating = inputs.history.filter(t => !t.matched && !(t.categoryKind && NON_OPERATING_KINDS.has(t.categoryKind)));
  // Statistics run on exact integer minor units (well below 2^53); the projected amount is
  // rounded once, back to bigint, and recorded in the trace (R5).
  const engineTxs: EngineTransaction[] = operating.map(t => ({
    id: t.id, date: t.date, type: t.amountMinor > 0n ? 'income' : 'expense', category: t.categoryCode,
    description: t.description, amountBase: Number(t.amountMinor < 0n ? -t.amountMinor : t.amountMinor),
  }));
  const series = detectRecurringSeries(engineTxs, { now: new Date(`${asOf}T12:00:00`) }).filter(s => s.active);
  const dismissed = new Set(inputs.dismissedSeries);
  const seriesMembers = new Set<string>();
  const detected: DetectedSeriesSummary[] = [];
  for (const s of series) {
    const direction = s.direction === 'income' ? 'in' : 'out';
    const amountMinor = roundHalfAway(s.amountMedian);
    if (!Number.isInteger(s.amountMedian)) {
      trace.push({ key: `series:${s.key}`, exact: String(s.amountMedian), rounded: amountMinor.toString(), mode: 'half_away_from_zero' });
    }
    const confirmed = inputs.scheduled.some(x => x.source === 'detected_confirmed' && x.seriesKey === s.key);
    const covered = !confirmed && inputs.scheduled.some(x => x.direction === direction && x.categoryCode && x.categoryCode === s.categoryId);
    const status: DetectedSeriesSummary['status'] = confirmed ? 'confirmed' : covered ? 'covered'
      : dismissed.has(s.key) ? 'dismissed' : removed.has(`series:${s.key}`) ? 'removed_in_scenario' : 'included';
    let next = s.nextDueDate;
    for (let guard = 0; next < asOf && guard < 400; guard++) next = seriesStep(next, s.cadence, s.anchorDayOfMonth);
    detected.push({ key: s.key, label: s.merchantLabel, direction, cadence: s.cadence, amountMinor, nextDate: next, confidence: s.confidenceGrade, status });
    if (status !== 'included') {
      if (status === 'covered') assume({ id: `covered:${s.key}`, key: 'series_covered', params: { label: s.merchantLabel } });
      continue;
    }
    s.memberTransactionIds.forEach(id => seriesMembers.add(id));
    const ids = [assume({ id: `series:${s.key}`, key: 'detected_series', params: { label: s.merchantLabel, cadence: s.cadence, amount: amountMinor.toString() }, handle: { type: 'remove_item', target: `series:${s.key}` } })];
    for (let guard = 0, d = next; d <= horizonEnd && guard < 200; guard++, d = seriesStep(d, s.cadence, s.anchorDayOfMonth)) {
      lines.push({ id: `series:${s.key}:${d}`, source: 'detected', direction, date: d, amountMinor, label: s.merchantLabel, refId: null, categoryCode: s.categoryId === 'other' ? null : s.categoryId, isEstimate: true, assumptionIds: ids });
    }
  }

  // ── Scenario adjustments to amounts ──
  for (const o of overrides) {
    if (o.type === 'revenue_delta_pct') {
      const factor = new Decimal(1).plus(new Decimal(o.pct).div(100));
      for (const l of lines) {
        if (l.direction !== 'in') continue;
        const exact = new Decimal(l.amountMinor.toString()).mul(factor);
        const rounded = roundHalfAway(exact);
        if (!exact.isInteger()) trace.push({ key: `revenue_delta:${l.id}`, exact: exact.toString(), rounded: rounded.toString(), mode: 'half_away_from_zero' });
        l.amountMinor = rounded > 0n ? rounded : 0n;
        l.assumptionIds.push(assume({ id: 'revenue_delta', key: 'revenue_delta', params: { pct: o.pct }, handle: { type: 'revenue_delta_pct' } }));
      }
    }
    if (o.type === 'payroll_delta_minor') {
      const delta = BigInt(o.amount_minor);
      const payroll = lines.filter(l => l.direction === 'out' && l.categoryCode && (PAYROLL_CATEGORY_CODES as readonly string[]).includes(l.categoryCode));
      const id = assume({ id: 'payroll_delta', key: payroll.length ? 'payroll_delta' : 'payroll_delta_unused', params: { amount: delta.toString() }, handle: { type: 'payroll_delta_minor' } });
      for (const l of payroll) {
        const next = l.amountMinor + delta;
        l.amountMinor = next > 0n ? next : 0n;
        l.assumptionIds.push(id);
      }
    }
  }

  // ── Unplanned variable spend: a band from the trailing 13 weeks, never in the base line ──
  const earliest = inputs.history.reduce<string | null>((m, t) => (m === null || t.date < m ? t.date : m), null);
  const weeklyVariable: number[] = [];
  for (let k = 1; k <= HORIZON_WEEKS; k++) {
    const start = isoAddDays(firstWeek, -7 * k);
    const end = isoAddDays(start, 6);
    if (earliest === null || end < earliest) break;
    let total = 0n;
    for (const t of operating) {
      if (t.amountMinor < 0n && t.costBehavior === 'variable' && !seriesMembers.has(t.id) && t.date >= start && t.date <= end) total -= t.amountMinor;
    }
    weeklyVariable.push(Number(total));
  }
  let variableSpend: ForecastResult['variableSpend'] = null;
  if (weeklyVariable.some(v => v > 0)) {
    const band = ([0.25, 0.5, 0.75] as const).map(q => {
      const exact = quantile(weeklyVariable, q);
      const rounded = roundHalfAway(exact);
      if (!Number.isInteger(exact)) trace.push({ key: `variable_p${q * 100}`, exact: String(exact), rounded: rounded.toString(), mode: 'half_away_from_zero' });
      return rounded;
    });
    variableSpend = { p25Minor: band[0], p50Minor: band[1], p75Minor: band[2], weeksObserved: weeklyVariable.length };
    assume({ id: 'variable_spend', key: 'variable_spend_band', params: { p25: band[0].toString(), p50: band[1].toString(), p75: band[2].toString(), weeks: weeklyVariable.length } });
  }

  // ── Week by week ──
  lines.sort((a, b) => (a.date === b.date ? (a.id < b.id ? -1 : 1) : a.date < b.date ? -1 : 1));
  const opening = inputs.accounts.reduce((s, a) => s + a.clearedMinor, 0n);
  const weeks: ForecastWeek[] = [];
  let running = opening;
  let cumLow = 0n;
  let cumHigh = 0n;
  for (let i = 0; i < HORIZON_WEEKS; i++) {
    const start = isoAddDays(firstWeek, 7 * i);
    const end = isoAddDays(start, 6);
    const weekLines = lines.filter(l => (i === 0 ? l.date <= end : l.date >= start && l.date <= end));
    const inflows = emptyIn();
    const outflows = emptyOut();
    for (const l of weekLines) {
      if (l.direction === 'in') inflows[l.source as InflowSource] += l.amountMinor;
      else outflows[l.source as OutflowSource] += l.amountMinor;
    }
    const inMinor = Object.values(inflows).reduce((s, v) => s + v, 0n);
    const outMinor = Object.values(outflows).reduce((s, v) => s + v, 0n);
    const closing = running + inMinor - outMinor;
    if (variableSpend) { cumLow += variableSpend.p75Minor; cumHigh += variableSpend.p25Minor; }
    weeks.push({
      index: i, start, end, openingMinor: running, inflows, outflows, inMinor, outMinor, closingMinor: closing,
      bandLowMinor: closing - cumLow, bandHighMinor: closing - cumHigh, lines: weekLines,
    });
    running = closing;
  }

  const minimum = weeks.reduce((m, w) => (w.closingMinor < m.minor ? { minor: w.closingMinor, weekIndex: w.index } : m), { minor: weeks[0].closingMinor, weekIndex: 0 });
  const firstBelowZeroWeek = weeks.find(w => w.closingMinor < 0n)?.index ?? null;
  const firstBelowBufferWeek = inputs.bufferMinor > 0n ? weeks.find(w => w.closingMinor < inputs.bufferMinor)?.index ?? null : null;

  assume({ id: 'opening', key: 'opening_cleared_cash', params: { accounts: inputs.accounts.length, date: asOf } });
  assume({ id: 'excluded_flows', key: 'excluded_flows', params: {} });
  if (uncertain.length && !includeUncertain) {
    assume({ id: 'uncertain_excluded', key: 'uncertain_excluded', params: { count: uncertain.length, days: UNCERTAIN_AFTER_DAYS }, handle: { type: 'include_uncertain_receivables' } });
  }
  for (const c of inputs.conversions) assume({ id: `fx:${c.currency}`, key: 'foreign_converted', params: { currency: c.currency, rate: c.rate, date: c.rateDate, count: c.count } });
  for (const u of inputs.unconverted) assume({ id: `fx_missing:${u.currency}`, key: 'foreign_left_out', params: { currency: u.currency, count: u.count } });

  return {
    engineVersion: ENGINE_VERSION,
    asOf,
    weekStart: inputs.weekStart,
    currency: 'JOD',
    openingClearedMinor: opening,
    accounts: inputs.accounts,
    weeks,
    minimum,
    firstBelowZeroWeek,
    firstBelowBufferWeek,
    bufferMinor: inputs.bufferMinor,
    variableSpend,
    uncertainReceivables: uncertain,
    detectedSeries: detected,
    assumptions: [...assumptions.values()],
    overrides,
    trace,
  };
}

/** Canonical text of everything a run depends on; the server hashes it into the input digest. */
export function canonicalInputs(inputs: ForecastInputs, overrides: ScenarioOverride[]): string {
  const sortKeys = (v: unknown): unknown => {
    if (typeof v === 'bigint') return v.toString();
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys((v as Record<string, unknown>)[k])]));
    return v;
  };
  return JSON.stringify(sortKeys({ engine: ENGINE_VERSION, inputs, overrides }));
}
