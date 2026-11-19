'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { useOrg } from '@/store/orgStore';
import { smeApi, errorText, type SmeApiError } from '@/sme/api/client';
import { DataState } from '@/sme/ui/DataState';
import { SmeGate } from '@/sme/profile/ui/SmeGate';
import { isCurrencyCode } from '@/sme/money';
import { todayInAmman } from '@/sme/ledger/domain/dates';
import type { AccountSummary } from '@/sme/ledger/types';
import { Field, FormError, card, formGrid, input, muted, primaryButton, secondaryButton, useIdempotencyKey, useLedgerText } from '@/sme/ledger/ui/shared';
import { guessMapping } from '../domain/columns';
import { suggestDateFormat } from '../domain/dates';
import { fileKindOf, isFailure, tableFromFile, type FileTable } from '../domain/file';
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_ROWS } from '../domain/limits';
import { buildStagedRows } from '../domain/statement';
import { DATE_FORMATS, type AmountMode, type ColumnMapping, type DateFormat, type DecimalSeparator, type FileKind, type ParseOptions, type StagedRow, type TextEncodingName } from '../domain/types';

const PREVIEW_ROWS = 8;
const NONE = '';

interface Loaded { file: File; bytes: Uint8Array; sha256: string; kind: FileKind; table: FileTable }
interface Form {
  headerRow: number; date: string; description: string; description2: string; amountMode: AmountMode;
  amount: string; debit: string; credit: string; reference: string; dateFormat: DateFormat; decimal: DecimalSeparator;
  encoding: TextEncodingName; delimiter: ',' | ';' | '\t'; sheet: string; encodingConfirmed: boolean;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const col = (v: string) => (v === NONE ? undefined : Number(v));

function formFor(table: FileTable, headerRow: number, previous?: Form): Form {
  const header = (table.table[headerRow] ?? []).map(c => String(c ?? ''));
  const { mapping, amountMode } = guessMapping(header);
  const dateSamples = table.table.slice(headerRow + 1, headerRow + 21).map(r => (mapping.date === undefined ? null : r[mapping.date] ?? null));
  const s = (v: number | undefined) => (v === undefined ? NONE : String(v));
  return {
    headerRow,
    date: s(mapping.date), description: s(mapping.description?.[0]), description2: NONE, amountMode,
    amount: s(mapping.amount), debit: s(mapping.debit), credit: s(mapping.credit), reference: s(mapping.reference),
    dateFormat: suggestDateFormat(dateSamples)?.format ?? 'dd/mm/yyyy', decimal: previous?.decimal ?? '.',
    encoding: table.encoding?.used ?? 'utf-8', delimiter: table.delimiter ?? ',', sheet: table.sheet ?? '',
    encodingConfirmed: previous?.encodingConfirmed ?? false,
  };
}

export function ImportStartPage() {
  const L = useLedgerText();
  const router = useRouter();
  const search = useSearchParams();
  const { currentOrg } = useOrg();
  const [accounts, setAccounts] = useState<AccountSummary[] | null>(null);
  const [accountId, setAccountId] = useState(search.get('account') ?? '');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<SmeApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const createKey = useIdempotencyKey();
  const parseKey = useIdempotencyKey();

  useEffect(() => {
    if (!currentOrg) return;
    let ignore = false;
    smeApi<{ items: AccountSummary[] }>('accounts', { orgId: currentOrg.id }).then(r => {
      if (ignore) return;
      const active = r.ok ? r.data.items.filter(a => a.status === 'active') : [];
      setAccounts(active);
      setAccountId(id => (active.some(a => a.id === id) ? id : active[0]?.id ?? ''));
    });
    return () => { ignore = true; };
  }, [currentOrg]);

  const account = accounts?.find(a => a.id === accountId);

  const onFile = async (file: File | undefined) => {
    setError(null);
    setDuplicate(null);
    setLoaded(null);
    setForm(null);
    if (!file) return;
    const kind = fileKindOf(file.name);
    if (!kind) return setError(L.t('sme.import.error.fileType'));
    if (file.size > DEFAULT_MAX_BYTES) return setError(L.t('sme.import.error.fileSize', { mb: DEFAULT_MAX_BYTES / 1024 / 1024 }));
    const bytes = new Uint8Array(await file.arrayBuffer());
    const table = await tableFromFile(bytes, kind, {}, DEFAULT_MAX_ROWS);
    if (isFailure(table)) return setError(L.t(`sme.import.failure.${table.reason}`));
    setLoaded({ file, bytes, sha256: await sha256Hex(bytes), kind, table });
    setForm(formFor(table, 0));
    createKey.rotate();
    parseKey.rotate();
  };

  // Changing how the file is read (encoding, delimiter, sheet) re-reads it and re-guesses columns.
  const reread = async (options: Partial<ParseOptions>) => {
    if (!loaded || !form) return;
    const table = await tableFromFile(loaded.bytes, loaded.kind, options, DEFAULT_MAX_ROWS);
    if (isFailure(table)) return setError(L.t(`sme.import.failure.${table.reason}`));
    setError(null);
    setLoaded({ ...loaded, table });
    setForm({ ...formFor(table, form.headerRow, form), encodingConfirmed: false });
  };

  const mapping: ColumnMapping | null = form && form.date !== NONE && form.description !== NONE ? {
    header_row: form.headerRow, date: Number(form.date),
    description: [Number(form.description), ...(form.description2 === NONE ? [] : [Number(form.description2)])],
    amount: form.amountMode === 'signed' ? col(form.amount) : undefined,
    debit: form.amountMode === 'debit_credit' ? col(form.debit) : undefined,
    credit: form.amountMode === 'debit_credit' ? col(form.credit) : undefined,
    reference: col(form.reference),
  } : null;
  const options: ParseOptions | null = form && loaded ? {
    date_format: form.dateFormat, amount_mode: form.amountMode, decimal_separator: form.decimal,
    ...(loaded.kind === 'csv' ? { encoding: form.encoding, delimiter: form.delimiter } : { sheet: form.sheet }),
  } : null;

  const preview: StagedRow[] | null = (() => {
    if (!loaded || !mapping || !options || !account || !isCurrencyCode(account.currency)) return null;
    const slice = loaded.table.table.slice(0, mapping.header_row + 1 + PREVIEW_ROWS);
    const result = buildStagedRows(slice, loaded.table.firstRowNumber, mapping, options, { currency: account.currency, today: todayInAmman(), maxRows: DEFAULT_MAX_ROWS });
    return isFailure(result) ? null : result.rows;
  })();

  const amountReady = form ? (form.amountMode === 'signed' ? form.amount !== NONE : form.debit !== NONE && form.credit !== NONE) : false;
  const encodingOk = !loaded || loaded.kind !== 'csv' || loaded.table.encoding?.certain || form?.encodingConfirmed;
  const ready = !!account && !!loaded && !!mapping && amountReady && !!encodingOk && !busy;

  const submit = async (discardFirst?: string) => {
    if (!currentOrg || !account || !loaded || !mapping || !options) return;
    setBusy(true);
    setError(null);
    setDuplicate(null);
    if (discardFirst) {
      await smeApi(`import-batches/${discardFirst}/cancel`, { orgId: currentOrg.id, method: 'POST' });
      createKey.rotate();
    }
    const created = await smeApi<{ batch_id: string; mime_type: string; upload: { path: string; token: string } }>('import-batches', {
      orgId: currentOrg.id, method: 'POST', idempotencyKey: createKey.current(),
      body: { account_id: account.id, file_name: loaded.file.name, byte_size: loaded.file.size, sha256: loaded.sha256, mime_type: loaded.file.type },
    });
    if (!created.ok) {
      setBusy(false);
      if (created.error.code === 'DUPLICATE_IMPORT') return setDuplicate(created.error);
      return setError(errorText(created.error, L.intl.locale));
    }
    const { batch_id: batchId, upload, mime_type: mimeType } = created.data;
    const uploaded = await supabase.storage.from('sme-imports').uploadToSignedUrl(upload.path, upload.token, loaded.file, { contentType: mimeType });
    if (uploaded.error) {
      setBusy(false);
      return setError(L.t('sme.import.error.upload'));
    }
    const parsed = await smeApi(`import-batches/${batchId}/parse`, {
      orgId: currentOrg.id, method: 'POST', idempotencyKey: parseKey.current(), body: { column_mapping: mapping, parse_options: options },
    });
    setBusy(false);
    if (!parsed.ok) return setError(errorText(parsed.error, L.intl.locale));
    createKey.rotate();
    parseKey.rotate();
    router.push(`/crm/money/transactions/import/${batchId}`);
  };

  const header = loaded && form ? (loaded.table.table[form.headerRow] ?? []).map((c, i) => String(c ?? '').trim() || L.t('sme.import.column', { n: i + 1 })) : [];
  const columnSelect = (value: string, onChange: (v: string) => void, optional: boolean, label: string) => (
    <Field text={label}>
      <select value={value} onChange={e => onChange(e.target.value)} style={input}>
        <option value={NONE}>{optional ? L.t('sme.import.noColumn') : L.t('sme.import.chooseColumn')}</option>
        {header.map((h, i) => <option key={i} value={String(i)}>{h}</option>)}
      </select>
    </Field>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: '1000px' }}>
      <div>
        <Link href="/crm/money/transactions" style={{ fontSize: '13px', color: 'var(--ds-primary)' }}>{L.t('sme.import.back')}</Link>
        <h1 style={{ fontSize: '24px', fontWeight: 600, color: 'var(--ds-text-heading)', margin: '6px 0 4px' }}>{L.t('sme.import.title')}</h1>
        <p style={{ fontSize: '13px', color: 'var(--ds-text-muted)', margin: 0 }}>{L.t('sme.import.description')}</p>
      </div>
      <SmeGate permission="sme.imports.execute">
        {accounts === null ? <DataState state="loading" /> : accounts.length === 0 ? (
          <DataState state="empty" message={L.t('sme.import.noAccounts')} action={<Link href="/crm/money/accounts" style={{ color: 'var(--ds-primary)', fontSize: '13px' }}>{L.t('sme.money.accounts.add')}</Link>} />
        ) : (
          <>
            <section style={{ ...card, display: 'flex', flexDirection: 'column', gap: '12px' }} aria-labelledby="import-file">
              <h2 id="import-file" style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--ds-text-heading)' }}>{L.t('sme.import.step.file')}</h2>
              <div style={formGrid}>
                <Field text={L.t('sme.money.tx.account')}>
                  <select value={accountId} onChange={e => setAccountId(e.target.value)} style={input}>
                    {accounts.map(a => <option key={a.id} value={a.id}>{`${L.localName(a.name, a.nameAr)} (${a.currency})`}</option>)}
                  </select>
                </Field>
                <Field text={L.t('sme.import.file')}>
                  <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={e => onFile(e.target.files?.[0])} style={{ ...input, padding: '6px' }} />
                </Field>
              </div>
              <p style={muted}>{L.t('sme.import.fileHelp', { mb: DEFAULT_MAX_BYTES / 1024 / 1024, rows: DEFAULT_MAX_ROWS })}</p>
            </section>

            {loaded && form && (
              <section style={{ ...card, display: 'flex', flexDirection: 'column', gap: '12px' }} aria-labelledby="import-columns">
                <h2 id="import-columns" style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--ds-text-heading)' }}>{L.t('sme.import.step.columns')}</h2>
                <p style={muted}>{L.t('sme.import.columnsHelp')}</p>
                <div style={formGrid}>
                  {loaded.kind === 'csv' ? (
                    <>
                      <Field text={L.t('sme.import.encoding')}>
                        <select value={form.encoding} onChange={e => reread({ encoding: e.target.value as TextEncodingName, delimiter: form.delimiter })} style={input}>
                          <option value="utf-8">{L.t('sme.import.encoding.utf8')}</option>
                          <option value="windows-1256">{L.t('sme.import.encoding.cp1256')}</option>
                        </select>
                      </Field>
                      <Field text={L.t('sme.import.delimiter')}>
                        <select value={form.delimiter} onChange={e => reread({ encoding: form.encoding, delimiter: e.target.value as Form['delimiter'] })} style={input}>
                          <option value=",">{L.t('sme.import.delimiter.comma')}</option>
                          <option value=";">{L.t('sme.import.delimiter.semicolon')}</option>
                          <option value={'\t'}>{L.t('sme.import.delimiter.tab')}</option>
                        </select>
                      </Field>
                    </>
                  ) : (
                    <Field text={L.t('sme.import.sheet')}>
                      <select value={form.sheet} onChange={e => reread({ sheet: e.target.value })} style={input}>
                        {(loaded.table.sheets ?? []).map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </Field>
                  )}
                  <Field text={L.t('sme.import.headerRow')}>
                    <select value={form.headerRow} onChange={e => setForm(formFor(loaded.table, Number(e.target.value), form))} style={input}>
                      {loaded.table.table.slice(0, 15).map((_, i) => <option key={i} value={i}>{L.t('sme.import.rowN', { n: loaded.table.firstRowNumber + i })}</option>)}
                    </select>
                  </Field>
                  {columnSelect(form.date, v => setForm({ ...form, date: v }), false, L.t('sme.import.map.date'))}
                  <Field text={L.t('sme.import.dateFormat')}>
                    <select value={form.dateFormat} onChange={e => setForm({ ...form, dateFormat: e.target.value as DateFormat })} style={input}>
                      {DATE_FORMATS.map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </Field>
                  {columnSelect(form.description, v => setForm({ ...form, description: v }), false, L.t('sme.import.map.description'))}
                  {columnSelect(form.description2, v => setForm({ ...form, description2: v }), true, L.t('sme.import.map.description2'))}
                  <Field text={L.t('sme.import.amountMode')}>
                    <select value={form.amountMode} onChange={e => setForm({ ...form, amountMode: e.target.value as AmountMode })} style={input}>
                      <option value="signed">{L.t('sme.import.amountMode.signed')}</option>
                      <option value="debit_credit">{L.t('sme.import.amountMode.debitCredit')}</option>
                    </select>
                  </Field>
                  {form.amountMode === 'signed'
                    ? columnSelect(form.amount, v => setForm({ ...form, amount: v }), false, L.t('sme.import.map.amount'))
                    : (
                      <>
                        {columnSelect(form.debit, v => setForm({ ...form, debit: v }), false, L.t('sme.import.map.debit'))}
                        {columnSelect(form.credit, v => setForm({ ...form, credit: v }), false, L.t('sme.import.map.credit'))}
                      </>
                    )}
                  <Field text={L.t('sme.import.decimal')}>
                    <select value={form.decimal} onChange={e => setForm({ ...form, decimal: e.target.value as DecimalSeparator })} style={input}>
                      <option value=".">{L.t('sme.import.decimal.point')}</option>
                      <option value=",">{L.t('sme.import.decimal.comma')}</option>
                    </select>
                  </Field>
                  {columnSelect(form.reference, v => setForm({ ...form, reference: v }), true, L.t('sme.import.map.reference'))}
                </div>
                {loaded.kind === 'csv' && !loaded.table.encoding?.certain && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--ds-text-body)' }}>
                    <input type="checkbox" checked={form.encodingConfirmed} onChange={e => setForm({ ...form, encodingConfirmed: e.target.checked })} />
                    {L.t('sme.import.encodingConfirm')}
                  </label>
                )}

                <PreviewTable header={header} table={loaded.table} headerRow={form.headerRow} staged={preview} currency={account?.currency ?? 'JOD'} />
                <FormError message={error} />
                {duplicate && <DuplicateNotice error={duplicate} onDiscard={id => submit(id)} />}
                <button type="button" style={{ ...primaryButton, alignSelf: 'flex-start', opacity: ready ? 1 : 0.6 }} disabled={!ready} onClick={() => submit()}>
                  {busy ? L.t('sme.import.uploading') : L.t('sme.import.submit')}
                </button>
              </section>
            )}
            {!loaded && <FormError message={error} />}
          </>
        )}
      </SmeGate>
    </div>
  );
}

