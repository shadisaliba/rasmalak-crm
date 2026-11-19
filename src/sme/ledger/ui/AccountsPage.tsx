'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg, useOrgPermission } from '@/store/orgStore';
import { CURRENCY_CODES } from '@/sme/money';
import { smeApi, errorText, type SmeApiError } from '@/sme/api/client';
import { DataState, type DataStateKind } from '@/sme/ui/DataState';
import { SmeGate } from '@/sme/profile/ui/SmeGate';
import { STALE_AFTER_DAYS, todayInAmman } from '../domain/dates';
import { ACCOUNT_KINDS } from '../api/schemas';
import type { AccountSummary } from '../types';
import { FxFields, type FxValue } from './FxFields';
import { Chip, Field, FormError, card, formGrid, input, muted, parseAmount, primaryButton, secondaryButton, useIdempotencyKey, useLedgerText } from './shared';

type Load = { status: 'loading' } | { status: 'failed'; error: SmeApiError } | { status: 'ready'; items: AccountSummary[] };

export function AccountsPage() {
  const L = useLedgerText();
  const { currentOrg } = useOrg();
  const canPost = useOrgPermission('sme.ledger.post');
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [panel, setPanel] = useState<'none' | 'account' | 'transfer'>('none');
  const reload = () => setReloadKey(k => k + 1);

  useEffect(() => {
    if (!currentOrg) return;
    let ignore = false;
    smeApi<{ items: AccountSummary[] }>('accounts', { orgId: currentOrg.id }).then(r => {
      if (!ignore) setLoad(r.ok ? { status: 'ready', items: r.data.items } : { status: 'failed', error: r.error });
    });
    return () => { ignore = true; };
  }, [currentOrg, reloadKey]);

  const addButton = canPost && (
    <button type="button" style={primaryButton} onClick={() => setPanel(panel === 'account' ? 'none' : 'account')}>{L.t('sme.money.accounts.add')}</button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: '1000px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 600, color: 'var(--ds-text-heading)', margin: '0 0 4px' }}>{L.t('sme.money.accounts.title')}</h1>
          <p style={{ fontSize: '13px', color: 'var(--ds-text-muted)', margin: 0 }}>{L.t('sme.money.accounts.description')}</p>
        </div>
        {load.status === 'ready' && load.items.length > 0 && (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {addButton}
            {canPost && load.items.filter(a => a.status === 'active').length > 1 && (
              <button type="button" style={secondaryButton} onClick={() => setPanel(panel === 'transfer' ? 'none' : 'transfer')}>{L.t('sme.money.transfer.open')}</button>
            )}
          </div>
        )}
      </div>

      <SmeGate permission="sme.ledger.read">
        {currentOrg && panel === 'account' && <AddAccountForm orgId={currentOrg.id} onDone={() => { setPanel('none'); reload(); }} onCancel={() => setPanel('none')} />}
        {currentOrg && panel === 'transfer' && load.status === 'ready' && (
          <TransferForm orgId={currentOrg.id} accounts={load.items.filter(a => a.status === 'active')} onDone={() => { setPanel('none'); reload(); }} onCancel={() => setPanel('none')} />
        )}
        {load.status === 'loading' ? (
          <DataState state="loading" />
        ) : load.status === 'failed' ? (
          <DataState state="failed" message={errorText(load.error, L.intl.locale)} onRetry={reload} />
        ) : load.items.length === 0 ? (
          <DataState state="empty" message={L.t('sme.money.accounts.empty')} action={panel === 'account' ? undefined : addButton} />
        ) : (
          <AccountList items={load.items} />
        )}
      </SmeGate>
    </div>
  );
}

