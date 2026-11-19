import { describe, expect, it } from 'vitest';
import { assessDataQuality, type DataQualityInput } from './dataQuality';

const base: DataQualityInput = {
  today: '2026-11-19',
  accounts: [{ accountId: 'a', firstDate: '2026-08-01', lastDate: '2026-11-17', lastImportDate: null }],
  transactionCount: 100,
  categorizedCount: 95,
  unresolvedImportRows: 0,
};

describe('data quality', () => {
  it('is insufficient without posted transactions', () => {
    expect(assessDataQuality({ ...base, transactionCount: 0, categorizedCount: 0 }).grade).toBe('insufficient');
    expect(assessDataQuality({ ...base, accounts: [{ accountId: 'a', firstDate: null, lastDate: null, lastImportDate: null }] }).reasons)
      .toEqual([{ code: 'no_transactions' }, { code: 'account_without_activity', accountId: 'a' }]);
  });

  it('grades A at 90 days, 90 % categorized and activity within 7 days', () => {
    const r = assessDataQuality(base);
    expect(r).toMatchObject({ grade: 'A', reasons: [], metrics: { historyDays: 110, categorizedPercent: 95, daysSinceActivity: 2 } });
  });

  it('uses the thresholds at their edges, flooring the percentage', () => {
    expect(assessDataQuality({ ...base, accounts: [{ ...base.accounts[0], firstDate: '2026-08-21' }] }).grade).toBe('A');
    expect(assessDataQuality({ ...base, accounts: [{ ...base.accounts[0], firstDate: '2026-08-22' }] }).grade).toBe('B');
    expect(assessDataQuality({ ...base, transactionCount: 1000, categorizedCount: 899 }).grade).toBe('B');
    expect(assessDataQuality({ ...base, accounts: [{ ...base.accounts[0], lastDate: '2026-11-12' }] }).grade).toBe('A');
    expect(assessDataQuality({ ...base, accounts: [{ ...base.accounts[0], lastDate: '2026-11-11' }] }).grade).toBe('B');
  });

  it('counts an import as recent activity', () => {
    expect(assessDataQuality({ ...base, accounts: [{ ...base.accounts[0], lastDate: '2026-10-01', lastImportDate: '2026-11-18' }] }).grade).toBe('A');
  });

  it('lets the weakest account decide and explains why the grade is not higher', () => {
    const r = assessDataQuality({
      ...base, categorizedCount: 60,
      accounts: [base.accounts[0], { accountId: 'b', firstDate: '2026-11-01', lastDate: '2026-11-03', lastImportDate: null }, { accountId: 'c', firstDate: null, lastDate: null, lastImportDate: null }],
    });
    expect(r.grade).toBe('C');
    expect(r.reasons).toEqual([
      { code: 'stale_activity', days: 16, limit: 7 },
      { code: 'low_categorization', percent: 60, needed: 90 },
      { code: 'short_history', days: 18, needed: 90 },
      { code: 'account_without_activity', accountId: 'c' },
    ]);
  });

  it('caps the grade at B while import lines await a decision', () => {
    expect(assessDataQuality({ ...base, unresolvedImportRows: 3 })).toMatchObject({ grade: 'B', reasons: [{ code: 'unresolved_import_rows', count: 3 }] });
  });
});
