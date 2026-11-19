import { describe, expect, it } from 'vitest';
import { fingerprint, normalizeDescription } from './fingerprint';

const ORG = '00000000-0000-4000-a000-00000000000a';
const ACCOUNT = '11111111-1111-4111-8111-111111111111';

// Produced by sme_normalize_description / sme_fingerprint against the local database.
const VECTORS = [
  { d: 'POS Purchase  CARREFOUR   BAL 1,234.567', date: '2026-11-02', amt: -12500n, ext: null, norm: 'pos purchase carrefour bal', fp: 'e910f755d66dee321d566e5d8d079a8dd738cdcb31b45d9d3e899fa320e83411' },
  { d: 'pos purchase carrefour bal 9,999.000', date: '2026-11-02', amt: -12500n, ext: null, norm: 'pos purchase carrefour bal', fp: 'e910f755d66dee321d566e5d8d079a8dd738cdcb31b45d9d3e899fa320e83411' },
  { d: 'حوالة من أحمد', date: '2026-11-03', amt: 300000n, ext: 'TRX-77', norm: 'حوالة من احمد', fp: '7df2d2b8df378cc9f7b887d2f9d5360b2a6d79a952f5190a6f849caf929d9676' },
  { d: 'حَوالة من احمد', date: '2026-11-03', amt: 300000n, ext: 'TRX-77', norm: 'حوالة من احمد', fp: '7df2d2b8df378cc9f7b887d2f9d5360b2a6d79a952f5190a6f849caf929d9676' },
  { d: 'رسوم ٢٠٢٦ ـ بنك', date: '2026-11-04', amt: -1500n, ext: '', norm: 'رسوم 2026 بنك', fp: '605698baea3d001953e64ad617a87df298e6c04281c695446dff5f6ce6887cc8' },
  { d: 'Salary Nov   2026', date: '2026-11-30', amt: -800000n, ext: null, norm: 'salary nov 2026', fp: '507bf001df0e5d0c60cea5db79aed2e378d7008f39d428852dc185043391caac' },
];

describe('ledger fingerprint', () => {
  it.each(VECTORS)('matches SQL for "$d"', async v => {
    expect(normalizeDescription(v.d)).toBe(v.norm);
    expect(await fingerprint({ orgId: ORG, accountId: ACCOUNT, valueDate: v.date, amountMinor: v.amt, description: v.d, externalRef: v.ext })).toBe(v.fp);
  });

  it('ignores running balances but keeps whole numbers such as years', () => {
    expect(normalizeDescription('Transfer 2026 bal 12.500')).toBe('transfer 2026 bal');
  });

  it('distinguishes different amounts and references', async () => {
    const base = { orgId: ORG, accountId: ACCOUNT, valueDate: '2026-11-02', description: 'x', externalRef: null };
    expect(await fingerprint({ ...base, amountMinor: 1n })).not.toBe(await fingerprint({ ...base, amountMinor: -1n }));
    expect(await fingerprint({ ...base, amountMinor: 1n })).not.toBe(await fingerprint({ ...base, amountMinor: 1n, externalRef: 'r' }));
  });
});
