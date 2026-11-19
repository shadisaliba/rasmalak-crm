'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import { useOrg, useOrgPermission } from '@/store/orgStore';
import { smeApi, errorText, type SmeApiError } from '@/sme/api/client';
import { DataState } from '@/sme/ui/DataState';
import { SmeGate } from '@/sme/profile/ui/SmeGate';
import { CHANNELS } from '../api/schemas';
import { todayInAmman } from '../domain/dates';
import type { AccountSummary, TransactionRow } from '../types';
import { FxFields, type FxValue } from './FxFields';
import {
  CATEGORY_KIND_ORDER, Chip, FX_SOURCE_LABEL_KEYS, Field, FormError, allowedCategories, card, formGrid, input, muted,
  parseAmount, primaryButton, secondaryButton, useIdempotencyKey, useLedgerReferenceData, useLedgerText,
  type CategoryOption, type CounterpartyOption,
} from './shared';

interface Filters { account: string; from: string; to: string; category: string; channel: string; q: string }
type Load =
  | { status: 'loading' }
  | { status: 'failed'; error: SmeApiError }
  | { status: 'ready'; items: TransactionRow[]; next: string | null; loadingMore?: boolean };

const EMPTY_FILTERS: Filters = { account: '', from: '', to: '', category: '', channel: '', q: '' };

function queryString(filters: Filters, cursor?: string | null): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
  if (cursor) params.set('cursor', cursor);
  params.set('limit', '50');
  return params.toString();
}

