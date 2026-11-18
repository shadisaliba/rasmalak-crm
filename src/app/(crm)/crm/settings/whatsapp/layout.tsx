'use client';

import { WhatsAppProvider } from '@/store/whatsappStore';

export default function WhatsAppSettingsLayout({ children }: { children: React.ReactNode }) {
  return <WhatsAppProvider>{children}</WhatsAppProvider>;
}
