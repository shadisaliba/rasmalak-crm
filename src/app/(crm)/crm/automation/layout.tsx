'use client';

import { AutomationProvider } from '@/store/automationStore';

export default function AutomationLayout({ children }: { children: React.ReactNode }) {
  return <AutomationProvider>{children}</AutomationProvider>;
}