export function TransactionsPage() {
  const L = useLedgerText();
  const search = useSearchParams();
  const { currentOrg } = useOrg();
  const canPost = useOrgPermission('sme.ledger.post');
  const canImport = useOrgPermission('sme.imports.execute');
  const [filters, setFilters] = useState<Filters>({ ...EMPTY_FILTERS, account: search.get('account') ?? '' });
  const [applied, setApplied] = useState<Filters>(filters);
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const refs = useLedgerReferenceData(currentOrg?.id);
  const reload = () => setReloadKey(k => k + 1);

  useEffect(() => {
    if (!currentOrg) return;
    let ignore = false;
    smeApi<{ items: AccountSummary[] }>('accounts', { orgId: currentOrg.id }).then(r => { if (!ignore && r.ok) setAccounts(r.data.items); });
    return () => { ignore = true; };
  }, [currentOrg, reloadKey]);

  useEffect(() => {
    if (!currentOrg) return;
    let ignore = false;
    smeApi<{ items: TransactionRow[]; next_cursor: string | null }>(`transactions?${queryString(applied)}`, { orgId: currentOrg.id }).then(r => {
      if (!ignore) setLoad(r.ok ? { status: 'ready', items: r.data.items, next: r.data.next_cursor } : { status: 'failed', error: r.error });
    });
    return () => { ignore = true; };
  }, [currentOrg, applied, reloadKey]);

  const loadMore = async () => {
    if (!currentOrg || load.status !== 'ready' || !load.next) return;
    setLoad({ ...load, loadingMore: true });
    const r = await smeApi<{ items: TransactionRow[]; next_cursor: string | null }>(`transactions?${queryString(applied, load.next)}`, { orgId: currentOrg.id });
    setLoad(r.ok ? { status: 'ready', items: [...load.items, ...r.data.items], next: r.data.next_cursor } : { status: 'failed', error: r.error });
  };

  const filtered = Object.values(applied).some(Boolean);
  const uncategorised = load.status === 'ready' ? load.items.filter(t => !t.classification.category_id && !t.is_reversal).length : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: '1100px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 600, color: 'var(--ds-text-heading)', margin: '0 0 4px' }}>{L.t('sme.money.tx.title')}</h1>
          <p style={{ fontSize: '13px', color: 'var(--ds-text-muted)', margin: 0 }}>{L.t('sme.money.tx.description')}</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {canImport && accounts.some(a => a.status === 'active') && (
            <Link href={`/crm/money/transactions/import${applied.account ? `?account=${applied.account}` : ''}`} style={{ ...secondaryButton, textDecoration: 'none' }}>
              {L.t('sme.money.tx.import')}
            </Link>
          )}
          {canPost && accounts.some(a => a.status === 'active') && (
            <button type="button" style={primaryButton} onClick={() => setAdding(!adding)}>{L.t('sme.money.tx.add')}</button>
          )}
        </div>
      </div>

      <SmeGate permission="sme.ledger.read">
        {currentOrg && adding && (
          <TransactionForm orgId={currentOrg.id} accounts={accounts.filter(a => a.status === 'active')} categories={refs.categories} defaultAccount={applied.account}
            onDone={duplicate => { setAdding(false); setNotice(duplicate ? L.t('sme.money.tx.possibleDuplicate') : null); reload(); }} onCancel={() => setAdding(false)} />
        )}
        {notice && <div role="status" style={{ ...card, padding: '10px 14px', fontSize: '13px', background: 'var(--ds-warning-bg)', color: 'var(--ds-warning-text)', borderColor: 'var(--ds-warning-border)' }}>{notice}</div>}

        <form onSubmit={e => { e.preventDefault(); setApplied(filters); }} style={{ ...card, display: 'flex', flexDirection: 'column', gap: '10px' }} aria-label={L.t('sme.money.tx.filters')}>
          <div style={formGrid}>
            <Field text={L.t('sme.money.tx.account')}>
              <select value={filters.account} onChange={e => setFilters({ ...filters, account: e.target.value })} style={input}>
                <option value="">{L.t('sme.money.tx.allAccounts')}</option>
                {accounts.map(a => <option key={a.id} value={a.id}>{L.localName(a.name, a.nameAr)}</option>)}
              </select>
            </Field>
            <Field text={L.t('sme.money.tx.fromDate')}><input type="date" value={filters.from} onChange={e => setFilters({ ...filters, from: e.target.value })} style={input} /></Field>
            <Field text={L.t('sme.money.tx.toDate')}><input type="date" value={filters.to} onChange={e => setFilters({ ...filters, to: e.target.value })} style={input} /></Field>
            <Field text={L.t('sme.money.tx.category')}>
              <CategorySelect categories={refs.categories} value={filters.category} onChange={v => setFilters({ ...filters, category: v })} emptyLabel={L.t('sme.money.tx.allCategories')} />
            </Field>
            <Field text={L.t('sme.money.tx.channel')}>
              <select value={filters.channel} onChange={e => setFilters({ ...filters, channel: e.target.value })} style={input}>
                <option value="">{L.t('sme.money.tx.allChannels')}</option>
                {CHANNELS.map(c => <option key={c} value={c}>{L.t(`sme.channel.${c}`)}</option>)}
              </select>
            </Field>
            <Field text={L.t('sme.money.tx.search')}><input type="search" value={filters.q} onChange={e => setFilters({ ...filters, q: e.target.value })} style={input} /></Field>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="submit" style={primaryButton}>{L.t('sme.money.tx.apply')}</button>
            {filtered && <button type="button" style={secondaryButton} onClick={() => { setFilters(EMPTY_FILTERS); setApplied(EMPTY_FILTERS); }}>{L.t('sme.money.tx.clear')}</button>}
          </div>
        </form>

        {load.status === 'loading' ? (
          <DataState state="loading" />
        ) : load.status === 'failed' ? (
          <DataState state="failed" message={errorText(load.error, L.intl.locale)} onRetry={reload} />
        ) : load.items.length === 0 ? (
          <DataState state="empty" message={L.t(filtered ? 'sme.money.tx.emptyFiltered' : 'sme.money.tx.empty')} />
        ) : (
          <DataState state={uncategorised ? 'partial' : 'validated'} message={uncategorised ? L.t('sme.money.tx.partial', { count: uncategorised }) : undefined}>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {load.items.map(row => (
                <TransactionItem key={row.id} row={row} orgId={currentOrg?.id ?? ''} categories={refs.categories} counterparties={refs.counterparties} onChanged={reload} />
              ))}
            </ul>
            {load.next && (
              <button type="button" style={{ ...secondaryButton, alignSelf: 'center' }} disabled={load.loadingMore} onClick={loadMore}>{L.t('sme.money.tx.loadMore')}</button>
            )}
          </DataState>
        )}
      </SmeGate>
    </div>
  );
}

// ── Category select ──────────────────────────────────────────