function AccountList({ items }: { items: AccountSummary[] }) {
  const L = useLedgerText();
  const active = items.filter(a => a.status === 'active');
  const total = active.reduce((sum, a) => sum + BigInt(a.baseBalanceMinor), 0n);
  const asOf = active.map(a => a.lastValueDate).filter((d): d is string => !!d).sort().at(-1) ?? null;
  const state: DataStateKind = active.some(a => a.hasEstimatedOpening) ? 'partial' : active.every(a => a.stale) ? 'stale' : 'validated';
  const message = state === 'partial' ? L.t('sme.money.accounts.partial') : state === 'stale' ? L.t('sme.money.accounts.stale', { days: STALE_AFTER_DAYS }) : undefined;

  return (
    <DataState state={state} message={message}>
      <section style={{ ...card, display: 'flex', flexDirection: 'column', gap: '4px' }} aria-labelledby="total-cash">
        <h2 id="total-cash" style={{ ...muted, fontSize: '13px', fontWeight: 500 }}>{L.t('sme.money.accounts.totalCash')}</h2>
        <p data-testid="total-cash" style={{ margin: 0, fontSize: '26px', fontWeight: 600, color: 'var(--ds-text-heading)' }}>{L.amount(total, 'JOD')}</p>
        <p style={muted}>
          {L.t('sme.money.accounts.totalBasis', { count: active.length })}
          {asOf && <> · {L.t('sme.money.accounts.asOf', { date: L.date(asOf) })}</>}
        </p>
      </section>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '12px' }}>
        {items.map(a => (
          <li key={a.id} style={{ ...card, display: 'flex', flexDirection: 'column', gap: '6px', opacity: a.status === 'archived' ? 0.6 : 1 }} aria-label={L.localName(a.name, a.nameAr)}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'baseline' }}>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--ds-text-heading)' }}>{L.localName(a.name, a.nameAr)}</h3>
              <span style={muted}>{a.currency}</span>
            </div>
            <span style={muted}>{[L.t(`sme.accountKind.${a.kind}`), a.institution].filter(Boolean).join(' · ')}</span>
            <p style={{ margin: '4px 0 0', fontSize: '20px', fontWeight: 600, color: 'var(--ds-text-heading)' }}>{L.amount(a.balanceMinor, a.currency)}</p>
            {a.currency !== 'JOD' && <span style={muted}>{L.t('sme.money.accounts.inBase', { amount: L.amount(a.baseBalanceMinor, 'JOD') })}</span>}
            <span style={muted}>
              {a.lastValueDate ? L.t('sme.money.accounts.lastActivity', { date: L.date(a.lastValueDate) }) : L.t('sme.money.accounts.noActivity')}
              {' · '}{L.t('sme.money.accounts.transactionCount', { count: a.transactionCount })}
            </span>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {a.stale && <Chip tone="warning">{L.t('sme.money.accounts.staleChip', { days: STALE_AFTER_DAYS })}</Chip>}
              {a.hasEstimatedOpening && <Chip tone="warning">{L.t('sme.money.accounts.estimateChip')}</Chip>}
              {a.status === 'archived' && <Chip tone="info">{L.t('sme.money.accounts.archived')}</Chip>}
            </div>
            <Link href={`/crm/money/transactions?account=${a.id}`} style={{ fontSize: '13px', color: 'var(--ds-primary)', fontWeight: 500, marginTop: 'auto' }}>
              {L.t('sme.money.accounts.viewTransactions')}
            </Link>
          </li>
        ))}
      </ul>
    </DataState>
  );
}

