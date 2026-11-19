'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useIntl } from 'react-intl';
import { useCrm } from '@/store/crmStore';
import { useOrgPermission } from '@/store/orgStore';
import { normalizeForSearch } from '@/crm/search/normalizer';
import type { PartyRole } from '@/types/crm';
import { useSmeEnabled } from '@/sme/ui/useSmeEnabled';
import { DataState } from '@/sme/ui/DataState';
import { PartyRoleFilter, matchesPartyFilter, type PartyFilter } from '@/sme/parties/ui/PartyRoleFilter';
import { Chip, Field, FormError, card, formGrid, input, primaryButton, secondaryButton } from '@/sme/ledger/ui/shared';

/** Companies, which also serve as customers and suppliers for the finance screens (W3a-01). */
export function CompanyList() {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const isAr = intl.locale.startsWith('ar');
  const { companies, contacts, isLoading, addCompany } = useCrm();
  const canRead = useOrgPermission('companies.read');
  const canWrite = useOrgPermission('companies.write');
  const sme = useSmeEnabled();
  const [filter, setFilter] = useState<PartyFilter>('all');
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', nameAr: '', roles: [] as PartyRole[] });
  const [error, setError] = useState<string | null>(null);

  const shown = useMemo(() => {
    const q = normalizeForSearch(query);
    return companies.filter(c => matchesPartyFilter(c.partyRoles, filter)
      && (!q || normalizeForSearch(`${c.name} ${c.nameAr ?? ''}`).includes(q)));
  }, [companies, filter, query]);

  if (!canRead) return <DataState state="denied" />;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return setError(t('crm.company.nameRequired'));
    const created = await addCompany({ name: form.name.trim(), nameAr: form.nameAr.trim() || null, partyRoles: form.roles });
    if (!created) return setError(t('errors.INTERNAL'));
    setForm({ name: '', nameAr: '', roles: [] });
    setAdding(false);
    setError(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: '1000px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 600, color: 'var(--ds-text-heading)', margin: '0 0 4px' }}>{t('crm.nav.companies')}</h1>
          <p style={{ fontSize: '13px', color: 'var(--ds-text-muted)', margin: 0 }}>{t(sme ? 'crm.company.listHelpSme' : 'crm.company.listHelp')}</p>
        </div>
        {canWrite && <button type="button" style={primaryButton} onClick={() => setAdding(!adding)}>{t('crm.company.add')}</button>}
      </div>

      {adding && (
        <form onSubmit={save} style={{ ...card, display: 'flex', flexDirection: 'column', gap: '12px' }} aria-labelledby="add-company-title">
          <h2 id="add-company-title" style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--ds-text-heading)' }}>{t('crm.company.add')}</h2>
          <div style={formGrid}>
            <Field text={t('crm.company.name')}><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={input} /></Field>
            <Field text={t('crm.company.nameAr')}><input value={form.nameAr} dir="rtl" onChange={e => setForm({ ...form, nameAr: e.target.value })} style={input} /></Field>
          </div>
          {sme && (
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              {(['customer', 'supplier'] as const).map(role => (
                <label key={role} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', color: 'var(--ds-text-body)' }}>
                  <input type="checkbox" checked={form.roles.includes(role)}
                    onChange={e => setForm({ ...form, roles: e.target.checked ? [...form.roles, role] : form.roles.filter(r => r !== role) })} />
                  {t(`sme.party.role.${role}`)}
                </label>
              ))}
            </div>
          )}
          <FormError message={error} />
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="submit" style={primaryButton}>{t('crm.company.save')}</button>
            <button type="button" style={secondaryButton} onClick={() => setAdding(false)}>{t('sme.money.form.cancel')}</button>
          </div>
        </form>
      )}

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={t('crm.company.search')} aria-label={t('crm.company.search')} style={{ ...input, flex: '1 1 220px', maxWidth: '420px' }} />
        {sme && <PartyRoleFilter value={filter} onChange={setFilter} />}
      </div>

      {isLoading.companies ? <DataState state="loading" /> : shown.length === 0 ? (
        <DataState state="empty" message={t(companies.length ? 'crm.company.noMatch' : 'crm.company.empty')} />
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {shown.map(c => {
            const people = contacts.filter(p => p.companyId === c.id).length;
            return (
              <li key={c.id} style={{ ...card, padding: '12px 14px' }}>
                <Link href={`/crm/companies/${c.id}`} style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', textDecoration: 'none', color: 'inherit' }}>
                  <span style={{ flex: 1, minWidth: '160px', fontSize: '15px', fontWeight: 500, color: 'var(--ds-text-heading)' }}>{isAr ? c.nameAr || c.name : c.name}</span>
                  {sme && (c.partyRoles ?? []).map(r => <Chip key={r}>{t(`sme.party.role.${r}`)}</Chip>)}
                  <span style={{ fontSize: '12px', color: 'var(--ds-text-muted)' }}>{t('crm.company.contactCount', { count: people })}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
