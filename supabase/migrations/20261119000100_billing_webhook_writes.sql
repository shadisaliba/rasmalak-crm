-- ============================================================
-- BILLING: only the Stripe webhook writes billing state
-- ============================================================
-- Owners and admins could previously write their own subscription row, including the plan,
-- straight from the browser. SME access (sme_enabled) depends on the plan, so the plan must come
-- only from Stripe: the signed webhook writes with the service role; members read.

drop policy "Org owner/admin can manage subscription" on subscriptions;
drop policy "Org owner/admin can manage payment methods" on payment_methods;
