import { z } from 'zod';
import { RULE_CODES } from '../domain/types';

export const listQuery = z.object({
  view: z.enum(['open', 'snoozed', 'done']).default('open'),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export const decisionBody = z.object({
  decision: z.enum(['snooze', 'resolve', 'dismiss', 'reopen']),
  snooze_until: z.iso.datetime({ offset: true }).optional(),
  reason: z.string().trim().max(500).optional(),
});
export const taskBody = z.object({ title: z.string().trim().min(1).max(200), due_date: z.iso.datetime({ offset: true }).optional() });
export const reminderBody = z.object({ contact_id: z.uuid(), language: z.enum(['ar', 'en']) });
export const settingsBody = z.object({
  rule_code: z.enum(RULE_CODES),
  enabled: z.boolean(),
  params: z.record(z.string().regex(/^[a-z_]{1,40}$/), z.number().int().min(0).max(3650)),
});
