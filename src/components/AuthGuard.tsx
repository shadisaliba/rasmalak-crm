'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useIntl } from 'react-intl';
import { useIsAuthenticated } from '@/store/useStore';
import { HOME_ROUTE, withNext } from '@/lib/routes';

const PUBLIC_ROUTES = ['/login', '/signup', '/forgot-password'];

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const DEV_BYPASS_AUTH = process.env.NODE_ENV === 'development';

  const router = useRouter();
  const pathname = usePathname();
  const isAuthenticated = useIsAuthenticated();
  const intl = useIntl();
  const [isChecking, setIsChecking] = useState(!DEV_BYPASS_AUTH);

  useEffect(() => {
    if (DEV_BYPASS_AUTH) return;
    // Small delay to ensure store is hydrated
    const timer = setTimeout(() => {
      setIsChecking(false);
      const isPublicRoute = PUBLIC_ROUTES.includes(pathname);

      if (!isAuthenticated && !isPublicRoute) {
        router.replace(withNext('/login', pathname));
      } else if (isAuthenticated && isPublicRoute) {
        router.replace(HOME_ROUTE);
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [DEV_BYPASS_AUTH, isAuthenticated, pathname, router]);

  // Show loading while checking auth
  if (!DEV_BYPASS_AUTH && (isChecking || (!isAuthenticated && !PUBLIC_ROUTES.includes(pathname)))) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg-primary)]">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-[var(--color-text-secondary)]">{intl.formatMessage({ id: 'common.loading' })}</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

