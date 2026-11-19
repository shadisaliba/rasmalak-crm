import type { FxProvider } from '../types';

// Central Bank of Jordan. cbj.gov.jo has no documented feed and no parser exists yet. The donor
// delegated to the aggregator and relabelled its rates as central-bank rates; that is removed.
// When a real parser lands, add 'cbj' to FX_SOURCES and to the accepted sources in
// sme_ledger_insert, and set available to true.
export const cbjProvider: FxProvider = {
  id: 'cbj',
  source: 'aggregator:open.er-api.com',
  available: false,
  async fetchLatest() {
    throw new Error('cbj: no parser yet');
  },
};
