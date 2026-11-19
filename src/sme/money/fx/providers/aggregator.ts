import Decimal from 'decimal.js';
import type { FxProvider, FxRate } from '../types';

// open.er-api.com: free, keyless, latest rates only. Historical lookups are served from fx_rates
// (on or before the value date), never fetched per request.
const ENDPOINT = 'https://open.er-api.com/v6/latest';

interface OpenErApiResponse {
  result?: 'success' | 'error';
  base_code?: string;
  time_last_update_unix?: number;
  rates?: Record<string, unknown>;
  'error-type'?: string;
}

export function toRateString(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const rounded = new Decimal(value).toDecimalPlaces(12, Decimal.ROUND_HALF_UP);
  return rounded.isZero() ? null : rounded.toFixed();
}

export const aggregatorProvider: FxProvider = {
  id: 'aggregator',
  source: 'aggregator:open.er-api.com',
  available: true,

  async fetchLatest(base, fetchImpl = fetch) {
    const res = await fetchImpl(`${ENDPOINT}/${encodeURIComponent(base)}`, {
      headers: { 'User-Agent': 'crm-fx/1.0' },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`aggregator: HTTP ${res.status}`);
    const json = (await res.json()) as OpenErApiResponse;
    if (json.result !== 'success' || !json.rates || json.base_code !== base) {
      throw new Error(`aggregator: ${json['error-type'] ?? 'unexpected'} response`);
    }
    const date = json.time_last_update_unix
      ? new Date(json.time_last_update_unix * 1000).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    const rates: FxRate[] = [];
    for (const [to, value] of Object.entries(json.rates)) {
      const rate = typeof value === 'number' ? toRateString(value) : null;
      if (rate && to !== base) rates.push({ date, fromCurrency: base, toCurrency: to, rate, source: 'aggregator:open.er-api.com' });
    }
    return rates;
  },
};
