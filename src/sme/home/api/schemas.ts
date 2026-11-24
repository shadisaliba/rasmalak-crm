import { z } from 'zod';

export const dueQuery = z.object({ days: z.coerce.number().int().min(1).max(90).default(14) });
export const trackBody = z.object({
  event: z.string().regex(/^[A-Z][A-Za-z]{2,60}$/),
  props: z.record(z.string().regex(/^[a-z_]{1,40}$/), z.union([z.boolean(), z.string().regex(/^[a-z0-9_.:-]{1,64}$/)])).default({}),
});
