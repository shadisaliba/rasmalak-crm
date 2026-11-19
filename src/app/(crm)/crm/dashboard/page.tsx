'use client';

import { CrmDashboard } from '@/components/crm/dashboard/CrmDashboard';
import { FinancialHome } from '@/sme/home/ui/FinancialHome';
import { useSmeEnabled } from '@/sme/ui/useSmeEnabled';

// Blueprint navigation: Home is the financial home (FIN-01) when the finance suite is on.
export default function HomePage() {
  return useSmeEnabled() ? <FinancialHome /> : <CrmDashboard />;
}
