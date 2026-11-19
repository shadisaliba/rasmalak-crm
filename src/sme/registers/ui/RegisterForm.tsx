'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { smeApi, errorText } from '@/sme/api/client';
import { CURRENCY_CODES } from '@/sme/money';
import { todayInAmman } from '@/sme/ledger/domain/dates';
import { addYears } from '@/sme/imports/domain/dates';
import { Field, FormError, card, formGrid, input, muted, parseAmount, primaryButton, secondaryButton, useIdempotencyKey, useLedgerText } from '@/sme/ledger/ui/shared';
import { PartyPicker, type PartyRef } from '@/sme/parties/ui/PartyPicker';
import { QUANTITY_PATTERN, invoiceTotals, percentToBp } from '@/sme/receivables/domain/totals';
import { REGISTERS, type RegisterKind } from './config';

interface LineDraft { description: string; quantity: string; unitPrice: string; taxPercent: string }
const emptyLine = (): LineDraft => ({ description: '', quantity: '1', unitPrice: '', taxPercent: '0' });

function plusDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function RegisterForm({ kind, orgId, onDone, onCancel }: { kind: RegisterKind; orgId: string; onDone: () => void; onCancel: () => void }) {
  const cfg = REGISTERS[kind];
  const L = useLedgerText();
  const router = useRouter();
  const idem = useIdempotencyKey();
  const today = todayInAmman();
  const [party, setParty] = useState<PartyRef | null>(null);
  const [number, setNumber] = useState('');
  const [issueDate, setIssueDate] = useState(today);
  const [dueDate, setDueDate] = useState(plusDays(today, 30));
  const [currency, setCurrency] = useState('JOD');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const parsed = lines.map(l => ({
    description: l.description.trim(),
    quantity: l.quantity.trim(),
    unitPriceMinor: parseAmount(l.unitPrice, currency),
    taxRateBp: percentToBp(l.taxPercent),
  }));
  const valid = parsed.every(l => l.description && QUANTITY_PATTERN.test(l.quantity) && Number(l.quantity) > 0 && l.unitPriceMinor !== null && l.unitPriceMinor >= 0n && l.taxRateBp !== null);
  const totals = valid ? invoiceTotals(parsed.map(l => ({ quantity: l.quantity, unitPriceMinor: l.unitPriceMinor!, taxRateBp: l.taxRateBp! }))) : null;

  const save = async (status: 'draft' | 'open') => {
    setError(null);
    if (!party) return setError(L.t(`${cfg.msg}.form.partyRequired`));
    if (!valid || !totals || totals.total <= 0n) return setError(L.t(`${cfg.msg}.form.linesInvalid`));
    if (dueDate < issueDate) return setError(L.t(`${cfg.msg}.form.dueBeforeIssue`));
    setBusy(true);
    const r = await smeApi<{ invoice_id?: string; bill_id?: string }>(cfg.api, {
      orgId, method: 'POST', idempotencyKey: idem.current(),
      body: {
        ...('companyId' in party ? { [`${cfg.party}_company_id`]: party.companyId } : { [`${cfg.party}_contact_id`]: party.contactId }),
        [cfg.refField]: number.trim() || undefined, issue_date: issueDate, due_date: dueDate, currency, status, notes: notes.trim() || undefined,
        lines: parsed.map(l => ({ description: l.description, quantity: l.quantity, unit_price_minor: l.unitPriceMinor!.toString(), tax_rate_bp: l.taxRateBp! })),
        expected: { subtotal_minor: totals.subtotal.toString(), tax_minor: totals.tax.toString(), total_minor: totals.total.toString() },
      },
    });
    setBusy(false);
    if (!r.ok) return setError(errorText(r.error, L.intl.locale));
    idem.rotate();
    onDone();
    router.push(`${cfg.route}/${r.data[cfg.idField]}`);
  };

  const setLine = (i: number, patch: Partial<LineDraft>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <section style={{ ...card, display: 'flex', flexDirection: 'column', gap: '12px' }} aria-labelledby="new-record-title">
      <h2 id="new-record-title" style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--ds-text-heading)' }}>{L.t(`${cfg.msg}.new`)}</h2>
      <PartyPicker role={cfg.partyRole} value={party} onChange={setParty} label={L.t(`${cfg.msg}.form.customer`)} />
      <div style={formGrid}>
        <Field text={L.t(`${cfg.msg}.form.number`)}><input value={number} dir="ltr" placeholder={L.t(`${cfg.msg}.form.numberPlaceholder`)} onChange={e => setNumber(e.target.value)} style={input} /></Field>
        <Field text={L.t(`${cfg.msg}.form.issueDate`)}><input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} style={input} /></Field>
        <Field text={L.t(`${cfg.msg}.form.dueDate`)}><input type="date" value={dueDate} min={issueDate} max={addYears(issueDate, 5)} onChange={e => setDueDate(e.target.value)} style={input} /></Field>
        <Field text={L.t('sme.money.form.currency')}>
          <select value={currency} onChange={e => setCurrency(e.target.value)} style={input}>{CURRENCY_CODES.map(c => <option key={c} value={c}>{c}</option>)}</select>
        </Field>
      </div>
      <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <legend style={{ fontSize: '14px', fontWeight: 600, color: 'var(--ds-text-heading)', marginBottom: '6px' }}>{L.t(`${cfg.msg}.form.lines`)}</legend>
        {lines.map((l, i) => (
          <div key={i} data-testid="invoice-line" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '8px', alignItems: 'end' }}>
            <Field text={L.t(`${cfg.msg}.form.lineDescription`)}><input value={l.description} onChange={e => setLine(i, { description: e.target.value })} style={input} /></Field>
            <Field text={L.t(`${cfg.msg}.form.quantity`)}><input value={l.quantity} inputMode="decimal" dir="ltr" onChange={e => setLine(i, { quantity: e.target.value })} style={input} /></Field>
            <Field text={L.t(`${cfg.msg}.form.unitPrice`, { currency })}><input value={l.unitPrice} inputMode="decimal" dir="ltr" onChange={e => setLine(i, { unitPrice: e.target.value })} style={input} /></Field>
            <Field text={L.t(`${cfg.msg}.form.taxPercent`)}><input value={l.taxPercent} inputMode="decimal" dir="ltr" onChange={e => setLine(i, { taxPercent: e.target.value })} style={input} /></Field>
            {lines.length > 1 && <button type="button" style={secondaryButton} onClick={() => setLines(lines.filter((_, j) => j !== i))}>{L.t(`${cfg.msg}.form.removeLine`)}</button>}
          </div>
        ))}
        <button type="button" style={{ ...secondaryButton, alignSelf: 'flex-start' }} onClick={() => setLines([...lines, emptyLine()])}>{L.t(`${cfg.msg}.form.addLine`)}</button>
        <p style={muted}>{L.t(`${cfg.msg}.form.taxHelp`)}</p>
      </fieldset>
      <Field text={L.t('sme.money.tx.note')}><input value={notes} onChange={e => setNotes(e.target.value)} style={input} /></Field>
      {totals && (
        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'max-content max-content', gap: '4px 16px', fontSize: '14px' }} data-testid="invoice-totals">
          <dt style={{ color: 'var(--ds-text-muted)' }}>{L.t(`${cfg.msg}.subtotal`)}</dt><dd style={{ margin: 0 }}>{L.amount(totals.subtotal, currency)}</dd>
          <dt style={{ color: 'var(--ds-text-muted)' }}>{L.t(`${cfg.msg}.tax`)}</dt><dd style={{ margin: 0 }}>{L.amount(totals.tax, currency)}</dd>
          <dt style={{ fontWeight: 600 }}>{L.t(`${cfg.msg}.total`)}</dt><dd style={{ margin: 0, fontWeight: 600 }}>{L.amount(totals.total, currency)}</dd>
        </dl>
      )}
      <FormError message={error} />
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button type="button" style={primaryButton} disabled={busy} onClick={() => save('open')}>{L.t(`${cfg.msg}.form.saveOpen`)}</button>
        <button type="button" style={secondaryButton} disabled={busy} onClick={() => save('draft')}>{L.t(`${cfg.msg}.form.saveDraft`)}</button>
        <button type="button" style={secondaryButton} onClick={onCancel}>{L.t('sme.money.form.cancel')}</button>
      </div>
    </section>
  );
}
