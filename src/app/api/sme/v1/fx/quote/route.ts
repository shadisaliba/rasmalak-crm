import { z } from 'zod';
import { parseQuery, smeRoute } from '@/sme/api/route';
import { isoDate } from '@/sme/ledger/api/schemas';
import { quoteToBase } from '@/sme/money/fx';
import { CURRENCY_CODES } from '@/sme/money';

const query = z.object({ currency: z.enum(CURRENCY_CODES as [string, ...string[]]), date: isoDate });

// Reads stored rates only; the refresh cron is the one place that fetches and writes them.
export const GET = smeRoute(async ({ request, db }) => {
  const { currency, date } = parseQuery(request, query);
  return { body: { quote: await quoteToBase(db, currency, date) } };
});
