import Stripe from 'stripe';

let client: Stripe | null = null;

// Built on first use, not at import, so builds and deployments without Stripe configured still succeed.
export function getStripe(): Stripe {
  if (!client) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
    client = new Stripe(key, { apiVersion: '2024-12-18.acacia' as Stripe.LatestApiVersion });
  }
  return client;
}
