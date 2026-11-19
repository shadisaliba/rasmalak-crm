'use client';

import { useIntl } from 'react-intl';
import type { PartyRole } from '@/types/crm';

export type PartyFilter = 'all' | PartyRole;

export function matchesPartyFilter(roles: PartyRole[] | null | undefined, filter: PartyFilter): boolean {
  return filter === 'all' || (roles ?? []).includes(filter);
}

/** "All / Customers / Suppliers" on the CRM company and contact lists (W3a-01). */
export function PartyRoleFilter({ value, onChange }: { value: PartyFilter; onChange: (v: PartyFilter) => void }) {
  const intl = useIntl();
  return (
    <select value={value} onChange={e => onChange(e.target.value as PartyFilter)} aria-label={intl.formatMessage({ id: 'sme.party.filter' })}
      style={{ padding: '8px 11px', fontSize: '14px', border: '1px solid var(--ds-border)', borderRadius: '8px', background: 'var(--ds-bg-input)', color: 'var(--ds-text-body)' }}>
      <option value="all">{intl.formatMessage({ id: 'sme.party.filter.all' })}</option>
      <option value="customer">{intl.formatMessage({ id: 'sme.party.filter.customer' })}</option>
      <option value="supplier">{intl.formatMessage({ id: 'sme.party.filter.supplier' })}</option>
    </select>
  );
}
