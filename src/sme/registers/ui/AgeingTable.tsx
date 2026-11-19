'use client';

import { useEffect, useState } from 'react';
import { useOrg } from '@/store/orgStore';
import { smeApi } from '@/sme/api/client';
import { DataState } from '@/sme/ui/DataState';
import { card, muted, useLedgerText } from '@/sme/ledger/ui/shared';
import { REGISTERS, type RegisterKind } from './config';
import { usePartyName } from './RegisterListPage';

interface Row {
  customer_company_id?: string | null; customer_contact_id?: string | null; supplier_company_id?: string | null; supplier_contact_id?: string | null;
  currency: string; is_total: boolean; current_minor: string; d1_30_minor: string; d31_60_minor: string; d61_90_minor: string; d90_plus_minor: string; total_minor: string;
}
const BUCKETS = ['current_minor', 'd1_30_minor', 'd31_60_minor', 'd61_90_minor', 'd90_plus_minor', 'total_minor'] as const;

/** Outstanding amounts by days past due, per party and in total (F1.07). */
export function AgeingTable({ kind }: { kind: RegisterKind }) {
  const cfg = REGISTERS[kind];
  const L = useLedgerText();
  const { currentOrg } = useOrg();
  const partyName = usePartyName();
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    if (!currentOrg) return;
    let ignore = false;
    smeApi<{ items: Row[] }>(`ageing?register=${kind}`, { orgId: currentOrg.id }).then(r => { if (!ignore) setRows(r.ok ? r.data.items : []); });
    return () => { ignore = true; };
  }, [currentOrg, kind]);

  if (!rows) return <DataState state="loading" />;
  if (!rows.length) return <DataState state="empty" message={L.t('sme.ageing.empty')} />;
  const sorted = [...rows].sort((a, b) => Number(a.is_total) - Number(b.is_total) || (BigInt(b.total_minor) > BigInt(a.total_minor) ? 1 : -1));
  const cell: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid var(--ds-border)', textAlign: 'end', whiteSpace: 'nowrap' };
  return (
    <section style={{ ...card, padding: 0, overflowX: 'auto' }} aria-label={L.t('sme.ageing.title')} data-testid="ageing">
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '13px', color: 'var(--ds-text-body)' }}>
        <thead>
          <tr>
            <th style={{ ...cell, textAlign: 'start' }}>{L.t(`${cfg.msg}.form.customer`)}</th>
            {BUCKETS.map(b => <th key={b} style={{ ...cell, fontWeight: 600 }}>{L.t(`sme.ageing.${b}`)}</th>)}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={i} style={{ fontWeight: r.is_total ? 600 : 400, background: r.is_total ? 'var(--ds-bg-tinted)' : undefined }}>
              <td style={{ ...cell, textAlign: 'start' }}>
                {r.is_total ? L.t('sme.ageing.total', { currency: r.currency }) : partyName(r[`${cfg.party}_company_id`] ?? null, r[`${cfg.party}_contact_id`] ?? null)}
              </td>
              {BUCKETS.map(b => <td key={b} style={cell}>{L.amount(r[b], r.currency)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ ...muted, padding: '8px 10px' }}>{L.t('sme.ageing.basis')}</p>
    </section>
  );
}
