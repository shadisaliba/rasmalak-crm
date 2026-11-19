// Ported from the consumer app's src/lib/fx (playbook Appendix B.3). Differences: rates are
// decimal strings, never floats; only the CBJ seam and the aggregator remain; and no rate is
// ever relabelled with a source it did not come from (W2-05 step 3).

/** Values stored in fx_rates.source and sme_transactions.fx_source. */
export const FX_SOURCES = ['aggregator:open.er-api.com', 'manual', 'transfer:implied'] as const;
export type FxSource = (typeof FX_SOURCES)[number];

/** 1 unit of `fromCurrency` = `rate` units of `toCurrency`. */
export interface FxRate {
  /** ISO date the source published the rate for. */
  date: string;
  fromCurrency: string;
  toCurrency: string;
  /** Decimal string with at most 12 decimal places, matching numeric(24,12). */
  rate: string;
  source: FxSource;
}

export interface FxProvider {
  id: string;
  /** Stored as the rate's source; must describe where the number actually came from. */
  source: FxSource;
  /** False until the provider has a real parser behind it. */
  available: boolean;
  /** Rates for 1 unit of `base` in every currency the provider publishes, for today. */
  fetchLatest(base: string, fetchImpl?: typeof fetch): Promise<FxRate[]>;
}
