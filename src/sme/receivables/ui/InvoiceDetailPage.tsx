'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useOrg, useOrgPermission } from '@/store/orgStore';
import { smeApi, errorText, type SmeApiError } from '@/sme/api/client';
import { DataState } from '@/sme/ui/DataState';
import { SmeGate } from '@/sme/profile/ui/SmeGate';
import { Chip, Field, FormError, card, input, muted, parseAmount, primaryButton, secondaryButton, useIdempotencyKey, useLedgerText } from '@/sme/ledger/ui/shared';
import { isCurrencyCode, money, toMajorString } from '@/sme/money';
import type { InvoiceStatus } from '../domain/totals';
import { RegisterNote } from './RegisterNote';
import { STATUS_TONE, usePartyName } from './ReceivablesPage';

interface Detail {
  invoice: {
    id: string; number: string; customer_company_id: string | null; customer_contact_id: string | null; issue_date: string; due_date: string;
    currency: string; subtotal_minor: string; tax_minor: string; total_minor: string; status: string; notes: string | null;
    status_reason: string | null; status_changed_at: string | null; created_at: string;
  };
  balance: { allocated_minor: string; outstanding_minor: string; derived_status: InvoiceStatus; days_overdue: number } | null;
  lines: Array<{ position: number; description: string; quantity: string; unit_price_minor: string; tax_rate_bp: number; line_subtotal_minor: string; line_tax_minor: string }>;
  allocations: Array<{ id: string; transaction_id: string; amount_minor: string; reversal_of: string | null; reason: string | null; created_at: string }>;
  transactions: Array<{ id: string; value_date: string; description: string }>;
}
interface Receipt { transaction_id: string; account_name: string; value_date: string; description: string; amount_minor: string; unallocated_minor: string }

