/**
 * Change Plan — Upgrade or Downgrade
 * ====================================
 * Updates Stripe subscription to new plan price.
 */

import { NextResponse } from 'next/server';
import { getStripe } from '@/lib/stripe';
import { mapFromDb } from '@/types/crm';
import type { Subscription } from '@/types/crm';
import { requireBillingAdmin } from '../_auth';


const PRICE_MAP: Record<string, string | undefined> = {
  entrepreneur: process.env.STRIPE_PRICE_ENTREPRENEUR_MONTHLY,
  organization: process.env.STRIPE_PRICE_ORGANIZATION_MONTHLY,
  enterprise: process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY,
};

export async function POST(request: Request) {
  try {
    const { orgId, plan } = await request.json();
    if (!orgId || !plan) {
      return NextResponse.json({ error: { code: 'INVALID_INPUT', message: 'Missing orgId or plan' } }, { status: 400 });
    }

    const auth = await requireBillingAdmin(request, orgId);
    if ('error' in auth) return auth.error;
    const { supabase } = auth;

    const newPriceId = PRICE_MAP[plan];
    if (!newPriceId) {
      return NextResponse.json({ error: { code: 'INVALID_PLAN', message: 'Invalid plan' } }, { status: 400 });
    }

    const { data: subRow } = await supabase.from('subscriptions').select('*').eq('org_id', orgId).single();
    if (!subRow) return NextResponse.json({ error: { code: 'NO_SUB', message: 'No subscription' } }, { status: 404 });

    const sub = mapFromDb<Subscription>(subRow);

    // Changing plan without a Stripe subscription would hand out a paid plan for free.
    if (!sub.stripeSubscriptionId) {
      return NextResponse.json({ error: { code: 'NO_STRIPE_SUB', message: 'Start a subscription through checkout first' } }, { status: 400 });
    }
    const stripeSub = await getStripe().subscriptions.retrieve(sub.stripeSubscriptionId);
    const mainItem = stripeSub.items.data[0];
    if (!mainItem) {
      return NextResponse.json({ error: { code: 'NO_STRIPE_SUB', message: 'Subscription has no plan item' } }, { status: 400 });
    }
    await getStripe().subscriptions.update(sub.stripeSubscriptionId, {
      items: [{ id: mainItem.id, price: newPriceId }],
      proration_behavior: 'create_prorations',
    });

    // The customer.subscription.updated webhook records the new plan and seat limits.
    return NextResponse.json({ data: { plan, pending: true } });
  } catch (err) {
    console.warn('[Billing] Change plan error:', err);
    return NextResponse.json({ error: { code: 'CHANGE_FAILED', message: 'Failed to change plan' } }, { status: 500 });
  }
}
