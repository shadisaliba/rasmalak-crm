import { z } from 'zod';
import { contentBodySchema } from '../schema';

export const localeParam = z.enum(['ar', 'en']);

export const listLessonsQuery = z.object({
  locale: localeParam.default('ar'),
  q: z.string().trim().max(100).optional(),
  level: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
  topic: z.string().regex(/^[a-z0-9_-]{1,60}$/).optional(),
});

export const lessonQuery = z.object({ locale: localeParam.default('ar') });

export const progressBody = z.object({
  version_id: z.string().uuid(),
  section_id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/).optional(),
  completed: z.boolean().optional(),
  quiz_score: z.number().min(0).max(100).optional(),
});

export const feedbackBody = z.object({
  version_id: z.string().uuid(),
  useful: z.boolean(),
  comment: z.string().trim().max(1000).optional(),
});

// ── Staff ───────────────────────────────────────────────────

const tag = z.string().regex(/^[a-z0-9_-]{1,60}$/);

export const createItemBody = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9_-]{2,120}$/),
  kind: z.enum(['lesson', 'checklist', 'playbook', 'notice']),
  regulated: z.boolean(),
  level: z.enum(['beginner', 'intermediate', 'advanced']).nullable().optional(),
  topic_tags: z.array(tag).max(20).default([]),
  competency_tags: z.array(tag).max(20).default([]),
});

export const draftBody = z.object({
  locale: localeParam,
  draft: z.object({
    title: z.string().trim().min(1).max(200),
    summary: z.string().trim().min(1).max(600),
    body: contentBodySchema,
    est_minutes: z.number().int().min(3).max(7).nullable().optional(),
    valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    valid_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    external_sources: z.array(z.object({ url: z.string().url().max(500), title: z.string().trim().min(1).max(200), retrieved_at: z.string().max(40).optional() })).max(20).default([]),
    legal_source_ids: z.array(z.string().uuid()).max(20).default([]),
    change_note: z.string().trim().max(500).nullable().optional(),
  }),
});

export const reviewBody = z.object({
  decision: z.enum(['approve', 'request_changes']),
  note: z.string().trim().max(2000).optional(),
});
