'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useIntl } from 'react-intl';
import { supabase } from '@/lib/supabaseClient';
import { INTL_LOCALE, formatMoney, isCurrencyCode, money, parseMajor, type FormatMoneyOptions, type UiLocale } from '@/sme/money';
import type { CategoryKind } from '../types';

// ── Styles ───────────────────────────────────────────────────

export const card: CSSProperties = {
  background: 'var(--ds-bg-card)', border: '0.5px solid var(--ds-border)', borderRadius: '16px', padding: '16px 18px',
  boxShadow: 'var(--ds-shadow-card)',
};
export const input: CSSProperties = {
  padding: '8px 11px', fontSize: '14px', border: '1px solid var(--ds-border)', borderRadius: '8px',
  background: 'var(--ds-bg-input)', color: 'var(--ds-text-body)', width: '100%', minWidth: 0,
};
export const label: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '13px', fontWeight: 500, color: 'var(--ds-text-body)', minWidth: 0 };
export const primaryButton: CSSProperties = {
  padding: '8px 14px', fontSize: '13px', fontWeight: 500, borderRadius: '8px', border: 'none',
  background: 'var(--ds-primary)', color: 'var(--ds-on-primary)', cursor: 'pointer',
};
export const secondaryButton: CSSProperties = {
  padding: '7px 12px', fontSize: '13px', borderRadius: '8px', border: '1px solid var(--ds-border)',
  background: 'transparent', color: 'var(--ds-text-body)', cursor: 'pointer',
};
export const muted: CSSProperties = { fontSize: '12px', color: 'var(--ds-text-muted)', margin: 0 };
export const formGrid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' };

type ChipTone = 'neutral' | 'warning' | 'info';
const CHIP: Record<ChipTone, CSSProperties> = {
  neutral: { background: 'var(--ds-bg-tinted)', color: 'var(--ds-text-body)', borderColor: 'var(--ds-border-tinted)' },
  warning: { background: 'var(--ds-warning-bg)', color: 'var(--ds-warning-text)', borderColor: 'var(--ds-warning-border)' },
  info: { background: 'var(--ds-bg-card)', color: 'var(--ds-text-muted)', borderColor: 'var(--ds-border)' },
};

export function Chip({ tone = 'neutral', children }: { tone?: ChipTone; children: ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', fontSize: '11px', fontWeight: 500, borderRadius: '999px', border: '1px solid', whiteSpace: 'nowrap', ...CHIP[tone] }}>
      {children}
    </span>
  );
}

export function Field({ text, children }: { text: string; children: ReactNode }) {
  return <label style={label}>{text}{children}</label>;
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return <p role="alert" style={{ margin: 0, fontSize: '13px', color: 'var(--ds-error-text)' }}>{message}</p>;
}

// ── Text and formatting ──────────────────────────────────────

export function useLedgerText() {
  const intl = useIntl();
  const isAr = intl.locale.startsWith('ar');
  const uiLocale: UiLocale = isAr ? 'ar' : 'en';
  return {
    intl,
    isAr,
    uiLocale,
    t: (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values),
    amount: (minor: string | bigint, currency: string, options?: FormatMoneyOptions) =>
      isCurrencyCode(currency) ? formatMoney(money(BigInt(minor), currency), uiLocale, options) : `${minor} ${currency}`,
    date: (iso: string | null | undefined) =>
      iso ? intl.formatDate(new Date(`${iso.slice(0, 10)}T00:00:00Z`), { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' }) : '',
    dateTime: (iso: string | null | undefined) => (iso ? intl.formatDate(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' }) : ''),
    number: (value: number) => intl.formatNumber(value),
    /** A decimal string such as an exchange rate, formatted exactly in the UI locale's digits. */
    decimal: (value: string) => new Intl.NumberFormat(INTL_LOCALE[uiLocale], { maximumFractionDigits: 12 }).format(value as Intl.StringNumericLiteral),
    localName: (en: string | null | undefined, ar: string | null | undefined) => (isAr ? ar || en : en || ar) ?? '',
  };
}

/** Arabic-Indic and Persian digits and the Arabic decimal separator, as ASCII. */
export function asciiDecimal(text: string): string {
  return text
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, '.')
    .trim();
}

/** Minor units for a user-entered major amount, or null when it is not a valid amount. */
export function parseAmount(text: string, currency: string): bigint | null {
  if (!isCurrencyCode(currency) || !text.trim()) return null;
  try {
    return parseMajor(text, currency).minor;
  } catch {
    return null;
  }
}

export const FX_SOURCE_LABEL_KEYS: Record<string, string> = {
  'aggregator:open.er-api.com': 'sme.fx.source.aggregator',
  manual: 'sme.fx.source.manual',
  'transfer:implied': 'sme.fx.source.transferImplied',
};

/**
 * One key per submission: retries and double clicks reuse it, so the server posts once. A new
 * key is issued after the submission succeeds.
 */
export function useIdempotencyKey(): { current: () => string; rotate: () => void } {
  const key = useRef<string | null>(null);
  return {
    current: () => (key.current ??= crypto.randomUUID()),
    rotate: () => { key.current = null; },
  };
}

// ── Reference data read through RLS ──────────────────────────

export interface CategoryOption { id: string; code: string; nameEn: string; nameAr: string; kind: CategoryKind }
export interface CounterpartyOption { value: string; label: string; kind: 'company' | 'contact' }

export function useLedgerReferenceData(orgId: string | undefined) {
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [counterparties, setCounterparties] = useState<CounterpartyOption[]>([]);

  useEffect(() => {
    if (!orgId) return;
    let ignore = false;
    Promise.all([
      supabase.from('sme_categories').select('id, code, name_en, name_ar, kind').eq('active', true).order('kind').order('name_en'),
      supabase.from('crm_companies').select('id, name, name_ar').eq('org_id', orgId).order('name').limit(300),
      supabase.from('crm_contacts').select('id, first_name, last_name').eq('org_id', orgId).order('first_name').limit(300),
    ]).then(([cats, companies, contacts]) => {
      if (ignore) return;
      setCategories((cats.data ?? []).map(c => ({ id: c.id, code: c.code, nameEn: c.name_en, nameAr: c.name_ar, kind: c.kind })));
      setCounterparties([
        ...(companies.data ?? []).map(c => ({ value: `company:${c.id}`, label: c.name_ar || c.name, kind: 'company' as const })),
        ...(contacts.data ?? []).map(c => ({ value: `contact:${c.id}`, label: [c.first_name, c.last_name].filter(Boolean).join(' '), kind: 'contact' as const })),
      ]);
    });
    return () => { ignore = true; };
  }, [orgId]);

  return { categories, counterparties };
}

/** Categories a transaction of this source kind may take (mirrors sme_ledger_classify). */
export function allowedCategories(categories: CategoryOption[], sourceKind: string): CategoryOption[] {
  if (sourceKind === 'transfer') return categories.filter(c => c.kind === 'transfer');
  if (sourceKind === 'opening_balance') return categories.filter(c => c.kind === 'opening_balance');
  return categories.filter(c => c.kind !== 'opening_balance');
}

export const CATEGORY_KIND_ORDER: CategoryKind[] = ['income', 'expense', 'owner_equity', 'financing', 'tax', 'transfer', 'opening_balance'];