function AddAccountForm({ orgId, onDone, onCancel }: { orgId: string; onDone: () => void; onCancel: () => void }) {
  const L = useLedgerText();
  const idem = useIdempotencyKey();
  const [form, setForm] = useState({ kind: 'bank', name: '', nameAr: '', institution: '', currency: 'JOD', opening: '', openingDate: todayInAmman(), estimate: true });
  const [fx, setFx] = useState<FxValue | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openingMinor = parseAmount(form.opening, form.currency);
  const needsFx = form.currency !== 'JOD' && openingMinor !== null && openingMinor !== 0n;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.name.trim()) return setError(L.t('sme.money.form.nameRequired'));
    if (form.opening.trim() && openingMinor === null) return setError(L.t('sme.money.form.invalidAmount'));
    if (needsFx && !fx) return setError(L.t('sme.fx.required'));
    setBusy(true);
    const r = await smeApi<{ account_id: string }>('accounts', {
      orgId, method: 'POST', idempotencyKey: idem.current(),
      body: {
        account: { kind: form.kind, name: form.name.trim(), name_ar: form.nameAr.trim() || undefined, institution: form.institution.trim() || undefined, currency: form.currency },
        opening: openingMinor ? { amount_minor: openingMinor.toString(), value_date: form.openingDate, is_estimate: form.estimate, fx: needsFx ? fx : undefined } : undefined,
      },
    });
    setBusy(false);
    if (!r.ok) return setError(errorText(r.error, L.intl.locale));
    idem.rotate();
    onDone();
  };

  return (
    <form onSubmit={submit} style={{ ...card, display: 'flex', flexDirection: 'column', gap: '12px' }} aria-labelledby="add-account-title">
      <h2 id="add-account-title" style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--ds-text-heading)' }}>{L.t('sme.money.accounts.add')}</h2>
      <div style={formGrid}>
        <Field text={L.t('sme.money.form.kind')}>
          <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })} style={input}>
            {ACCOUNT_KINDS.map(k => <option key={k} value={k}>{L.t(`sme.accountKind.${k}`)}</option>)}
          </select>
        </Field>
        <Field text={L.t('sme.money.form.name')}><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={input} /></Field>
        <Field text={L.t('sme.money.form.nameAr')}><input value={form.nameAr} dir="rtl" onChange={e => setForm({ ...form, nameAr: e.target.value })} style={input} /></Field>
        <Field text={L.t('sme.money.form.institution')}><input value={form.institution} onChange={e => setForm({ ...form, institution: e.target.value })} style={input} /></Field>
        <Field text={L.t('sme.money.form.currency')}>
          <select value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })} style={input}>
            {CURRENCY_CODES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
      </div>
      <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <legend style={{ fontSize: '14px', fontWeight: 500, color: 'var(--ds-text-heading)', marginBottom: '6px' }}>{L.t('sme.money.form.openingTitle')}</legend>
        <p style={muted}>{L.t('sme.money.form.openingHelp')}</p>
        <div style={formGrid}>
          <Field text={L.t('sme.money.form.openingAmount', { currency: form.currency })}>
            <input value={form.opening} inputMode="decimal" dir="ltr" onChange={e => setForm({ ...form, opening: e.target.value })} style={input} />
          </Field>
          <Field text={L.t('sme.money.form.openingDate')}>
            <input type="date" value={form.openingDate} onChange={e => setForm({ ...form, openingDate: e.target.value })} style={input} />
          </Field>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--ds-text-body)' }}>
          <input type="checkbox" checked={form.estimate} onChange={e => setForm({ ...form, estimate: e.target.checked })} />
          {L.t('sme.money.form.estimate')}
        </label>
        {needsFx && <FxFields orgId={orgId} currency={form.currency} date={form.openingDate} amountMinor={openingMinor} onChange={setFx} />}
      </fieldset>
      <FormError message={error} />
      <div style={{ display: 'flex', gap: '8px' }}>
        <button type="submit" style={primaryButton} disabled={busy}>{L.t('sme.money.form.saveAccount')}</button>
        <button type="button" style={secondaryButton} onClick={onCancel}>{L.t('sme.money.form.cancel')}</button>
      </div>
    </form>
  );
}

