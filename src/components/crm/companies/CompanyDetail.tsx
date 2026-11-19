'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useIntl } from 'react-intl';
import { useCrm } from '@/store/crmStore';
import { useOrgPermission } from '@/store/orgStore';
import { useSmeEnabled } from '@/sme/ui/useSmeEnabled';
import { DataState } from '@/sme/ui/DataState';
import { PartyFinancePanel } from '@/sme/parties/ui/PartyFinancePanel';
import { Field, card, formGrid, input, primaryButton, secondaryButton } from '@/sme/ledger/ui/shared';

export function CompanyDetail({ companyId }: { companyId: string }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const isAr = intl.locale.startsWith('ar');
  const { companies, contacts, isLoading, updateCompany } = useCrm();
  const canRead = useOrgPermission('companies.read');
  const canWrite = useOrgPermission('companies.write');
  const sme = useSmeEnabled();
  const [tab, setTab] = useState<'details' | 'contacts' | 'finance'>('details');
  const company = companies.find(c => c.id === companyId);
  const [draft, setDraft] = useState<{ name: string; nameAr: string; phone: string; email: string; city: string } | null>(null);

  if (!canRead) return <DataState state="denied" />;
  if (isLoading.companies) return <DataState state="loading" />;
  if (!company) return <DataState state="empty" message={t('crm.company.notFound')} />;

  const people = contacts.filter(p => p.companyId === company.id);
  const tabs = [
    { key: 'details' as const, label: t('crm.tabs.details') },
    { key: 'contacts' as const, label: t('crm.company.contactsTab', { count: people.length }) },
    ...(sme ? [{ key: 'finance' as const, label: t('sme.party.financeTab') }] : []),
  ];
  const editing = draft ?? { name: company.name, nameAr: company.nameAr ?? '', phone: company.phone ?? '', email: company.email ?? '', city: company.city ?? '' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: '1000px' }}>
      <div>
        <Link href="/crm/companies" style={{ fontSize: '13px', color: 'var(--ds-primary)' }}>{t('crm.company.back')}</Link>
        <h1 style={{ fontSize: '24px', fontWeight: 600, color: 'var(--ds-text-heading)', margin: '6px 0 0' }}>{isAr ? company.nameAr || company.name : company.name}</h1>
      </div>
      <div role="tablist" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {tabs.map(x => (
          <button key={x.key} role="tab" type="button" aria-selected={tab === x.key} onClick={() => setTab(x.key)}
            style={{ ...secondaryButton, background: tab === x.key ? 'var(--ds-primary)' : 'transparent', color: tab === x.key ? 'var(--ds-on-primary)' : 'var(--ds-text-body)', borderColor: tab === x.key ? 'var(--ds-primary)' : 'var(--ds-border)' }}>
            {x.label}
          </button>
        ))}
      </div>
      <section style={{ ...card, display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {tab === 'details' && (
          <>
            <fieldset disabled={!canWrite} style={{ border: 'none', padding: 0, margin: 0 }}>
              <div style={formGrid}>
                <Field text={t('crm.company.name')}><input value={editing.name} onChange={e => setDraft({ ...editing, name: e.target.value })} style={input} /></Field>
                <Field text={t('crm.company.nameAr')}><input value={editing.nameAr} dir="rtl" onChange={e => setDraft({ ...editing, nameAr: e.target.value })} style={input} /></Field>
                <Field text={t('crm.company.phone')}><input value={editing.phone} dir="ltr" onChange={e => setDraft({ ...editing, phone: e.target.value })} style={input} /></Field>
                <Field text={t('crm.company.email')}><input value={editing.email} dir="ltr" onChange={e => setDraft({ ...editing, email: e.target.value })} style={input} /></Field>
                <Field text={t('crm.company.city')}><input value={editing.city} onChange={e => setDraft({ ...editing, city: e.target.value })} style={input} /></Field>
              </div>
            </fieldset>
            {canWrite && draft && (
              <button type="button" style={{ ...primaryButton, alignSelf: 'flex-start' }} onClick={async () => {
                if (!draft.name.trim()) return;
                await updateCompany(company.id, { name: draft.name.trim(), nameAr: draft.nameAr.trim() || null, phone: draft.phone.trim() || null, email: draft.email.trim() || null, city: draft.city.trim() || null });
                setDraft(null);
              }}>{t('crm.company.save')}</button>
            )}
          </>
        )}
        {tab === 'contacts' && (
          people.length === 0 ? <p style={{ margin: 0, fontSize: '13px', color: 'var(--ds-text-muted)' }}>{t('crm.company.noContacts')}</p> : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {people.map(p => (
                <li key={p.id}><Link href={`/crm/contacts/${p.id}`} style={{ color: 'var(--ds-primary)', fontSize: '14px' }}>
                  {isAr ? [p.firstNameAr || p.firstName, p.lastNameAr || p.lastName].filter(Boolean).join(' ') : [p.firstName, p.lastName].filter(Boolean).join(' ')}
                </Link></li>
              ))}
            </ul>
          )
        )}
        {tab === 'finance' && (
          <PartyFinancePanel party={{ companyId: company.id }} roles={company.partyRoles ?? []} canEditRoles={canWrite}
            onRolesChange={roles => updateCompany(company.id, { partyRoles: roles })} />
        )}
      </section>
    </div>
  );
}
