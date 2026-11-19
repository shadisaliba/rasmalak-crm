'use client';

import type { ReactNode } from 'react';
import { useIntl } from 'react-intl';
import { useOrgPermission } from '@/store/orgStore';
import type { CrmPermissions } from '@/types/crm';
import { useSmeEnabled } from '@/sme/ui/useSmeEnabled';

const box = { padding: '16px', fontSize: '14px', borderRadius: '12px', background: 'var(--ds-bg-card)', border: '0.5px solid var(--ds-border)', color: 'var(--ds-text-muted)' } as const;

/** Renders children only for SME-enabled organizations and members holding the permission. */
export function SmeGate({ permission, children }: { permission: keyof CrmPermissions; children: ReactNode }) {
  const intl = useIntl();
  const enabled = useSmeEnabled();
  const allowed = useOrgPermission(permission);
  if (!enabled) return <div role="status" style={box}>{intl.formatMessage({ id: 'sme.access.notEnabled' })}</div>;
  if (!allowed) return <div role="alert" style={box}>{intl.formatMessage({ id: 'sme.gate.denied' })}</div>;
  return <>{children}</>;
}
