/**
 * Action centre contracts (W3a-09, F1.11). Rules are pure: inputs in, candidate actions out. The
 * worker syncs candidates by dedupe_key, so a rule only says what is true now.
 */

export const RULE_CODES = [
  'receivable_overdue', 'forecast_shortfall', 'payables_due_soon', 'cost_spike',
  'stale_account_data', 'uncategorized_backlog', 'concentration_risk',
] as const;
export type RuleCode = (typeof RULE_CODES)[number];

export type Severity = 'info' | 'warning' | 'critical';

/** One figure behind an action, with what it is and where it comes from (R4). */
export interface Evidence {
  kind: 'invoice' | 'bill' | 'account' | 'forecast' | 'category' | 'customer' | 'transactions';
  /** The record it links to, when there is one. */
  id?: string;
  label_key: string;
  value: string;
  format: 'money' | 'date' | 'days' | 'count' | 'percent' | 'text';
}

export interface ActionCandidate {
  rule_code: RuleCode;
  rule_version: string;
  dedupe_key: string;
  subject_type: string | null;
  subject_id: string | null;
  severity: Severity;
  title_key: string;
  body_key: string;
  /** Values for the title and body; money as minor-unit strings in JOD. */
  params: Record<string, string | number>;
  evidence: Evidence[];
  /** Topics used to recommend lessons (W3b-03). */
  competency_tags: string[];
  /** The permission needed to see the figures in it. */
  required_perm: string;
}

export interface OpenInvoice { id: string; number: string; partyKey: string; partyName: string; dueDate: string; outstandingMinor: bigint }
export interface OpenBill { id: string; reference: string; partyName: string; dueDate: string; outstandingMinor: bigint }
export interface AccountActivity { id: string; name: string; lastActivity: string | null }
export interface ExpenseTx { id: string; date: string; amountMinor: bigint; categoryCode: string | null; description: string }
export interface CustomerRevenue { partyKey: string; partyName: string; companyId: string | null; minor: bigint; invoices: number }

export interface ForecastSummary {
  runId: string;
  belowZero: { weekStart: string; closingMinor: bigint } | null;
  belowBuffer: { weekStart: string; closingMinor: bigint; bufferMinor: bigint } | null;
}

export interface ActionInputs {
  /** YYYY-MM-DD in Jordan. */
  today: string;
  invoices: OpenInvoice[];
  bills: OpenBill[];
  forecast: ForecastSummary | null;
  accounts: AccountActivity[];
  uncategorized: { count: number; total: number };
  /** Posted, unreversed expense outflows of the last 13 months, in JOD, not matched to a bill. */
  expenses: ExpenseTx[];
  /** Invoiced revenue per customer over the concentration window, in JOD. */
  revenue: CustomerRevenue[];
}

export type RuleParams = Record<string, number>;

export interface Rule {
  code: RuleCode;
  version: string;
  /** Proposed defaults; an organization can change them in sme_action_settings. */
  defaults: RuleParams;
  evaluate(inputs: ActionInputs, params: RuleParams): ActionCandidate[];
}

export interface RuleSetting { enabled: boolean; params: RuleParams }
