'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useOrg, useOrgPermission } from '@/store/orgStore';
import { parseRpcError } from '@/lib/rpcError';
import type { PartyRole } from '@/types/crm';
import { Chip, Field, FormError, card, formGrid, input, muted, primaryButton, secondaryButton, useLedgerText } from '@/sme/ledger/ui/shared';

const KINDS = ['tax_number', 'national_establishment_number', 'commercial_registration', 'national_id'] as const;
interface Identifier { id: string; kind: (typeof KINDS)[number]; last4: string }
interface ReceivablesSummary { open_count: number; overdue_count: number; outstanding: Array<{ currency: string; minor: string }>; paid_count: number; median_days_to_pay: number | null }

interface Props {
  party: { companyId: string } | { contactId: string };
  roles: PartyRole[];
  canEditRoles: boolean;
  onRolesChange: (roles: PartyRole[]) => Promise<void> | void;
}

/**
 * Finance tab of a company or contact: whether it is a customer and/or supplier, its official
 * identifiers (shown as the last four characters; a reveal is audited), and its invoice and
 * bill records once those registers exist.
 */
export function PartyFinancePanel({ party, roles, canEditRoles, onRolesChange }: Props) {
  const L = useLedgerText();
  const { currentOrg } = useOrg();
  const canIdentify = useOrgPermission('sme.parties.identifiers');
  const canReadReceivables = useOrgPermission('sme.receivables.read');
  const [summary, setSummary] = useState<ReceivablesSummary | null>(null);
  const [items, setItems] = useState<Identifier[]>([]);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [kind, setKind] = useState<Identifier['kind']>('tax_number');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const column = 'companyId' in party ? 'company_id' : 'contact_id';
  const partyId = 'companyId' in party ? party.companyId : party.contactId;

  useEffect(() => {
    if (!canIdentify) return;
    let ignore = false;
    supabase.from('sme_party_identifiers').select('id, kind, last4').eq(column, partyId).order('kind').then(({ data }) => {
      if (!ignore) setItems((data ?? []) as Identifier[]);
    });
    return () => { ignore = true; };
  }, [canIdentify, column, partyId, reloadKey]);

  useEffect(() => {
    if (!currentOrg || !canReadReceivables) return;
    let ignore = false;
    supabase.rpc('sme_party_receivables_summary', {
      p_org: currentOrg.id, p_company: column === 'company_id' ? partyId : null, p_contact: column === 'contact_id' ? partyId : null,
    }).then(({ data }) => { if (!ignore && data) setSummary(data as ReceivablesSummary); });
    return () => { ignore = true; };
  }, [currentOrg, canReadReceivables, column, partyId]);

  const toggleRole = (role: PartyRole, on: boolean) =>
    onRolesChange(on ? [...new Set([...roles, role])] : roles.filter(r => r !== role));

  const add = async () => {
    if (!currentOrg || !value.trim()) return;
    setError(null);
    const { error: rpcError } = await supabase.rpc('sme_set_party_identifier', {
      p_org: currentOrg.id, p_party: { [column]: partyId }, p_kind: kind, p_value: value,
      p_correlation_id: crypto.randomUUID(), p_idem: crypto.randomUUID(),
    });
    if (rpcError) return setError(L.t(`errors.${parseRpcError(rpcError).code}`));
    setValue('');
    setReloadKey(k => k + 1);
  };

  const reveal = async (id: string) => {
    const { data, error: rpcError } = await supabase.rpc('sme_reveal_identifier', { p_id: id });
    if (!rpcError && typeof data === 'string') setRevealed(r => ({ ...r, [id]: data }));
  };

  const remove = async (id: string) => {
    if (!currentOrg) return;
    await supabase.rpc('sme_remove_party_identifier', { p_org: currentOrg.id, p_id: id, p_correlation_id: crypto.randomUUID(), p_idem: crypto.randomUUID() });
    setReloadKey(k => k + 1);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }} data-testid="party-finance">
      <section style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--ds-text-heading)' }}>{L.t('sme.party.roles')}</h3>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          {(['customer', 'supplier'] as const).map(role => (
            <label key={role} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', color: 'var(--ds-text-body)' }}>
              <input type="checkbox" checked={roles.includes(role)} disabled={!canEditRoles} onChange={e => toggleRole(role, e.target.checked)} />
              {L.t(`sme.party.role.${role}`)}
            </label>
          ))}
        </div>
      </section>

      {canIdentify && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--ds-text-heading)' }}>{L.t('sme.party.identifiers')}</h3>
          <p style={muted}>{L.t('sme.party.identifiersHelp')}</p>
          {items.length > 0 && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {items.map(i => (
                <li key={i.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', fontSize: '14px' }}>
                  <span style={{ minWidth: '180px', color: 'var(--ds-text-body)' }}>{L.t(`sme.party.kind.${i.kind}`)}</span>
                  <bdi dir="ltr" data-testid="identifier-value" style={{ fontFamily: 'monospace' }}>{revealed[i.id] ?? `•••• ${i.last4}`}</bdi>
                  {!revealed[i.id] && <button type="button" style={secondaryButton} onClick={() => reveal(i.id)}>{L.t('sme.party.reveal')}</button>}
                  <button type="button" style={secondaryButton} onClick={() => remove(i.id)}>{L.t('sme.party.remove')}</button>
                </li>
              ))}
            </ul>
          )}
          <div style={formGrid}>
            <Field text={L.t('sme.party.kind')}>
              <select value={kind} onChange={e => setKind(e.target.value as Identifier['kind'])} style={input}>
                {KINDS.map(k => <option key={k} value={k}>{L.t(`sme.party.kind.${k}`)}</option>)}
              </select>
            </Field>
            <Field text={L.t('sme.party.value')}>
              <input value={value} dir="ltr" autoComplete="off" onChange={e => setValue(e.target.value)} style={input} />
            </Field>
          </div>
          <FormError message={error} />
          <button type="button" style={{ ...primaryButton, alignSelf: 'flex-start' }} onClick={add}>{L.t('sme.party.addIdentifier')}</button>
        </section>
      )}

      <section style={{ ...card, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '6px' }} data-testid="party-records">
        <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--ds-text-heading)' }}>{L.t('sme.party.records')}</h3>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {roles.map(r => <Chip key={r}>{L.t(`sme.party.role.${r}`)}</Chip>)}
        </div>
        {summary && (summary.open_count > 0 || summary.paid_count > 0) ? (
          <>
            <p style={{ margin: 0, fontSize: '14px', color: 'var(--ds-text-body)' }}>
              {L.t('sme.party.receivablesSummary', { open: summary.open_count, overdue: summary.overdue_count })}
              {summary.outstanding.map(o => ` · ${L.amount(o.minor, o.currency)}`).join('')}
            </p>
            {summary.median_days_to_pay !== null && <p style={muted}>{L.t('sme.party.medianDaysToPay', { days: summary.median_days_to_pay, count: summary.paid_count })}</p>}
          </>
        ) : <p style={muted}>{L.t('sme.party.recordsEmpty')}</p>}
      </section>
    </div>
  );
}
