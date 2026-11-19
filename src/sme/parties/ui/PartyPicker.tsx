'use client';

import { useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import { useCrm } from '@/store/crmStore';
import { normalizeForSearch } from '@/crm/search/normalizer';
import { ArabicSearchInput } from '@/components/crm/shared/ArabicSearchInput';
import type { PartyRole } from '@/types/crm';

export type PartyRef = { companyId: string } | { contactId: string };

/** Chooses a company or contact, parties with the given role first. */
export function PartyPicker({ role, value, onChange, label }: { role: PartyRole; value: PartyRef | null; onChange: (v: PartyRef | null) => void; label: string }) {
  const intl = useIntl();
  const isAr = intl.locale.startsWith('ar');
  const { companies, contacts } = useCrm();
  const [query, setQuery] = useState('');

  const options = useMemo(() => {
    const q = normalizeForSearch(query);
    const all = [
      ...companies.map(c => ({ key: `company:${c.id}`, label: isAr ? c.nameAr || c.name : c.name, hasRole: (c.partyRoles ?? []).includes(role), kind: 'company' as const })),
      ...contacts.map(c => ({
        key: `contact:${c.id}`,
        label: isAr ? [c.firstNameAr || c.firstName, c.lastNameAr || c.lastName].filter(Boolean).join(' ') : [c.firstName, c.lastName].filter(Boolean).join(' '),
        hasRole: (c.partyRoles ?? []).includes(role), kind: 'contact' as const,
      })),
    ];
    return all.filter(o => !q || normalizeForSearch(o.label).includes(q))
      .sort((a, b) => Number(b.hasRole) - Number(a.hasRole) || a.label.localeCompare(b.label, intl.locale))
      .slice(0, 100);
  }, [companies, contacts, query, role, isAr, intl.locale]);

  const selected = value ? ('companyId' in value ? `company:${value.companyId}` : `contact:${value.contactId}`) : '';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--ds-text-body)' }}>{label}</span>
      <ArabicSearchInput onSearch={setQuery} placeholder={intl.formatMessage({ id: 'sme.party.searchPlaceholder' })} />
      <select aria-label={label} value={selected} onChange={e => {
        const [kind, id] = e.target.value.split(':');
        onChange(!id ? null : kind === 'company' ? { companyId: id } : { contactId: id });
      }} style={{ padding: '8px 11px', fontSize: '14px', border: '1px solid var(--ds-border)', borderRadius: '8px', background: 'var(--ds-bg-input)', color: 'var(--ds-text-body)' }}>
        <option value="">{intl.formatMessage({ id: 'sme.party.choose' })}</option>
        {options.map(o => (
          <option key={o.key} value={o.key}>{o.hasRole ? `${o.label} · ${intl.formatMessage({ id: `sme.party.role.${role}` })}` : o.label}</option>
        ))}
      </select>
    </div>
  );
}
