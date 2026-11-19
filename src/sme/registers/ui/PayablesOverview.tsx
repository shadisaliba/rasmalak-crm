'use client';

import { useEffect, useState } from 'react';
import { useOrg } from '@/store/orgStore';
import { smeApi } from '@/sme/api/client';
import { card, muted, useLedgerText } from '@/sme/ledger/ui/shared';
import { usePartyName } from './RegisterListPage';

interface Overview {
  buckets: Array<{ currency: string; bucket: 'overdue' | 'd7' | 'd14' | 'd30' | 'later'; count: number; minor: string }>;
  concentration: Array<{ supplier_company_id: string | null; supplier_contact_id: string | null; currency: string; minor: string; share_bp: number }>;
}

const BUCKETS = ['overdue', 'd7', 'd14', 'd30'] as const;

/** FIN-04: what falls due when, and how concentrated the last 90 days of bills are by supplier. */
export function PayablesOverview({ refreshKey }: { refreshKey: number }) {
  const L = useLedgerText();
  const { currentOrg } = useOrg();
  const partyName = usePartyName();
  const [data, setData] = useState<Overview | null>(null);

  useEffect(() => {
    if (!currentOrg) return;
    let ignore = false;
    smeApi<Overview>('payables/overview', { orgId: currentOrg.id }).then(r => { if (!ignore && r.ok) setData(r.data); });
    return () => { ignore = true; };
  }, [currentOrg, refreshKey]);

  if (!data) return null;
  const jod = data.buckets.filter(b => b.currency === 'JOD');
  const top = data.concentration.filter(c => c.currency === 'JOD').slice(0, 5);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px' }}>
      <section style={{ ...card, display: 'flex', flexDirection: 'column', gap: '8px' }} aria-labelledby="due-title" data-testid="payables-due">
        <h2 id="due-title" style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--ds-text-heading)' }}>{L.t('sme.payables.dueTitle')}</h2>
        {BUCKETS.map(b => {
          const row = jod.find(x => x.bucket === b);
          return (
            <div key={b} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '14px', color: b === 'overdue' && row ? 'var(--ds-warning-text)' : 'var(--ds-text-body)' }}>
              <span>{L.t(`sme.payables.bucket.${b}`)} · {L.t('sme.payables.billCount', { count: row?.count ?? 0 })}</span>
              <span style={{ fontWeight: 600 }}>{L.amount(row?.minor ?? '0', 'JOD')}</span>
            </div>
          );
        })}
      </section>
      <section style={{ ...card, display: 'flex', flexDirection: 'column', gap: '8px' }} aria-labelledby="concentration-title">
        <h2 id="concentration-title" style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--ds-text-heading)' }}>{L.t('sme.payables.concentrationTitle')}</h2>
        {top.length === 0 ? <p style={muted}>{L.t('sme.payables.concentrationEmpty')}</p> : top.map((c, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '14px', color: 'var(--ds-text-body)' }}>
            <span>{partyName(c.supplier_company_id, c.supplier_contact_id)}</span>
            <span style={{ fontWeight: 600 }}>{L.t('sme.payables.share', { percent: L.decimal(String(c.share_bp / 100)) })}</span>
          </div>
        ))}
        <p style={muted}>{L.t('sme.payables.concentrationBasis')}</p>
      </section>
    </div>
  );
}
