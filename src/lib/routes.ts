export const HOME_ROUTE = '/crm/dashboard';
export const ORG_SETUP_ROUTE = '/crm/setup';
export const INVITE_ROUTE_PREFIX = '/crm/invite/';

// Routes under /crm that a signed-in user without an organization must still reach.
export function isOrgOptionalRoute(pathname: string): boolean {
  return pathname === ORG_SETUP_ROUTE || pathname.startsWith(INVITE_ROUTE_PREFIX);
}

// Only same-site CRM paths are accepted, so a crafted link cannot bounce a user to another site.
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith('/crm/')) return null;
  if (raw.startsWith('//') || raw.includes('\\') || raw.includes('://')) return null;
  return raw;
}

export function nextPathFromLocation(): string | null {
  if (typeof window === 'undefined') return null;
  return safeNextPath(new URLSearchParams(window.location.search).get('next'));
}

export function withNext(path: string, next: string): string {
  return `${path}?next=${encodeURIComponent(next)}`;
}
