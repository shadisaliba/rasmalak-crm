import { daysBetween } from '@/sme/ledger/domain/dates';

/**
 * Data-quality grade shared by every financial screen (W2-07). The thresholds are proposals
 * pending the finance lead's sign-off at gate G1; a change gets a new version so earlier
 * grades stay explainable.
 */
export const DATA_QUALITY_VERSION = 'dq-proposal-2026-11';

export const DATA_QUALITY_THRESHOLDS = {
  A: { historyDays: 90, categorizedPercent: 90, activityWithinDays: 7 },
  B: { historyDays: 30, categorizedPercent: 70, activityWithinDays: 14 },
} as const;

export interface AccountQualityInput {
  accountId: string;
  firstDate: string | null;
  lastDate: string | null;
  lastImportDate: string | null;
}

export interface DataQualityInput {
  /** YYYY-MM-DD in Jordan. */
  today: string;
  accounts: AccountQualityInput[];
  /** Posted transactions, excluding reversed pairs. */
  transactionCount: number;
  categorizedCount: number;
  /** Lines of open imports still awaiting a decision. */
  unresolvedImportRows: number;
}

export type DataQualityGrade = 'A' | 'B' | 'C' | 'insufficient';

export type DataQualityReason =
  | { code: 'no_transactions' }
  | { code: 'short_history'; days: number; needed: number }
  | { code: 'low_categorization'; percent: number; needed: number }
  | { code: 'stale_activity'; days: number; limit: number }
  | { code: 'unresolved_import_rows'; count: number }
  | { code: 'account_without_activity'; accountId: string };

export interface DataQualityResult {
  grade: DataQualityGrade;
  version: string;
  /** Why the grade is not higher, most important first. */
  reasons: DataQualityReason[];
  metrics: { historyDays: number; categorizedPercent: number; daysSinceActivity: number | null };
}

const later = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);

export function assessDataQuality(input: DataQualityInput): DataQualityResult {
  const withData = input.accounts.filter(a => a.firstDate && a.lastDate);
  const idle: DataQualityReason[] = input.accounts
    .filter(a => !a.firstDate)
    .map(a => ({ code: 'account_without_activity', accountId: a.accountId }));

  if (input.transactionCount === 0 || withData.length === 0) {
    return {
      grade: 'insufficient', version: DATA_QUALITY_VERSION,
      reasons: [{ code: 'no_transactions' }, ...idle],
      metrics: { historyDays: 0, categorizedPercent: 0, daysSinceActivity: null },
    };
  }

  // The weakest account decides: a total is only as current as its least current part.
  const historyDays = Math.min(...withData.map(a => daysBetween(a.firstDate!, input.today)));
  const daysSinceActivity = Math.max(...withData.map(a => daysBetween(later(a.lastDate, a.lastImportDate)!, input.today)));
  // Floor, so 89.9 % does not pass a 90 % threshold.
  const categorizedPercent = Math.floor((input.categorizedCount * 100) / input.transactionCount);

  const meets = (t: (typeof DATA_QUALITY_THRESHOLDS)['A' | 'B']) =>
    historyDays >= t.historyDays && categorizedPercent >= t.categorizedPercent && daysSinceActivity <= t.activityWithinDays;
  let grade: DataQualityGrade = meets(DATA_QUALITY_THRESHOLDS.A) ? 'A' : meets(DATA_QUALITY_THRESHOLDS.B) ? 'B' : 'C';
  // Lines still waiting in an import mean the figures are known to be incomplete.
  if (grade === 'A' && input.unresolvedImportRows > 0) grade = 'B';

  const a = DATA_QUALITY_THRESHOLDS.A;
  const reasons: DataQualityReason[] = [];
  if (daysSinceActivity > a.activityWithinDays) reasons.push({ code: 'stale_activity', days: daysSinceActivity, limit: a.activityWithinDays });
  if (input.unresolvedImportRows > 0) reasons.push({ code: 'unresolved_import_rows', count: input.unresolvedImportRows });
  if (categorizedPercent < a.categorizedPercent) reasons.push({ code: 'low_categorization', percent: categorizedPercent, needed: a.categorizedPercent });
  if (historyDays < a.historyDays) reasons.push({ code: 'short_history', days: historyDays, needed: a.historyDays });
  reasons.push(...idle);

  return { grade, version: DATA_QUALITY_VERSION, reasons, metrics: { historyDays, categorizedPercent, daysSinceActivity } };
}
