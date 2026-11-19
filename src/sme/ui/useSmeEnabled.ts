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
  return currentOrg?.country === 'JO' && hasFeature('sme_suite');
}
