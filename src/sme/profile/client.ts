'use client';

import { supabase } from '@/lib/supabaseClient';
import { parseRpcError, type RpcFailure } from '@/lib/rpcError';
import { FACT_KEYS, type FactKey, type FactStatus } from './factKeys';
import { CONSENT_DOCUMENT_VERSIONS, type ConsentPurpose } from './consents';

export interface BusinessProfile {
  legalName: string | null;
  tradeName: string | null;
  tradeNameAr: string | null;
  legalForm: string | null;
  sector: string | null;
  activityDescription: string | null;
  governorate: string | null;
  municipality: string | null;
  premisesType: string | null;
  fiscalYearStartMonth: number;
  weekStart: number;
  profileVersion: number;
}

export type LookupKind = 'legal_form' | 'governorate' | 'municipality' | 'premises_type' | 'sector';
export interface LookupValue { kind: LookupKind; code: string; nameEn: string; nameAr: string; reviewState: 'needs_review' | 'approved' }
export interface FactState { value: unknown; status: FactStatus }

export interface ProfileBundle {
  profile: BusinessProfile | null;
  facts: Partial<Record<FactKey, FactState>>;
  lookups: Record<LookupKind, LookupValue[]>;
  consents: Partial<Record<ConsentPurpose, boolean>>;
  openReminders: number;
}

export type ProfilePatch = Partial<Record<
  'legal_name' | 'trade_name' | 'trade_name_ar' | 'legal_form' | 'sector' | 'activity_description'
  | 'governorate' | 'municipality' | 'premises_type' | 'fiscal_year_start_month' | 'week_start', string | number | null>>;

export async function loadProfileBundle(orgId: string): Promise<ProfileBundle | null> {
  const [profile, facts, lookups, consents, reminders] = await Promise.all([
    supabase.from('sme_business_profiles').select('*').eq('org_id', orgId).maybeSingle(),
    supabase.from('sme_profile_facts').select('fact_key, value, status').eq('org_id', orgId),
    supabase.from('sme_lookup_values').select('kind, code, name_en, name_ar, review_state').eq('active', true).order('sort'),
    supabase.from('user_consents').select('purpose').eq('org_id', orgId).is('revoked_at', null),
    supabase.from('sme_actions').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('rule_code', 'profile.missing_fact').eq('status', 'open'),
  ]);
  if (profile.error || facts.error || lookups.error) return null;

  const p = profile.data;
  const grouped = { legal_form: [], governorate: [], municipality: [], premises_type: [], sector: [] } as Record<LookupKind, LookupValue[]>;
  for (const l of lookups.data ?? []) {
    grouped[l.kind as LookupKind].push({ kind: l.kind, code: l.code, nameEn: l.name_en, nameAr: l.name_ar, reviewState: l.review_state });
  }
  const factState: Partial<Record<FactKey, FactState>> = {};
  for (const f of facts.data ?? []) {
    if ((FACT_KEYS as string[]).includes(f.fact_key)) factState[f.fact_key as FactKey] = { value: f.value, status: f.status };
  }
  return {
    profile: p ? {
      legalName: p.legal_name, tradeName: p.trade_name, tradeNameAr: p.trade_name_ar, legalForm: p.legal_form,
      sector: p.sector, activityDescription: p.activity_description, governorate: p.governorate,
      municipality: p.municipality, premisesType: p.premises_type, fiscalYearStartMonth: p.fiscal_year_start_month,
      weekStart: p.week_start, profileVersion: p.profile_version,
    } : null,
    facts: factState,
    lookups: grouped,
    consents: Object.fromEntries((consents.data ?? []).map(c => [c.purpose, true])),
    openReminders: reminders.count ?? 0,
  };
}

type Result = { ok: true } | ({ ok: false } & RpcFailure);

export async function updateProfile(orgId: string, patch: ProfilePatch): Promise<Result> {
  const { error } = await supabase.rpc('sme_update_profile', {
    p_org: orgId, p_patch: patch, p_correlation_id: crypto.randomUUID(), p_idem: crypto.randomUUID(),
  });
  return error ? { ok: false, ...parseRpcError(error) } : { ok: true };
}

export async function setFact(orgId: string, key: FactKey, status: FactStatus, value: unknown): Promise<Result> {
  const { error } = await supabase.rpc('sme_set_fact', {
    p_org: orgId, p_fact_key: key, p_value: status === 'known' ? value : null, p_status: status,
    p_correlation_id: crypto.randomUUID(), p_idem: crypto.randomUUID(),
  });
  return error ? { ok: false, ...parseRpcError(error) } : { ok: true };
}

export async function setConsent(orgId: string | null, purpose: ConsentPurpose, grant: boolean): Promise<Result> {
  const { error } = await supabase.rpc('sme_record_consent', {
    p_org: orgId, p_purpose: purpose, p_document_version: CONSENT_DOCUMENT_VERSIONS[purpose], p_grant: grant,
    p_correlation_id: crypto.randomUUID(),
  });
  return error ? { ok: false, ...parseRpcError(error) } : { ok: true };
}