function TransferForm({ orgId, accounts, onDone, onCancel }: { orgId: string; accounts: AccountSummary[]; onDone: () => void; onCancel: () => void }) {
  const L = useLedgerText();
  const idem = useIdempotencyKey();
  const [form, setForm] = useState({ from: accounts[0]?.id ?? '', to: accounts[1]?.id ?? '', amount: '', toAmount: '', date: todayInAmman(), description: '' });
  const [fx, setFx] = useState<FxValue | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const from = accounts.find(a => a.id === form.from);
  const to = accounts.find(a => a.id === form.to);
  const amountMinor = from ? parseAmount(form.amount, from.currency) : null;
  const crossCurrency = !!from && !!to && from.currency !== to.currency;
  const toAmountMinor = to && crossCurrency ? parseAmount(form.toAmount, to.currency) : amountMinor;
  // The database fixes base amounts from a JOD leg when there is one; otherwise the source leg needs a rate.
  const needsFx = !!from && !!to && from.currency !== 'JOD' && to.currency !== 'JOD';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!from || !to || from.id === to.id) return setError(L.t('sme.money.transfer.sameAccount'));
    if (!amountMinor || amountMinor <= 0n || (crossCurrency && (!toAmountMinor || toAmountMinor <= 0n))) return setError(L.t('sme.money.form.invalidAmount'));
    if (needsFx && !fx) return setError(L.t('sme.fx.required'));
    setBusy(true);
    const r = await smeApi('transfers', {
      orgId, method: 'POST', idempotencyKey: idem.current(),
      body: {
        from_account_id: from.id, to_account_id: to.id, amount_minor: amountMinor.toString(),
        to_amount_minor: crossCurrency ? toAmountMinor?.toString() : undefined,
        value_date: form.date, description: form.description.trim() || undefined, fx: needsFx ? fx : undefined,
      },
    });
    setBusy(false);
    if (!r.ok) return setError(errorText(r.error, L.intl.locale));
    idem.rotate();
    onDone();
  };

  const accountOptions = accounts.map(a => <option key={a.id} value={a.id}>{`${L.localName(a.name, a.nameAr)} (${a.currency})`}</option>);
  return (
    <form onSubmit={submit} style={{ ...card, display: 'flex', flexDirection: 'column', gap: '12px' }} aria-labelledby="transfer-title">
      <div>
        <h2 id="transfer-title" style={{ margin: '0 0 4px', fontSize: '16px', fontWeight: 600, color: 'var(--ds-text-heading)' }}>{L.t('sme.money.transfer.title')}</h2>
        <p style={muted}>{L.t('sme.money.transfer.help')}</p>
      </div>
      <div style={formGrid}>
        <Field text={L.t('sme.money.transfer.from')}><select value={form.from} onChange={e => setForm({ ...form, from: e.target.value })} style={input}>{accountOptions}</select></Field>
        <Field text={L.t('sme.money.transfer.to')}><select value={form.to} onChange={e => setForm({ ...form, to: e.target.value })} style={input}>{accountOptions}</select></Field>
        <Field text={L.t('sme.money.form.amountIn', { currency: from?.currency ?? '' })}>
          <input value={form.amount} inputMode="decimal" dir="ltr" onChange={e => setForm({ ...form, amount: e.target.value })} style={input} />
        </Field>
        {crossCurrency && (
          <Field text={L.t('sme.money.transfer.received', { currency: to?.currency ?? '' })}>
            <input value={form.toAmount} inputMode="decimal" dir="ltr" onChange={e => setForm({ ...form, toAmount: e.target.value })} style={input} />
          </Field>
        )}
        <Field text={L.t('sme.money.form.date')}><input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} style={input} /></Field>
        <Field text={L.t('sme.money.form.description')}><input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} style={input} /></Field>
      </div>
      {needsFx && from && <FxFields orgId={orgId} currency={from.currency} date={form.date} amountMinor={amountMinor} onChange={setFx} />}
      <FormError message={error} />
      <div style={{ display: 'flex', gap: '8px' }}>
        <button type="submit" style={primaryButton} disabled={busy}>{L.t('sme.money.transfer.submit')}</button>
        <button type="button" style={secondaryButton} onClick={onCancel}>{L.t('sme.money.form.cancel')}</button>
      </div>
    </form>
  );
}
