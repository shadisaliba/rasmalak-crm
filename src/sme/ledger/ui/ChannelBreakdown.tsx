'use client';

import { useEffect, useState } from 'react';
import { smeApi } from '@/sme/api/client';
import { todayInAmman } from '../domain/dates';
import { card, muted, useLedgerText } from './shared';

interface Row { channel: string; currency: string; inflow_minor: string; outflow_minor: string; count: number }

function minusDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Money in and out by payment channel (F1.04). Channels are labels the user assigns. */
export function ChannelBreakdown({ orgId, from, to, refreshKey }: { orgId: string; from: string; to: string; refreshKey: number }) {
  const L = useLedgerText();
  const end = to || todayInAmman();
  const start = from || minusDays(end, 29);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    let ignore = false;
    smeApi<{ items: Row[] }>(`transactions/channels?from=${start}&to=${end}`, { orgId }).then(r => { if (!ignore) setRows(r.ok ? r.data.items : []); });
    return () => { ignore = true; };
  }, [orgId, start, end, open, refreshKey]);

  return (
    <section style={{ ...card, display: 'flex', flexDirection: 'column', gap: '8px' }} aria-labelledby="channels-title">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} style={{ background: 'none', border: 'none', padding: 0, textAlign: 'start', cursor: 'pointer' }}>
        <h2 id="channels-title" style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--ds-text-heading)' }}>{L.t('sme.channels.title', { from: L.date(start), to: L.date(end) })}</h2>
      </button>
      {open && (
        <>
          <p style={muted}>{L.t('sme.channels.note')}</p>
          {!rows ? <p style={muted}>{L.t('common.loading')}</p> : rows.length === 0 ? <p style={muted}>{L.t('sme.channels.empty')}</p> : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '6px' }} data-testid="channels">
              {rows.map(r => (
                <li key={`${r.channel}-${r.currency}`} style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', fontSize: '14px', borderBottom: '1px solid var(--ds-border)', paddingBottom: '6px' }}>
                  <span style={{ flex: '1 1 140px', color: 'var(--ds-text-heading)' }}>{L.t(`sme.channel.${r.channel}`)}</span>
                  <span style={{ color: 'var(--ds-success-text)' }}>{L.t('sme.channels.in', { amount: L.amount(r.inflow_minor, r.currency) })}</span>
                  <span>{L.t('sme.channels.out', { amount: L.amount(r.outflow_minor, r.currency) })}</span>
                  <span style={muted}>{L.t('sme.money.accounts.transactionCount', { count: r.count })}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
