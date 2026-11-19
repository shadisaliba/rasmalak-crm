'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg, useOrgPermission } from '@/store/orgStore';
import { useCrm } from '@/store/crmStore';
import { smeApi, errorText, type SmeApiError } from '@/sme/api/client';
import { DataState } from '@/sme/ui/DataState';
import { SmeGate } from '@/sme/profile/ui/SmeGate';
import { Chip, card, input, muted, primaryButton, useLedgerText } from '@/sme/ledger/ui/shared';
import type { InvoiceStatus } from '../domain/totals';
import { InvoiceForm } from './InvoiceForm';
import { RegisterNote } from './RegisterNote';

export interface InvoiceRow {
  invoice_id: string; number: string; customer_company_id: string | null; customer_contact_id: string | null;
  issue_date: string; due_date: string; currency: string; total_minor: string; outstanding_minor: string;
  derived_status: InvoiceStatus; days_overdue: number;
}

export const STATUS_TONE: Record<InvoiceStatus, 'neutral' | 'warning' | 'info'> = {
  draft: 'info', open: 'neutral', partially_paid: 'neutral', paid: 'neutral', overdue: 'warning', void: 'info', written_off: 'info',
};

export function usePartyName() {
  const L = useLedgerText();
  const { companies, contacts } = useCrm();
  return (companyId: string | null, contactId: string | null) => {
    if (companyId) { const c = companies.find(x => x.id === companyId); return c ? L.localName(c.name, c.nameAr) : ''; }
    const p = contacts.find(x => x.id === contactId);
    return p ? (L.isAr ? [p.firstNameAr || p.firstName, p.lastNameAr || p.lastName] : [p.firstName, p.lastName]).filter(Boolean).join(' ') : '';
  };
}

const FILTERS: Array<InvoiceStatus | ''> = ['', 'overdue', 'open', 'partially_paid', 'paid', 'draft', 'void', 'written_off'];

export function ReceivablesPage() {
  const L = useLedgerText();
  const { currentOrg } = useOrg();
  const canWrite = useOrgPermission('sme.receivables.write');
  const partyName = usePartyName();
  const [status, setStatus] = useState<InvoiceStatus | ''>('');
  const [load, setLoad] = useState<{ status: 'loading' } | { status: 'failed'; error: SmeApiError } | { status: 'ready'; items: InvoiceRow[] }>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!currentOrg) return;
    let ignore = false;
    smeApi<{ items: InvoiceRow[] }>(`invoices${status ? `?status=${status}` : ''}`, { orgId: currentOrg.id }).then(r => {
      if (!ignore) setLoad(r.ok ? { status: 'ready', items: r.data.items } : { status: 'failed', error: r.error });
    });
    return () => { ignore = true; };
  }, [currentOrg, status, reloadKey]);

  const outstanding = load.status === 'ready'
    ? load.items.filter(i => ['open', 'partially_paid', 'overdue'].includes(i.derived_status) && i.currency === 'JOD').reduce((s, i) => s + BigInt(i.outstanding_minor), 0n)
    : 0n;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: '1100px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 600, color: 'var(--ds-text-heading)', margin: '0 0 4px' }}>{L.t('sme.receivables.title')}</h1>
          <p style={{ fontSize: '13px', color: 'var(--ds-text-muted)', margin: 0 }}>{L.t('sme.receivables.description')}</p>
        </div>
        {canWrite && <button type="button" style={primaryButton} onClick={() => setCreating(!creating)}>{L.t('sme.receivables.new')}</button>}
      </div>
      <SmeGate permission="sme.receivables.read">
        <RegisterNote />
        {creating && currentOrg && <InvoiceForm orgId={currentOrg.id} onDone={() => { setCreating(false); setReloadKey(k => k + 1); }} onCancel={() => setCreating(false)} />}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={status} onChange={e => setStatus(e.target.value as InvoiceStatus | '')} aria-label={L.t('sme.receivables.filter')} style={{ ...input, maxWidth: '240px' }}>
            {FILTERS.map(f => <option key={f} value={f}>{L.t(f ? `sme.invoiceStatus.${f}` : 'sme.receivables.filter.all')}</option>)}
          </select>
          {load.status === 'ready' && !status && (
            <span style={{ fontSize: '14px', color: 'var(--ds-text-body)' }} data-testid="receivables-outstanding">
              {L.t('sme.receivables.totalOutstanding', { amount: L.amount(outstanding, 'JOD') })}
            </span>
          )}
        </div>
        {load.status === 'loading' ? <DataState state="loading" /> : load.status === 'failed' ? (
          <DataState state="failed" message={errorText(load.error, L.intl.locale)} onRetry={() => setReloadKey(k => k + 1)} />
        ) : load.items.length === 0 ? (
          <DataState state="empty" message={L.t(status ? 'sme.receivables.emptyFiltered' : 'sme.receivables.empty')} />
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {load.items.map(i => (
              <li key={i.invoice_id} style={{ ...card, padding: '12px 14px' }} data-testid="invoice-row">
                <Link href={`/crm/money/receivables/${i.invoice_id}`} style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', textDecoration: 'none', color: 'inherit' }}>
                  <span style={{ minWidth: '90px', fontWeight: 600, color: 'var(--ds-text-heading)' }}><bdi>{i.number}</bdi></span>
                  <span style={{ flex: '1 1 160px', fontSize: '14px', color: 'var(--ds-text-body)' }}>{partyName(i.customer_company_id, i.customer_contact_id)}</span>
                  <Chip tone={STATUS_TONE[i.derived_status]}>{L.t(`sme.invoiceStatus.${i.derived_status}`)}</Chip>
                  <span style={muted}>{L.t('sme.receivables.due', { date: L.date(i.due_date) })}{i.days_overdue > 0 ? ` · ${L.t('sme.receivables.daysOverdue', { days: i.days_overdue })}` : ''}</span>
                  <span style={{ minWidth: '140px', textAlign: 'end', fontWeight: 600, color: 'var(--ds-text-heading)' }}>
                    {L.amount(i.outstanding_minor, i.currency)}
                    <span style={{ display: 'block', ...muted, fontWeight: 400 }}>{L.t('sme.receivables.ofTotal', { amount: L.amount(i.total_minor, i.currency) })}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SmeGate>
    </div>
  );
}