function DuplicateNotice({ error, onDiscard }: { error: SmeApiError; onDiscard: (batchId: string) => void }) {
  const L = useLedgerText();
  const batchId = typeof error.details?.batch_id === 'string' ? error.details.batch_id : null;
  const status = error.details?.status;
  const committedAt = typeof error.details?.committed_at === 'string' ? error.details.committed_at : null;
  return (
    <div role="alert" style={{ padding: '10px 14px', borderRadius: '10px', background: 'var(--ds-warning-bg)', border: '1px solid var(--ds-warning-border)', color: 'var(--ds-warning-text)', fontSize: '13px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <span>{status === 'committed' && committedAt ? L.t('sme.import.duplicate.committed', { date: L.date(committedAt) }) : status === 'uploaded' ? L.t('sme.import.duplicate.unfinished') : L.t('sme.import.duplicate.open')}</span>
      {batchId && status === 'uploaded' && (
        <button type="button" style={{ ...secondaryButton, alignSelf: 'flex-start' }} onClick={() => onDiscard(batchId)}>{L.t('sme.import.duplicate.discard')}</button>
      )}
      {batchId && status !== 'uploaded' && (
        <Link href={`/crm/money/transactions/import/${batchId}`} style={{ color: 'var(--ds-primary)' }}>{L.t('sme.import.duplicate.view')}</Link>
      )}
    </div>
  );
}

function PreviewTable({ header, table, headerRow, staged, currency }: { header: string[]; table: FileTable; headerRow: number; staged: StagedRow[] | null; currency: string }) {
  const L = useLedgerText();
  const rows = table.table.slice(headerRow + 1, headerRow + 1 + PREVIEW_ROWS);
  const cell: React.CSSProperties = { padding: '6px 8px', borderBottom: '1px solid var(--ds-border)', textAlign: 'start', whiteSpace: 'nowrap', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--ds-text-heading)' }}>{L.t('sme.import.preview')}</h3>
      <div style={{ overflowX: 'auto', border: '1px solid var(--ds-border)', borderRadius: '10px' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: '12px', width: '100%', color: 'var(--ds-text-body)' }}>
          <thead><tr>{header.map((h, i) => <th key={i} style={{ ...cell, fontWeight: 600, background: 'var(--ds-bg-tinted)' }}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}>{header.map((_, j) => <td key={j} style={cell}>{String(r[j] ?? '')}</td>)}</tr>)}</tbody>
        </table>
      </div>
      {staged && (
        <div style={{ overflowX: 'auto', border: '1px solid var(--ds-border)', borderRadius: '10px' }} aria-label={L.t('sme.import.interpreted')}>
          <table style={{ borderCollapse: 'collapse', fontSize: '12px', width: '100%', color: 'var(--ds-text-body)' }}>
            <thead>
              <tr>{['sme.import.col.row', 'sme.import.col.date', 'sme.import.col.description', 'sme.import.col.amount', 'sme.import.col.check'].map(k => <th key={k} style={{ ...cell, fontWeight: 600, background: 'var(--ds-bg-tinted)' }}>{L.t(k)}</th>)}</tr>
            </thead>
            <tbody>
              {staged.map(r => (
                <tr key={r.row_number}>
                  <td style={cell}>{L.number(r.row_number)}</td>
                  <td style={cell}>{L.date(r.value_date)}</td>
                  <td style={cell}>{r.description}</td>
                  <td style={cell}>{r.amount_minor === null ? '' : L.amount(r.amount_minor, currency, { signDisplay: 'always' })}</td>
                  <td style={{ ...cell, color: r.issues.length ? 'var(--ds-error-text)' : 'var(--ds-success-text)' }}>
                    {r.issues.length ? r.issues.map(i => L.t(`sme.import.issue.${i.field}.${i.code}`)).join(' · ') : L.t('sme.import.looksRight')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
