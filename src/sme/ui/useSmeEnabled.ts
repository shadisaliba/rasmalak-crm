'use client';

import { useOrg } from '@/store/orgStore';

/**
 * Mirrors sme_enabled() for showing or hiding SME screens. The database check is the one that
 * protects data; this only decides what to render.
 */
export function useSmeEnabled(): boolean {
  const { currentOrg } = useOrg();
  return currentOrg?.country === 'JO';
}
