import { redirect } from 'next/navigation';
import { HOME_ROUTE } from '@/lib/routes';

// Rendered per request so the redirect is a real HTTP 307, not a prerendered page.
export const dynamic = 'force-dynamic';

export default function RootPage() {
  redirect(HOME_ROUTE);
}
