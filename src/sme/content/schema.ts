import { z } from 'zod';
import type { Block, Section } from './types';

// The block schema of the ported viewer (types.ts), as stored in content_versions.body.
const text = z.string().trim().min(1).max(4000);
const short = z.string().trim().min(1).max(200);
const items = z.array(text).min(1).max(40);

const block = z.discriminatedUnion('type', [
  z.object({ type: z.literal('p'), text }),
  z.object({ type: z.literal('ul'), items }),
  z.object({ type: z.literal('key_insight'), title: short, text }),
  z.object({ type: z.literal('example'), title: short.optional(), rows: z.array(z.object({ label: short, value: short })).min(1).max(40) }),
  z.object({ type: z.literal('comparison'), leftTitle: short, rightTitle: short, leftItems: items, rightItems: items }),
  z.object({ type: z.literal('action_prompt'), text }),
  z.object({
    type: z.literal('checkpoint'),
    title: short.optional(),
    items: items.optional(),
    quiz: z.array(z.object({
      question: text,
      options: z.array(z.object({ text: short, correct: z.boolean().optional() })).min(2).max(6)
        .refine(o => o.some(x => x.correct), 'one option must be correct'),
      explanation: text,
    })).max(10).optional(),
  }),
]) satisfies z.ZodType<Block>;

export const sectionSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  title: short,
  blocks: z.array(block).max(60),
}) satisfies z.ZodType<Section>;

export const contentBodySchema = z.object({ sections: z.array(sectionSchema).max(20) });
export type ContentBody = z.infer<typeof contentBodySchema>;

/** Items a reader can tick off: checkpoint lists and action prompts, in order (LRN-02 checklist). */
export function checklistItems(body: ContentBody): string[] {
  return body.sections.flatMap(s => s.blocks.flatMap(b => {
    if (b.type === 'checkpoint' && b.items) return b.items;
    if (b.type === 'action_prompt') return [b.text];
    return [];
  }));
}
