'use client';

import { use } from 'react';
import { CompanyDetail } from '@/components/crm/companies/CompanyDetail';

export default function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <CompanyDetail companyId={id} />;
}
