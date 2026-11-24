import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const periodQuery = z.object({ from: isoDate.optional(), to: isoDate.optional() })
  .refine(p => !p.from === !p.to, { message: 'both_or_neither' })
  .refine(p => !p.from || !p.to || (p.from <= p.to && (Date.parse(p.to) - Date.parse(p.from)) / 86_400_000 <= 400), { message: 'invalid_period' });
