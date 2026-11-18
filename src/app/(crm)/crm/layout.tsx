'use client';

import { usePathname } from 'next/navigation';
import { OrgGuard } from '@/components/crm/OrgGuard';
import { CrmProvider } from '@/store/crmStore';
import { BillingProvider } from '@/store/billingStore';
import { CrmShell } from '@/components/crm/layout/CrmShell';
import { isOrgOptionalRoute } from '@/lib/routes';

/**
 * Wraps /crm/* pages in the organization guard, CRM data and shell.
 * Organization setup and invitation acceptance are exempt: a user without an
 * organization must reach them, and OrgGuard would redirect them away.
 */
export default function CrmPagesLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (isOrgOptionalRoute(pathname)) return <>{children}</>;

  return (
    <OrgGuard>
      <BillingProvider>
        <CrmProvider>
          <CrmShell>
            {children}
          </CrmShell>
        </CrmProvider>
      </BillingProvider>
    </OrgGuard>
  );
}
