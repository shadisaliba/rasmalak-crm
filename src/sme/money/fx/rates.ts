import type { SupabaseClient } from '@supabase/supabase-js';
import type { FxProvider, FxRate, FxSource } from './types';
import { aggregatorProvider, cbjProvider } from './providers';

export const BASE_CURRENCY = 'JOD';

export interface FxQuote {
  currency: string;
  rate: string;
  rateDate: string;
  source: FxSource;
  /** The stored rate is for an earlier day than the one asked for. */
  stale: boolean;
}

/** The stored rate for currency → JOD on or before `date`. Reads only; works with any client. */
export async function quoteToBase(db: SupabaseClient, currency: string, date: string): Promise<FxQuote | null> {
  if (currency === BASE_CURRENCY) return null;
  const { data, error } = await db
    .from('fx_rates')
    .select('date, rate, source')
    .eq('from_currency', currency)
    .eq('to_currency', BASE_CURRENCY)
    .lte('date', date)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return { currency, rate: String(data.rate), rateDate: data.date, source: data.source, stale: data.date < date };
}

export interface RefreshResult {
  stored: number;
  errors: Array<{ currency: string; message: string }>;
}

/**
 * Fetches today's rate to JOD for each currency, as the provider published it for that base,
 * and upserts fx_rates. Runs in the cron with the service role; the only writer of fx_rates.
 */
export async function refreshRatesToBase(
  serviceDb: SupabaseClient,
  currencies: readonly string[],
  options: { providers?: FxProvider[]; fetchImpl?: typeof fetch } = {},
): Promise<RefreshResult> {
  const providers = (options.providers ?? [cbjProvider, aggregatorProvider]).filter(p => p.available);
  const rows: FxRate[] = [];
  const errors: RefreshResult['errors'] = [];

  for (const currency of currencies) {
    if (currency === BASE_CURRENCY) continue;
    let found: FxRate | undefined;
    for (const provider of providers) {
      try {
        found = (await provider.fetchLatest(currency, options.fetchImpl)).find(r => r.toCurrency === BASE_CURRENCY);
        if (found) break;
      } catch (err) {
        errors.push({ currency, message: `${provider.id}: ${(err as Error).message}` });
      }
    }
    if (found) rows.push(found);
  }

  if (rows.length) {
    const { error } = await serviceDb.from('fx_rates').upsert(
      rows.map(r => ({ date: r.date, from_currency: r.fromCurrency, to_currency: r.toCurrency, rate: r.rate, source: r.source, fetched_at: new Date().toISOString() })),
      { onConflict: 'date,from_currency,to_currency' },
    );
    if (error) throw new Error(`fx_rates upsert failed: ${error.message}`);
  }
  return { stored: rows.length, errors };
}
