export const HOME_ROUTE = '/crm/dashboard';
export const ORG_SETUP_ROUTE = '/crm/setup';

// Routes under /crm that a signed-in user without an organization must still reach.
export const ORG_OPTIONAL_ROUTES = [ORG_SETUP_ROUTE];