function CategorySelect({ categories, value, onChange, emptyLabel, label }: { categories: CategoryOption[]; value: string; onChange: (v: string) => void; emptyLabel: string; label?: string }) {
  const L = useLedgerText();
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={input} aria-label={label}>
      <option value="">{emptyLabel}</option>
      {CATEGORY_KIND_ORDER.map(kind => {
        const group = categories.filter(c => c.kind === kind);
        if (!group.length) return null;
        return (
          <optgroup key={kind} label={L.t(`sme.categoryKind.${kind}`)}>
            {group.map(c => <option key={c.id} value={c.id}>{L.localName(c.nameEn, c.nameAr)}</option>)}
          </optgroup>
        );
      })}
    </select>
  );
}

// ── Manual entry ─────────────────────────────────────────────

function TransactionForm({ orgId, accounts, categories, defaultAccount, onDone, onCancel }: {
  orgId: string; accounts: AccountSummary[]; categories: CategoryOption[]; defaultAccount: string;
  onDone: (possibleDuplicate: boolean) => void; onCancel: () => void;
}) {
  const L = useLedgerText();
  const idem = useIdempotencyKey();
  const [form, setForm] = useState({
    account: accounts.some(a => a.id === defaultAccount) ? defaultAccount : accounts[0]?.id ?? '',
    direction: 'out' as 'in' | 'out', amount: '', date: todayInAmman(), description: '', reference: '', category: '', channel: 'unknown',
  });
  const [fx, setFx] = useState<FxValue | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const account = accounts.find(a => a.id === form.account);
  const magnitude = account ? parseAmount(form.amount, account.currency) : null;
  const amountMinor = magnitude === null ? null : form.direction === 'out' ? -magnitude : magnitude;
  const needsFx = !!account && account.currency !== 'JOD';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!account) return;
    if (!magnitude || magnitude <= 0n) return setError(L.t('sme.money.form.invalidAmount'));
    if (needsFx && !fx) return setError(L.t('sme.fx.required'));
    setBusy(true);
    const r = await smeApi<{ transaction_id: string; possible_duplicate: boolean }>('transactions', {
      orgId, method: 'POST', idempotencyKey: idem.current(),
      body: {
        account_id: account.id, value_date: form.date, amount_minor: amountMinor!.toString(), currency: account.currency,
        description: form.description.trim() || undefined, external_ref: form.reference.trim() || undefined,
        fx: needsFx ? fx : undefined,
        classification: { category_id: form.category || null, channel: form.channel },
      },
    });
    setBusy(false);
    if (!r.ok) return setError(errorText(r.error, L.intl.locale));
    idem.rotate();
    onDone(r.data.possible_duplicate);
  };

  return (
    <form onSubmit={submit} style={{ ...card, display: 'flex', flexDirection: 'column', gap: '12px' }} aria-labelledby="add-tx-title">
      <h2 id="add-tx-title" style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--ds-text-heading)' }}>{L.t('sme.money.tx.add')}</h2>
      <div style={formGrid}>
        <Field text={L.t('sme.money.tx.account')}>
          <select value={form.account} onChange={e => setForm({ ...form, account: e.target.value })} style={input}>
            {accounts.map(a => <option key={a.id} value={a.id}>{`${L.localName(a.name, a.nameAr)} (${a.currency})`}</option>)}
          </select>
        </Field>
        <Field text={L.t('sme.money.tx.direction')}>
          <select value={form.direction} onChange={e => setForm({ ...form, direction: e.target.value as 'in' | 'out' })} style={input}>
            <option value="in">{L.t('sme.money.tx.moneyIn')}</option>
            <option value="out">{L.t('sme.money.tx.moneyOut')}</option>
          </select>
        </Field>
        <Field text={L.t('sme.money.form.amountIn', { currency: account?.currency ?? '' })}>
          <input value={form.amount} inputMode="decimal" dir="ltr" onChange={e => setForm({ ...form, amount: e.target.value })} style={input} />
        </Field>
        <Field text={L.t('sme.money.form.date')}><input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} style={input} /></Field>
        <Field text={L.t('sme.money.form.description')}><input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} style={input} /></Field>
        <Field text={L.t('sme.money.form.reference')}><input value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} style={input} /></Field>
        <Field text={L.t('sme.money.tx.category')}>
          <CategorySelect categories={allowedCategories(categories, 'manual')} value={form.category} onChange={v => setForm({ ...form, category: v })} emptyLabel={L.t('sme.money.tx.uncategorised')} />
        </Field>
        <Field text={L.t('sme.money.tx.channel')}>
          <select value={form.channel} onChange={e => setForm({ ...form, channel: e.target.value })} style={input}>
            {CHANNELS.map(c => <option key={c} value={c}>{L.t(`sme.channel.${c}`)}</option>)}
          </select>
        </Field>
      </div>
      {needsFx && account && <FxFields orgId={orgId} currency={account.currency} date={form.date} amountMinor={amountMinor} onChange={setFx} />}
      <FormError message={error} />
      <div style={{ display: 'flex', gap: '8px' }}>
        <button type="submit" style={primaryButton} disabled={busy}>{L.t('sme.money.tx.post')}</button>
        <button type="button" style={secondaryButton} onClick={onCancel}>{L.t('sme.money.form.cancel')}</button>
      </div>
    </form>
  );
}

