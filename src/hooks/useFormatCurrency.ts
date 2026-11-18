'use client';

import { useCallback } from 'react';
import { useIntl } from 'react-intl';
import { useOrg } from '@/store/orgStore';
import { formatCurrency } from '@/lib/utils';
import { DEFAULT_CURRENCY } from '@/lib/constants';
import type { FormatMoneyOptions, UiLocale } from '@/sme/money';

/** Formats CRM amounts in the UI language, defaulting to the organization's currency. */
type FormatAmount = (amount: number, currency?: string | null, options?: Pick<FormatMoneyOptions, 'wholeUnits'>) => string;

export function useFormatCurrency(): FormatAmount {
  const intl = useIntl();
  const { currentOrg } = useOrg();
  const language: UiLocale = intl.locale.startsWith('ar') ? 'ar' : 'en';
  const fallback = currentOrg?.currency || DEFAULT_CURRENCY;
  return useCallback<FormatAmount>(
    (amount, currency, options) => formatCurrency(amount, currency || fallback, language, options),
    [language, fallback],
  );
}