export function InvoiceDetailPage() {
  const L = useLedgerText();
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const { currentOrg } = useOrg();
  const canWrite = useOrgPermission('sme.receivables.write');
  const partyName = usePartyName();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loadError, setLoadError] = useState<SmeApiError | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [panel, setPanel] = useState<'none' | 'allocate' | 'void' | 'written_off'>('none');
  const reload = () => setReloadKey(k => k + 1);
  const orgId = currentOrg?.id;

  useEffect(() => {
    if (!orgId) return;
    let ignore = false;
    smeApi<Detail>(`invoices/${invoiceId}`, { orgId }).then(r => {
      if (ignore) return;
      if (r.ok) { setDetail(r.data); setLoadError(null); } else setLoadError(r.error);
    });
    return () => { ignore = true; };
  }, [orgId, invoiceId, reloadKey]);

  const issue = async () => {
    if (!orgId) return;
    const r = await smeApi(`invoices/${invoiceId}/status`, { orgId, method: 'POST', body: { to: 'open' } });
    if (r.ok) reload();
  };

  if (loadError) return <DataState state="failed" message={errorText(loadError, L.intl.locale)} onRetry={reload} />;
  if (!detail) return <DataState state="loading" />;
  const { invoice, balance, lines, allocations, transactions } = detail;
  const status = balance?.derived_status ?? (invoice.status as InvoiceStatus);
  const reversed = new Set(allocations.filter(a => a.reversal_of).map(a => a.reversal_of));
  const txById = new Map(transactions.map(t => [t.id, t]));
  const cur = invoice.currency;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: '1000px' }}>
      <div>
        <Link href="/crm/money/receivables" style={{ fontSize: '13px', color: 'var(--ds-primary)' }}>{L.t('sme.receivables.back')}</Link>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginTop: '6px' }}>
          <h1 style={{ fontSize: '24px', fontWeight: 600, color: 'var(--ds-text-heading)', margin: 0 }}>{L.t('sme.receivables.recordTitle', { number: invoice.number })}</h1>
          <Chip tone={STATUS_TONE[status]}>{L.t(`sme.invoiceStatus.${status}`)}</Chip>
        </div>
        <p style={{ ...muted, fontSize: '13px', marginTop: '4px' }}>{partyName(invoice.customer_company_id, invoice.customer_contact_id)}</p>
      </div>
      <SmeGate permission="sme.receivables.read">
        <RegisterNote />
        <section style={{ ...card, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }} aria-label={L.t('sme.receivables.summary')}>
          {[
            ['sme.receivables.form.issueDate', L.date(invoice.issue_date)],
            ['sme.receivables.form.dueDate', L.date(invoice.due_date)],
            ['sme.receivables.total', L.amount(invoice.total_minor, cur)],
            ['sme.receivables.allocated', L.amount(balance?.allocated_minor ?? '0', cur)],
            ['sme.receivables.outstanding', L.amount(balance?.outstanding_minor ?? invoice.total_minor, cur)],
          ].map(([k, v]) => (
            <div key={k}><div style={muted}>{L.t(k)}</div><div data-testid={k === 'sme.receivables.outstanding' ? 'invoice-outstanding' : undefined} style={{ fontSize: '16px', fontWeight: 600, color: 'var(--ds-text-heading)' }}>{v}</div></div>
          ))}
          {balance && balance.days_overdue > 0 && <div><div style={muted}>{L.t('sme.receivables.overdueBy')}</div><div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--ds-warning-text)' }}>{L.t('sme.receivables.daysOverdue', { days: balance.days_overdue })}</div></div>}
        </section>

        {canWrite && (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {invoice.status === 'draft' && <button type="button" style={primaryButton} onClick={issue}>{L.t('sme.receivables.issue')}</button>}
            {invoice.status === 'open' && BigInt(balance?.outstanding_minor ?? '0') > 0n && <button type="button" style={primaryButton} onClick={() => setPanel(panel === 'allocate' ? 'none' : 'allocate')}>{L.t('sme.receivables.allocate')}</button>}
            {(invoice.status === 'draft' || invoice.status === 'open') && <button type="button" style={secondaryButton} onClick={() => setPanel(panel === 'void' ? 'none' : 'void')}>{L.t('sme.receivables.void')}</button>}
            {invoice.status === 'open' && BigInt(balance?.outstanding_minor ?? '0') > 0n && <button type="button" style={secondaryButton} onClick={() => setPanel(panel === 'written_off' ? 'none' : 'written_off')}>{L.t('sme.receivables.writeOff')}</button>}
          </div>
        )}
        {orgId && panel === 'allocate' && <AllocatePanel orgId={orgId} invoiceId={invoice.id} currency={cur} outstanding={BigInt(balance?.outstanding_minor ?? '0')} onDone={() => { setPanel('none'); reload(); }} />}
        {orgId && (panel === 'void' || panel === 'written_off') && <ReasonPanel orgId={orgId} path={`invoices/${invoice.id}/status`} extra={{ to: panel }} label={L.t(panel === 'void' ? 'sme.receivables.voidConfirm' : 'sme.receivables.writeOffConfirm')} help={L.t(panel === 'void' ? 'sme.receivables.voidHelp' : 'sme.receivables.writeOffHelp')} onDone={() => { setPanel('none'); reload(); }} />}
        {invoice.status_reason && <p style={muted}>{L.t('sme.receivables.statusReason', { reason: invoice.status_reason, date: L.dateTime(invoice.status_changed_at) })}</p>}

        <section style={{ ...card, display: 'flex', flexDirection: 'column', gap: '8px' }} aria-labelledby="invoice-lines">
          <h2 id="invoice-lines" style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--ds-text-heading)' }}>{L.t('sme.receivables.form.lines')}</h2>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {lines.map(l => (
              <li key={l.position} style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', fontSize: '14px', borderBottom: '1px solid var(--ds-border)', paddingBottom: '6px' }}>
                <span style={{ flex: '1 1 200px' }}>{l.description}</span>
                <span style={muted}>{L.t('sme.receivables.lineMath', { qty: L.decimal(l.quantity), price: L.amount(l.unit_price_minor, cur), rate: L.decimal(String(l.tax_rate_bp / 100)) })}</span>
                <span style={{ fontWeight: 500 }}>{L.amount(BigInt(l.line_subtotal_minor) + BigInt(l.line_tax_minor), cur)}</span>
              </li>
            ))}
          </ul>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--ds-text-body)' }}>
            {L.t('sme.receivables.totalsLine', { subtotal: L.amount(invoice.subtotal_minor, cur), tax: L.amount(invoice.tax_minor, cur), total: L.amount(invoice.total_minor, cur) })}
          </p>
          {invoice.notes && <p style={muted}>{invoice.notes}</p>}
        </section>

        <section style={{ ...card, display: 'flex', flexDirection: 'column', gap: '8px' }} aria-labelledby="invoice-allocations">
          <h2 id="invoice-allocations" style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--ds-text-heading)' }}>{L.t('sme.receivables.allocations')}</h2>
          {allocations.length === 0 ? <p style={muted}>{L.t('sme.receivables.noAllocations')}</p> : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {allocations.map(a => {
                const tx = txById.get(a.transaction_id);
                return (
                  <li key={a.id} data-testid="allocation" style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '14px', borderBottom: '1px solid var(--ds-border)', paddingBottom: '8px' }}>
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'baseline' }}>
                      <span style={{ fontWeight: 600, textDecoration: reversed.has(a.id) ? 'line-through' : 'none' }}>{L.amount(a.amount_minor, cur, { signDisplay: 'always' })}</span>
                      <span style={{ flex: 1 }}>{tx ? `${L.date(tx.value_date)} · ${tx.description}` : ''}</span>
                      <span style={muted}>{L.dateTime(a.created_at)}</span>
                    </div>
                    {a.reason && <span style={muted}>{L.t('sme.money.tx.reversalReason', { reason: a.reason })}</span>}
                    {canWrite && !a.reversal_of && !reversed.has(a.id) && orgId && (
                      <ReasonPanel orgId={orgId} path={`invoice-allocations/${a.id}/reverse`} label={L.t('sme.receivables.reverseAllocation')} help={L.t('sme.receivables.reverseAllocationHelp')} compact onDone={reload} />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </SmeGate>
    </div>
  );
}

function AllocatePanel({ orgId, invoiceId, currency, outstanding, onDone }: { orgId: string; invoiceId: string; currency: string; outstanding: bigint; onDone: () => void }) {
  const L = useLedgerText();
  const idem = useIdempotencyKey();
  const [receipts, setReceipts] = useState<Receipt[] | null>(null);
  const [picked, setPicked] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    smeApi<{ items: Receipt[] }>(`receipts/unallocated?currency=${currency}`, { orgId }).then(r => { if (!ignore) setReceipts(r.ok ? r.data.items : []); });
    return () => { ignore = true; };
  }, [orgId, currency]);

  const choose = (id: string) => {
    setPicked(id);
    const r = receipts?.find(x => x.transaction_id === id);
    if (r && isCurrencyCode(currency)) {
      const suggested = BigInt(r.unallocated_minor) < outstanding ? BigInt(r.unallocated_minor) : outstanding;
      setAmount(toMajorString(money(suggested, currency)));
    }
  };

  const submit = async () => {
    setError(null);
    const minor = parseAmount(amount, currency);
    if (!picked || minor === null || minor <= 0n) return setError(L.t('sme.money.form.invalidAmount'));
    const r = await smeApi(`invoices/${invoiceId}/allocations`, { orgId, method: 'POST', idempotencyKey: idem.current(), body: { transaction_id: picked, amount_minor: minor.toString() } });
    if (!r.ok) return setError(errorText(r.error, L.intl.locale));
    idem.rotate();
    onDone();
  };

  return (
    <section style={{ ...card, display: 'flex', flexDirection: 'column', gap: '10px' }} aria-labelledby="allocate-title">
      <h2 id="allocate-title" style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--ds-text-heading)' }}>{L.t('sme.receivables.allocate')}</h2>
      <p style={muted}>{L.t('sme.receivables.allocateHelp')}</p>
      {receipts === null ? <DataState state="loading" /> : receipts.length === 0 ? <p style={muted}>{L.t('sme.receivables.noReceipts')}</p> : (
        <div role="radiogroup" aria-label={L.t('sme.receivables.receipts')} style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '260px', overflowY: 'auto' }}>
          {receipts.map(r => (
            <label key={r.transaction_id} style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '13px', color: 'var(--ds-text-body)', cursor: 'pointer' }}>
              <input type="radio" name="receipt" checked={picked === r.transaction_id} onChange={() => choose(r.transaction_id)} />
              <span style={{ flex: 1 }}>{L.date(r.value_date)} · {r.description || L.t('sme.money.tx.noDescription')} · {r.account_name}</span>
              <span style={{ fontWeight: 500 }}>{L.t('sme.receivables.available', { amount: L.amount(r.unallocated_minor, currency) })}</span>
            </label>
          ))}
        </div>
      )}
      <Field text={L.t('sme.money.form.amountIn', { currency })}><input value={amount} inputMode="decimal" dir="ltr" onChange={e => setAmount(e.target.value)} style={{ ...input, maxWidth: '220px' }} /></Field>
      <FormError message={error} />
      <button type="button" style={{ ...primaryButton, alignSelf: 'flex-start' }} onClick={submit}>{L.t('sme.receivables.allocateConfirm')}</button>
    </section>
  );
}

function ReasonPanel({ orgId, path, extra, label, help, compact, onDone }: { orgId: string; path: string; extra?: Record<string, string>; label: string; help: string; compact?: boolean; onDone: () => void }) {
  const L = useLedgerText();
  const idem = useIdempotencyKey();
  const [open, setOpen] = useState(!compact);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!open) return <button type="button" style={{ ...secondaryButton, alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>{label}</button>;
  const submit = async () => {
    if (!reason.trim()) return setError(L.t('sme.money.tx.reasonRequired'));
    const r = await smeApi(path, { orgId, method: 'POST', idempotencyKey: idem.current(), body: { ...extra, reason: reason.trim() } });
    if (!r.ok) return setError(errorText(r.error, L.intl.locale));
    idem.rotate();
    onDone();
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', ...(compact ? {} : { ...card }) }}>
      <p style={{ margin: 0, fontSize: '13px', color: 'var(--ds-text-body)' }}>{help}</p>
      <Field text={L.t('sme.money.tx.reason')}><input value={reason} onChange={e => setReason(e.target.value)} style={input} /></Field>
      <FormError message={error} />
      <button type="button" style={{ ...primaryButton, alignSelf: 'flex-start' }} onClick={submit}>{label}</button>
    </div>
  );
}
