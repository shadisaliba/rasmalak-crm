'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useIntl } from 'react-intl';
import { supabase } from '@/lib/supabaseClient';
import { useOrg } from '@/store/orgStore';
import { todayInAmman } from '@/sme/ledger/domain/dates';
import { assessDataQuality, type DataQualityReason, type DataQualityResult } from '../domain/dataQuality';

interface Inputs {
  as_of: string;
  accounts: Array<{ account_id: string; first_date: string | null; last_date: string | null; last_import_date: string | null }>;
  transaction_count: number;
  categorized_count: number;
  unresolved_import_rows: number;
}

const TONE: Record<DataQualityResult['grade'], { bg: string; border: string; text: string }> = {
  A: { bg: 'var(--ds-success-bg)', border: 'var(--ds-success-border)', text: 'var(--ds-success-text)' },
  B: { bg: 'var(--ds-bg-tinted)', border: 'var(--ds-border-tinted)', text: 'var(--ds-text-body)' },
  C: { bg: 'var(--ds-warning-bg)', border: 'var(--ds-warning-border)', text: 'var(--ds-warning-text)' },
  insufficient: { bg: 'var(--ds-warning-bg)', border: 'var(--ds-warning-border)', text: 'var(--ds-warning-text)' },
};

const FIX: Partial<Record<DataQualityReason['code'], string>> = {
  no_transactions: '/crm/money/transactions/import',
  stale_activity: '/crm/money/transactions/import',
  short_history: '/crm/money/transactions/import',
  low_categorization: '/crm/money/transactions',
};

/**
 * How complete the financial data is (W2-07), with the reasons and the fix for each. Shown on
 * screens whose figures depend on it; `refreshKey` re-reads after the page's data changes.
 */
export function DataCompletenessBanner({ refreshKey = 0 }: { refreshKey?: number }) {
  const intl = useIntl();
  const { currentOrg } = useOrg();
  const [state, setState] = useState<{ result: DataQualityResult; asOf: string } | null>(null);
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);

  useEffect(() => {
    if (!currentOrg) return;
    let ignore = false;
    supabase.rpc('sme_data_quality_inputs', { p_org: currentOrg.id }).then(({ data, error }) => {
      if (ignore || error || !data) return;
      const inputs = data as Inputs;
      setState({
        asOf: inputs.as_of,
        result: assessDataQuality({
          today: todayInAmman(),
          accounts: inputs.accounts.map(a => ({ accountId: a.account_id, firstDate: a.first_date, lastDate: a.last_date, lastImportDate: a.last_import_date })),
          transactionCount: inputs.transaction_count,
          categorizedCount: inputs.categorized_count,
          unresolvedImportRows: inputs.unresolved_import_rows,
        }),
      });
    });
    return () => { ignore = true; };
  }, [currentOrg, refreshKey]);

  if (!state) return null;
  const { result } = state;
  const tone = TONE[result.grade];
  const reasons = result.reasons.filter(r => r.code !== 'account_without_activity').slice(0, 3);
  const idle = result.reasons.filter(r => r.code === 'account_without_activity').length;

  return (
    <section data-testid="data-quality" aria-labelledby="data-quality-title" style={{
      display: 'flex', flexDirection: 'column', gap: '6px', padding: '12px 16px', borderRadius: '12px',
      background: tone.bg, border: `1px solid ${tone.border}`, color: tone.text, fontSize: '13px',
    }}>
      <h2 id="data-quality-title" style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>
        {t(`sme.dq.grade.${result.grade}`)}
      </h2>
      <p style={{ margin: 0 }}>{t(`sme.dq.summary.${result.grade}`)}</p>
      {reasons.length > 0 && (
        <ul style={{ margin: 0, paddingInlineStart: '18px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {reasons.map(r => {
            const { code, ...values } = r as DataQualityReason & Record<string, string | number>;
            const href = FIX[code];
            return (
              <li key={code}>
                {t(`sme.dq.reason.${code}`, values as Record<string, string | number>)}
                {href && <> · <Link href={href} style={{ color: 'inherit', fontWeight: 500 }}>{t(`sme.dq.fix.${code}`)}</Link></>}
              </li>
            );
          })}
          {idle > 0 && <li>{t('sme.dq.reason.account_without_activity', { count: idle })}</li>}
        </ul>
      )}
      <p style={{ margin: 0, fontSize: '12px', opacity: 0.85 }}>
        {intl.formatMessage({ id: 'sme.dq.basis' }, {
          date: intl.formatDate(new Date(state.asOf), { dateStyle: 'medium', timeStyle: 'short' }),
          version: <bdi key="version" dir="ltr" style={{ whiteSpace: 'nowrap' }}>{result.version}</bdi>,
        })}
      </p>
    </section>
  );
}
