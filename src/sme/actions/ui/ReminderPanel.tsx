'use client';

import { useEffect, useMemo, useState } from 'react';
import { createIntl, createIntlCache } from 'react-intl';
import { MessageCircle, Copy } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useOrg } from '@/store/orgStore';
import { smeApi, errorText } from '@/sme/api/client';
import { Field, FormError, input, muted, primaryButton, secondaryButton, useIdempotencyKey } from '@/sme/ledger/ui/shared';
import { INTL_LOCALE, formatMoney, isCurrencyCode, money, type UiLocale } from '@/sme/money';
import enActions from '@/messages/en/actions';
import arActions from '@/messages/ar/actions';
import { useActionText, type ActionRow } from './text';

interface Contact { id: string; first_name: string; last_name: string | null; first_name_ar: string | null; phone: string | null; whatsapp_number: string | null }
interface Invoice { number: string; customer_company_id: string | null; customer_contact_id: string | null; due_date: string; currency: string }

/** Jordanian numbers in international form for wa.me: 07XXXXXXXX → 9627XXXXXXXX. */
export function waNumber(raw: string | null): string | null {
  if (!raw) return null;
  let d = raw.replace(/[^\d]/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 10 && d.startsWith('07')) d = `962${d.slice(1)}`;
  return d.length >= 8 ? d : null;
}

/**
 * A payment reminder the owner sends themself (WhatsApp on their phone, or copy), or saves to the
 * Outbox for approval. Nothing here sends a message (rule R17).
 */
export function ReminderPanel({ orgId, action, outstandingMinor, onClose }: { orgId: string; action: ActionRow; outstandingMinor: string; onClose: () => void }) {
  const A = useActionText([]);
  const { currentOrg } = useOrg();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [contactId, setContactId] = useState('');
  const [language, setLanguage] = useState<UiLocale>(A.uiLocale);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'copied'>('idle');
  const [error, setError] = useState<string | null>(null);
  const key = useIdempotencyKey();

  useEffect(() => {
    if (!action.subject_id) return;
    let ignore = false;
    smeApi<{ record: Invoice }>(`invoices/${action.subject_id}`, { orgId }).then(async res => {
      if (ignore || !res.ok) { if (!ignore && !res.ok) setError(errorText(res.error, A.intl.locale)); return; }
      const inv = res.data.record;
      setInvoice(inv);
      const filters = [inv.customer_company_id && `company_id.eq.${inv.customer_company_id}`, inv.customer_contact_id && `id.eq.${inv.customer_contact_id}`].filter(Boolean).join(',');
      const { data } = await supabase.from('crm_contacts').select('id, first_name, last_name, first_name_ar, phone, whatsapp_number').eq('org_id', orgId).or(filters).limit(20);
      if (ignore) return;
      const list = ((data ?? []) as Contact[]).filter(c => waNumber(c.whatsapp_number ?? c.phone));
      setContacts(list);
      setContactId(list[0]?.id ?? '');
    });
    return () => { ignore = true; };
  }, [orgId, action.subject_id, A.intl.locale]);

  const contact = contacts?.find(c => c.id === contactId) ?? null;
  const message = useMemo(() => {
    if (!invoice || !contact || !isCurrencyCode(invoice.currency)) return '';
    const ar = language === 'ar';
    const intl = createIntl({ locale: INTL_LOCALE[language], messages: ar ? arActions : enActions }, createIntlCache());
    return intl.formatMessage({ id: 'reminder.text' }, {
      name: ar ? contact.first_name_ar || contact.first_name : contact.first_name,
      business: (ar ? currentOrg?.nameAr || currentOrg?.name : currentOrg?.name || currentOrg?.nameAr) ?? '',
      number: invoice.number,
      amount: formatMoney(money(BigInt(outstandingMinor), invoice.currency), language),
      due: new Intl.DateTimeFormat(INTL_LOCALE[language], { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(`${invoice.due_date}T00:00:00Z`)),
    });
  }, [invoice, contact, language, currentOrg, outstandingMinor]);

  const saveToOutbox = async () => {
    setState('saving');
    const res = await smeApi(`actions/${action.id}/reminder`, { orgId, method: 'POST', idempotencyKey: key.current(), body: { contact_id: contactId, language } });
    if (!res.ok) { setState('idle'); setError(errorText(res.error, A.intl.locale)); return; }
    key.rotate();
    setState('saved');
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(message); setState('copied'); } catch { setError(A.t('actions.reminder.copy')); }
  };
  const phone = waNumber(contact?.whatsapp_number ?? contact?.phone ?? null);

  return (
    <div data-testid="reminder-panel" style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px', borderRadius: '12px', background: 'var(--ds-bg-tinted)' }}>
      <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--ds-text-heading)' }}>
        {A.t('actions.reminder.title', { customer: String(action.params.customer ?? '') })}
      </h3>
      {contacts === null ? <p style={muted}>{A.t('sme.state.loading')}</p> : contacts.length === 0 ? (
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--ds-warning-text)' }}>{A.t('actions.reminder.noContact')}</p>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
            <Field text={A.t('actions.reminder.to')}>
              <select style={input} value={contactId} onChange={e => setContactId(e.target.value)}>
                {contacts.map(c => <option key={c.id} value={c.id}>{A.localName([c.first_name, c.last_name].filter(Boolean).join(' '), c.first_name_ar)} · {c.whatsapp_number ?? c.phone}</option>)}
              </select>
            </Field>
            <Field text={A.t('actions.reminder.language')}>
              <select style={input} value={language} onChange={e => setLanguage(e.target.value as UiLocale)}>
                <option value="ar">العربية</option>
                <option value="en">English</option>
              </select>
            </Field>
          </div>
          <p data-testid="reminder-text" dir={language === 'ar' ? 'rtl' : 'ltr'} style={{ margin: 0, padding: '10px 12px', borderRadius: '10px', background: 'var(--ds-bg-card)', border: '1px solid var(--ds-border)', fontSize: '14px', lineHeight: 1.6, color: 'var(--ds-text-body)', whiteSpace: 'pre-wrap' }}>
            {message}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {phone && (
              <a href={`https://wa.me/${phone}?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer"
                style={{ ...primaryButton, display: 'inline-flex', alignItems: 'center', gap: '6px', textDecoration: 'none' }}>
                <MessageCircle size={15} aria-hidden /> {A.t('actions.reminder.openWhatsApp')}
              </a>
            )}
            <button type="button" style={{ ...secondaryButton, display: 'inline-flex', alignItems: 'center', gap: '6px' }} onClick={() => void copy()}>
              <Copy size={14} aria-hidden /> {state === 'copied' ? A.t('actions.reminder.copied') : A.t('actions.reminder.copy')}
            </button>
            <button type="button" style={secondaryButton} disabled={state === 'saving' || state === 'saved'} onClick={() => void saveToOutbox()}>
              {A.t('actions.reminder.outbox')}
            </button>
            <button type="button" style={secondaryButton} onClick={onClose}>{A.t('actions.cancel')}</button>
          </div>
          {state === 'saved' ? <p role="status" style={{ margin: 0, fontSize: '13px', color: 'var(--ds-success-text)' }}>{A.t('actions.reminder.queued')}</p>
            : <p style={muted}>{A.t('actions.reminder.note')} {A.t('actions.reminder.outboxNote')}</p>}
        </>
      )}
      <FormError message={error} />
    </div>
  );
}
