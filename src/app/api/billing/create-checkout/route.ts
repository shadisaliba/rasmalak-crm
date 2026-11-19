/**
 * Create Stripe Checkout Session
 * ===============================
 * Creates a checkout session for new subscriptions.
 */

import { NextResponse } from 'next/server';
import { getStripe } from '@/lib/stripe';
import { requireBillingAdmin } from '../_auth';


const PRICE_MAP: Record<string, string | undefined> = {
  'entrepreneur_monthly': process.env.STRIPE_PRICE_ENTREPRENEUR_MONTHLY,
  'entrepreneur_annual': process.env.STRIPE_PRICE_ENTREPRENEUR_ANNUAL,
  'organization_monthly': process.env.STRIPE_PRICE_ORGANIZATION_MONTHLY,
  'organization_annual': process.env.STRIPE_PRICE_ORGANIZATION_ANNUAL,
  'enterprise_monthly': process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY,
  'enterprise_annual': process.env.STRIPE_PRICE_ENTERPRISE_ANNUAL,
};

export async function POST(request: Request) {
  try {
    const { orgId, plan, billingCycle } = await request.json();
    if (!orgId || !plan || !billingCycle) {
      return NextResponse.json({ error: { code: 'INVALID_INPUT', message: 'Missing required fields' } }, { status: 400 });
    }

    const auth = await requireBillingAdmin(request, orgId);
    if ('error' in auth) return auth.error;
    const { supabase } = auth;

    const priceId = PRICE_MAP[`${plan}_${billingCycle}`];
    if (!priceId) {
      return NextResponse.json({ error: { code: 'INVALID_PLAN', message: 'Invalid plan or billing cycle' } }, { status: 400 });
    }

    // Reuse the organization's Stripe customer. Billing rows are written only by the Stripe
    // webhook, which links the customer to the organization through its metadata.
    const { data: sub } = await supabase.from('subscriptions').select('stripe_customer_id').eq('org_id', orgId).maybeSingle();
    let customerId = sub?.stripe_customer_id as string | undefined;
    if (!customerId) {
      const existing = await getStripe().customers.search({ query: `metadata['org_id']:'${orgId}'`, limit: 1 });
      customerId = existing.data[0]?.id;
    }
    if (!customerId) {
      const { data: org } = await supabase.from('organizations').select('name').eq('id', orgId).maybeSingle();
      const customer = await getStripe().customers.create({ metadata: { org_id: orgId }, name: org?.name || undefined });
      customerId = customer.id;
    }

    const session = await getStripe().checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { trial_period_days: 14, metadata: { org_id: orgId } },
      success_url: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/crm/settings/billing?success=true`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/crm/settings/billing?canceled=true`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.warn('[Billing] Checkout error:', err);
    return NextResponse.json({ error: { code: 'CHECKOUT_FAILED', message: 'Failed to create checkout session' } }, { status: 500 });
  }
}
