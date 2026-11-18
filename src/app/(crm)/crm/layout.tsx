'use client';

import { usePathname } from 'next/navigation';
import { OrgGuard } from '@/components/crm/OrgGuard';
import { CrmProvider } from '@/store/crmStore';
import { CrmShell } from '@/components/crm/layout/CrmShell';
import { ORG_OPTIONAL_ROUTES } from '@/lib/routes';

/**
 * Wraps /crm/* pages in the organization guard, CRM data and shell.
 * Organization setup is exempt: OrgGuard would otherwise redirect a user
 * with no organization to the very page they are already on.
 */
export default function CrmPagesLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (ORG_OPTIONAL_ROUTES.includes(pathname)) return <>{children}</>;

  return (
    <OrgGuard>
      <CrmProvider>
        <CrmShell>
          {children}
        </CrmShell>
      </CrmProvider>
    </OrgGuard>
  );
}
