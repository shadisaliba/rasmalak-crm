import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { aggregatorProvider, toRateString } from './providers/aggregator';
import { cbjProvider } from './providers/cbj';
import { refreshRatesToBase } from './rates';

const response = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => body }) as Response;

describe('fx aggregator', () => {
  it('returns decimal-string rates labelled with their real source', async () => {
    const fetchImpl = vi.fn(async () => response({ result: 'success', base_code: 'USD', time_last_update_unix: 1795046400, rates: { USD: 1, JOD: 0.709, EUR: 0.92 } }));
    const rates = await aggregatorProvider.fetchLatest('USD', fetchImpl as unknown as typeof fetch);
    expect(rates).toContainEqual({ date: '2026-11-19', fromCurrency: 'USD', toCurrency: 'JOD', rate: '0.709', source: 'aggregator:open.er-api.com' });
    expect(rates.some(r => r.toCurrency === 'USD')).toBe(false);
  });

  it('rejects a response for a different base', async () => {
    const fetchImpl = vi.fn(async () => response({ result: 'success', base_code: 'EUR', rates: { JOD: 0.77 } }));
    await expect(aggregatorProvider.fetchLatest('USD', fetchImpl as unknown as typeof fetch)).rejects.toThrow();
  });

  it('rounds to the 12 decimal places the database stores', () => {
    expect(toRateString(0.0005432109876543)).toBe('0.000543210988');
    expect(toRateString(0)).toBeNull();
    expect(toRateString(Number.NaN)).toBeNull();
  });
});

describe('fx refresh', () => {
  it('never stores a central-bank label while the CBJ provider has no parser', async () => {
    expect(cbjProvider.available).toBe(false);
    const upsert = vi.fn(async () => ({ error: null }));
    const db = { from: () => ({ upsert }) } as unknown as SupabaseClient;
    const fetchImpl = vi.fn(async (url: string) => response({ result: 'success', base_code: url.split('/').pop(), rates: { JOD: 0.709 } }));
    const result = await refreshRatesToBase(db, ['JOD', 'USD', 'EUR'], { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result).toEqual({ stored: 2, errors: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const rows = (upsert.mock.calls[0] as unknown as [Array<{ source: string; to_currency: string }>])[0];
    expect(rows.every(r => r.source === 'aggregator:open.er-api.com' && r.to_currency === 'JOD')).toBe(true);
  });

  it('reports failures and keeps the rates it did get', async () => {
    const upsert = vi.fn(async () => ({ error: null }));
    const db = { from: () => ({ upsert }) } as unknown as SupabaseClient;
    const fetchImpl = vi.fn(async (url: string) => url.endsWith('/EUR') ? response({}, false) : response({ result: 'success', base_code: 'USD', rates: { JOD: 0.709 } }));
    const result = await refreshRatesToBase(db, ['USD', 'EUR'], { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.stored).toBe(1);
    expect(result.errors).toEqual([{ currency: 'EUR', message: 'aggregator: aggregator: HTTP 503' }]);
  });
});
