'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg, useOrgPermission } from '@/store/orgStore';
import { useCrm } from '@/store/crmStore';
import { smeApi, errorText, type SmeApiError } from '@/sme/api/client';
import { DataState } from '@/sme/ui/DataState';
import { SmeGate } from '@/sme/profile/ui/SmeGate';
import { Chip, card, input, muted, primaryButton, useLedgerText } from '@/sme/ledger/ui/shared';
import { RegisterNote } from '@/sme/receivables/ui/RegisterNote';
import { REGISTERS, STATUS_TONE, type RegisterKind, type RegisterStatus } from './config';
import { RegisterForm } from './RegisterForm';
import { PayablesOverview } from './PayablesOverview';
import { AgeingTable } from './AgeingTable';

export interface RegisterRow {
  invoice_id?: string; bill_id?: string; number?: string; supplier_reference?: string | null;
  customer_company_id?: string | null; customer_contact_id?: string | null; supplier_company_id?: string | null; supplier_contact_id?: string | null;
  issue_date: string; due_date: string; currency: string; total_minor: string; outstanding_minor: string;
  derived_status: RegisterStatus; days_overdue: number;
}

export function usePartyName() {
  const L = useLedgerText();
  const { companies, contacts } = useCrm();
  return (companyId: string | null, contactId: string | null) => {
    if (companyId) { const c = companies.find(x => x.id === companyId); return c ? L.localName(c.name, c.nameAr) : ''; }
    const p = contacts.find(x => x.id === contactId);
    return p ? (L.isAr ? [p.firstNameAr || p.firstName, p.lastNameAr || p.lastName] : [p.firstName, p.lastName]).filter(Boolean).join(' ') : '';
  };
}

const FILTERS: Record<RegisterKind, Array<RegisterStatus | ''>> = {
  invoice: ['', 'overdue', 'open', 'partially_paid', 'paid', 'draft', 'void', 'written_off'],
  bill: ['', 'overdue', 'open', 'partially_paid', 'paid', 'draft', 'void'],
};

export function RegisterListPage({ kind }: { kind: RegisterKind }) {
  const cfg = REGISTERS[kind];
  const L = useLedgerText();
  const { currentOrg } = useOrg();
  const canWrite = useOrgPermission(cfg.writePerm);
  const partyName = usePartyName();
  const [status, setStatus] = useState<RegisterStatus | ''>('');
  const [load, setLoad] = useState<{ status: 'loading' } | { status: 'failed'; error: SmeApiError } | { status: 'ready'; items: RegisterRow[] }>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<'list' | 'ageing'>('list');

  useEffect(() => {
    if (!currentOrg) return;
    let ignore = false;
    smeApi<{ items: RegisterRow[] }>(`${cfg.api}${status ? `?status=${status}` : ''}`, { orgId: currentOrg.id }).then(r => {
      if (!ignore) setLoad(r.ok ? { status: 'ready', items: r.data.items } : { status: 'failed', error: r.error });
    });
    return () => { ignore = true; };
  }, [currentOrg, status, reloadKey, cfg.api]);

  const outstanding = load.status === 'ready'
    ? load.items.filter(i => ['open', 'partially_paid', 'overdue'].includes(i.derived_status) && i.currency === 'JOD').reduce((s, i) => s + BigInt(i.outstanding_minor), 0n)
    : 0n;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: '1100px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 600, color: 'var(--ds-text-heading)', margin: '0 0 4px' }}>{L.t(`${cfg.msg}.title`)}</h1>
          <p style={{ fontSize: '13px', color: 'var(--ds-text-muted)', margin: 0 }}>{L.t(`${cfg.msg}.description`)}</p>
        </div>
        {canWrite && <button type="button" style={primaryButton} onClick={() => setCreating(!creating)}>{L.t(`${cfg.msg}.new`)}</button>}
      </div>
      <SmeGate permission={cfg.readPerm}>
        {kind === 'invoice' && <RegisterNote />}
        {kind === 'bill' && <PayablesOverview refreshKey={reloadKey} />}
        {creating && currentOrg && <RegisterForm kind={kind} orgId={currentOrg.id} onDone={() => { setCreating(false); setReloadKey(k => k + 1); }} onCancel={() => setCreating(false)} />}
        <div role="tablist" style={{ display: 'flex', gap: '6px' }}>
          {(['list', 'ageing'] as const).map(v => (
            <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
              style={{ padding: '7px 12px', fontSize: '13px', borderRadius: '8px', border: '1px solid var(--ds-border)', cursor: 'pointer',
                       background: view === v ? 'var(--ds-primary)' : 'transparent', color: view === v ? 'var(--ds-on-primary)' : 'var(--ds-text-body)' }}>
              {L.t(`sme.ageing.tab.${v}`)}
            </button>
          ))}
        </div>
        {view === 'ageing' ? <AgeingTable kind={kind} /> : (<>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={status} onChange={e => setStatus(e.target.value as RegisterStatus | '')} aria-label={L.t(`${cfg.msg}.filter`)} style={{ ...input, maxWidth: '240px' }}>
            {FILTERS[kind].map(f => <option key={f} value={f}>{L.t(f ? `${cfg.statusMsg}.${f}` : `${cfg.msg}.filter.all`)}</option>)}
          </select>
          {load.status === 'ready' && !status && (
            <span style={{ fontSize: '14px', color: 'var(--ds-text-body)' }} data-testid="register-outstanding">
              {L.t(`${cfg.msg}.totalOutstanding`, { amount: L.amount(outstanding, 'JOD') })}
            </span>
          )}
        </div>
        {load.status === 'loading' ? <DataState state="loading" /> : load.status === 'failed' ? (
          <DataState state="failed" message={errorText(load.error, L.intl.locale)} onRetry={() => setReloadKey(k => k + 1)} />
        ) : load.items.length === 0 ? (
          <DataState state="empty" message={L.t(status ? `${cfg.msg}.emptyFiltered` : `${cfg.msg}.empty`)} />
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {load.items.map(i => (
              <li key={i[cfg.idField]} style={{ ...card, padding: '12px 14px' }} data-testid="register-row">
                <Link href={`${cfg.route}/${i[cfg.idField]}`} style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', textDecoration: 'none', color: 'inherit' }}>
                  <span style={{ minWidth: '90px', fontWeight: 600, color: 'var(--ds-text-heading)' }}><bdi>{i[cfg.refField] || '—'}</bdi></span>
                  <span style={{ flex: '1 1 160px', fontSize: '14px', color: 'var(--ds-text-body)' }}>{partyName(i[`${cfg.party}_company_id`] ?? null, i[`${cfg.party}_contact_id`] ?? null)}</span>
                  <Chip tone={STATUS_TONE[i.derived_status]}>{L.t(`${cfg.statusMsg}.${i.derived_status}`)}</Chip>
                  <span style={muted}>{L.t(`${cfg.msg}.due`, { date: L.date(i.due_date) })}{i.days_overdue > 0 ? ` · ${L.t(`${cfg.msg}.daysOverdue`, { days: i.days_overdue })}` : ''}</span>
                  <span style={{ minWidth: '140px', textAlign: 'end', fontWeight: 600, color: 'var(--ds-text-heading)' }}>
                    {L.amount(i.outstanding_minor, i.currency)}
                    <span style={{ display: 'block', ...muted, fontWeight: 400 }}>{L.t(`${cfg.msg}.ofTotal`, { amount: L.amount(i.total_minor, i.currency) })}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        </>)}
      </SmeGate>
    </div>
  );
}