// ── One transaction ──────────────────────────────────────────

function TransactionItem({ row, orgId, categories, counterparties, onChanged }: {
  row: TransactionRow; orgId: string; categories: CategoryOption[]; counterparties: CounterpartyOption[]; onChanged: () => void;
}) {
  const L = useLedgerText();
  const canPost = useOrgPermission('sme.ledger.post');
  const canReverse = useOrgPermission('sme.ledger.reverse');
  const [open, setOpen] = useState<'none' | 'classify' | 'reverse' | 'details'>('none');
  const toggle = (panel: typeof open) => setOpen(open === panel ? 'none' : panel);
  const inflow = BigInt(row.amount_minor) > 0n;
  const c = row.classification;
  const categoryName = c.category_id ? L.localName(c.category_name_en, c.category_name_ar) : L.t('sme.money.tx.uncategorised');

  return (
    <li id={`tx-${row.id}`} style={{ ...card, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px', scrollMarginTop: '80px' }} data-testid="transaction">
      <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <span style={{ ...muted, minWidth: '84px', paddingTop: '2px' }}>{L.date(row.value_date)}</span>
        <div style={{ flex: '1 1 220px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ fontSize: '14px', color: 'var(--ds-text-heading)', textDecoration: row.is_reversed ? 'line-through' : 'none', overflowWrap: 'anywhere' }}>
            {row.description || (row.source_kind === 'manual' ? L.t('sme.money.tx.noDescription') : L.t(`sme.sourceKind.${row.source_kind}`))}
          </span>
          <span style={muted}>{[L.localName(row.account_name, row.account_name_ar), categoryName, L.t(`sme.channel.${c.channel}`)].join(' · ')}</span>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {row.source_kind !== 'manual' && <Chip tone="info">{L.t(`sme.sourceKind.${row.source_kind}`)}</Chip>}
            {row.is_estimate && <Chip tone="warning">{L.t('sme.money.tx.estimate')}</Chip>}
            {row.is_reversed && row.reversal_id && (
              <a href={`#tx-${row.reversal_id}`} style={{ fontSize: '12px', color: 'var(--ds-primary)' }}>{L.t('sme.money.tx.reversedLink')}</a>
            )}
            {row.is_reversal && row.reversal_of && (
              <a href={`#tx-${row.reversal_of}`} style={{ fontSize: '12px', color: 'var(--ds-primary)' }}>{L.t('sme.money.tx.reversalOfLink')}</a>
            )}
          </div>
          {row.is_reversal && row.reason && <span style={muted}>{L.t('sme.money.tx.reversalReason', { reason: row.reason })}</span>}
        </div>
        <span data-testid="amount" style={{ fontSize: '15px', fontWeight: 600, whiteSpace: 'nowrap', textDecoration: row.is_reversed ? 'line-through' : 'none', color: inflow ? 'var(--ds-success-text)' : 'var(--ds-text-heading)' }}>
          {L.amount(row.amount_minor, row.currency, { signDisplay: 'always' })}
        </span>
      </div>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {canPost && <button type="button" style={secondaryButton} aria-expanded={open === 'classify'} onClick={() => toggle('classify')}>{L.t('sme.money.tx.classify')}</button>}
        {canReverse && !row.is_reversed && !row.is_reversal && (
          <button type="button" style={secondaryButton} aria-expanded={open === 'reverse'} onClick={() => toggle('reverse')}>{L.t('sme.money.tx.reverse')}</button>
        )}
        <button type="button" style={secondaryButton} aria-expanded={open === 'details'} onClick={() => toggle('details')}>{L.t('sme.money.tx.details')}</button>
      </div>
      {open === 'classify' && <ClassifyPanel row={row} orgId={orgId} categories={categories} counterparties={counterparties} onDone={() => { setOpen('none'); onChanged(); }} />}
      {open === 'reverse' && <ReversePanel row={row} orgId={orgId} onDone={() => { setOpen('none'); onChanged(); }} />}
      {open === 'details' && <ProvenancePanel row={row} counterparties={counterparties} />}
    </li>
  );
}

function ClassifyPanel({ row, orgId, categories, counterparties, onDone }: {
  row: TransactionRow; orgId: string; categories: CategoryOption[]; counterparties: CounterpartyOption[]; onDone: () => void;
}) {
  const L = useLedgerText();
  const idem = useIdempotencyKey();
  const c = row.classification;
  // A reversal takes its original's rules; its category shows which kind the original was.
  const currentKind = categories.find(x => x.id === c.category_id)?.kind;
  const ruleKind = row.is_reversal ? (currentKind === 'transfer' || currentKind === 'opening_balance' ? currentKind : 'manual') : row.source_kind;
  const [category, setCategory] = useState(c.category_id ?? '');
  const [channel, setChannel] = useState(c.channel);
  const [counterparty, setCounterparty] = useState(c.counterparty_company_id ? `company:${c.counterparty_company_id}` : c.counterparty_contact_id ? `contact:${c.counterparty_contact_id}` : '');
  const [note, setNote] = useState(c.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    const [kind, id] = counterparty ? counterparty.split(':') : [null, null];
    const r = await smeApi(`transactions/${row.id}/classifications`, {
      orgId, method: 'POST', idempotencyKey: idem.current(),
      body: {
        category_id: category || null, channel,
        counterparty_company_id: kind === 'company' ? id : null, counterparty_contact_id: kind === 'contact' ? id : null,
        note: note.trim() || undefined,
      },
    });
    setBusy(false);
    if (!r.ok) return setError(errorText(r.error, L.intl.locale));
    idem.rotate();
    onDone();
  };

  return (
    <div style={{ borderTop: '1px solid var(--ds-border)', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <p style={muted}>{L.t('sme.money.tx.classifyHelp')}</p>
      <div style={formGrid}>
        <Field text={L.t('sme.money.tx.category')}>
          <CategorySelect categories={allowedCategories(categories, ruleKind)} value={category} onChange={setCategory} emptyLabel={L.t('sme.money.tx.uncategorised')} />
        </Field>
        <Field text={L.t('sme.money.tx.channel')}>
          <select value={channel} onChange={e => setChannel(e.target.value)} style={input}>
            {CHANNELS.map(ch => <option key={ch} value={ch}>{L.t(`sme.channel.${ch}`)}</option>)}
          </select>
        </Field>
        <Field text={L.t('sme.money.tx.counterparty')}>
          <select value={counterparty} onChange={e => setCounterparty(e.target.value)} style={input}>
            <option value="">{L.t('sme.money.tx.noCounterparty')}</option>
            {(['company', 'contact'] as const).map(kind => (
              <optgroup key={kind} label={L.t(`sme.money.tx.counterparty.${kind}`)}>
                {counterparties.filter(p => p.kind === kind).map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </optgroup>
            ))}
          </select>
        </Field>
        <Field text={L.t('sme.money.tx.note')}><input value={note} onChange={e => setNote(e.target.value)} style={input} /></Field>
      </div>
      <FormError message={error} />
      <button type="button" style={{ ...primaryButton, alignSelf: 'flex-start' }} disabled={busy} onClick={save}>{L.t('sme.money.tx.saveClassification')}</button>
    </div>
  );
}

function ReversePanel({ row, orgId, onDone }: { row: TransactionRow; orgId: string; onDone: () => void }) {
  const L = useLedgerText();
  const idem = useIdempotencyKey();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!reason.trim()) return setError(L.t('sme.money.tx.reasonRequired'));
    setBusy(true);
    setError(null);
    const r = await smeApi(`transactions/${row.id}/reverse`, { orgId, method: 'POST', idempotencyKey: idem.current(), body: { reason: reason.trim() } });
    setBusy(false);
    if (!r.ok) return setError(errorText(r.error, L.intl.locale));
    idem.rotate();
    onDone();
  };

  return (
    <div style={{ borderTop: '1px solid var(--ds-border)', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <p style={{ margin: 0, fontSize: '13px', color: 'var(--ds-text-body)' }}>
        {L.t(row.transfer_group_id ? 'sme.money.tx.reverseTransferHelp' : 'sme.money.tx.reverseHelp')}
      </p>
      <Field text={L.t('sme.money.tx.reason')}>
        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} maxLength={500} style={{ ...input, resize: 'vertical' }} />
      </Field>
      <FormError message={error} />
      <button type="button" style={{ ...primaryButton, alignSelf: 'flex-start' }} disabled={busy} onClick={submit}>{L.t('sme.money.tx.confirmReverse')}</button>
    </div>
  );
}

function ProvenancePanel({ row, counterparties }: { row: TransactionRow; counterparties: CounterpartyOption[] }) {
  const L = useLedgerText();
  const { orgMembers } = useOrg();
  const me = useAuthStore(s => s.user?.id);
  const who = (userId: string | null) => {
    if (!userId) return '';
    if (userId === me) return L.t('sme.money.tx.you');
    const m = orgMembers.find(x => x.userId === userId);
    return (m && L.localName(m.displayName, m.displayNameAr)) || L.t('sme.money.tx.teamMember');
  };
  const c = row.classification;
  const counterparty = useMemo(() => {
    const value = c.counterparty_company_id ? `company:${c.counterparty_company_id}` : c.counterparty_contact_id ? `contact:${c.counterparty_contact_id}` : null;
    return value ? counterparties.find(p => p.value === value)?.label ?? '' : '';
  }, [c.counterparty_company_id, c.counterparty_contact_id, counterparties]);

  const items: Array<[string, string]> = [
    [L.t('sme.money.tx.prov.source'), L.t(`sme.sourceKind.${row.source_kind}`)],
    ...(row.import_batch_id ? [[L.t('sme.money.tx.prov.importFile'), L.t('sme.money.tx.prov.importFileValue', { file: row.import_file_name ?? row.import_batch_id, row: row.import_row_number ?? '' })] as [string, string]] : []),
    [L.t('sme.money.tx.prov.postedBy'), who(row.created_by)],
    [L.t('sme.money.tx.prov.postedAt'), L.dateTime(row.created_at)],
    ...(row.external_ref ? [[L.t('sme.money.form.reference'), row.external_ref] as [string, string]] : []),
    ...(row.fx_rate ? [
      [L.t('sme.money.tx.prov.rate'), L.t('sme.money.tx.prov.rateValue', { one: 1, currency: row.currency, rate: L.decimal(row.fx_rate), date: L.date(row.fx_rate_date) })] as [string, string],
      [L.t('sme.money.tx.prov.rateSource'), L.t(FX_SOURCE_LABEL_KEYS[row.fx_source ?? ''] ?? 'sme.fx.source.manual')] as [string, string],
      [L.t('sme.money.tx.prov.base'), L.amount(row.base_amount_minor, 'JOD')] as [string, string],
    ] : []),
    ...(counterparty ? [[L.t('sme.money.tx.counterparty'), counterparty] as [string, string]] : []),
    ...(c.note ? [[L.t('sme.money.tx.note'), c.note] as [string, string]] : []),
    ...(c.classified_at ? [[L.t('sme.money.tx.prov.classified'), L.t('sme.money.tx.prov.classifiedValue', { who: who(c.classified_by), when: L.dateTime(c.classified_at) })] as [string, string]] : []),
  ];

  return (
    <dl style={{ borderTop: '1px solid var(--ds-border)', paddingTop: '10px', margin: 0, display: 'grid', gridTemplateColumns: 'minmax(110px, max-content) 1fr', gap: '6px 14px', fontSize: '13px' }}>
      {items.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt style={{ color: 'var(--ds-text-muted)' }}>{k}</dt>
          <dd style={{ margin: 0, color: 'var(--ds-text-body)', overflowWrap: 'anywhere' }}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
