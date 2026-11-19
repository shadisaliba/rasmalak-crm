'use client';

import { useOrg } from '@/store/orgStore';
import { useBilling } from '@/store/billingStore';

/**
 * Mirrors sme_enabled() for showing or hiding SME screens. The database check is the one that
 * protects data; this only decides what to render.
 */
export function useSmeEnabled(): boolean {
  const { currentOrg } = useOrg();
  const { hasFeature } = useBilling();
  // Demo organizations carry the suite without a subscription, as sme_enabled() does.
  return currentOrg?.country === 'JO' && (currentOrg.isDemo || hasFeature('sme_suite'));
}
