import { describe, expect, it } from 'vitest';
import { diffLines } from './diff';
import { checklistItems, contentBodySchema } from './schema';

describe('diffLines', () => {
  it('marks added and removed lines around the common ones', () => {
    expect(diffLines('a\nb\nc', 'a\nc\nd')).toEqual([
      { kind: 'same', text: 'a' }, { kind: 'removed', text: 'b' }, { kind: 'same', text: 'c' }, { kind: 'added', text: 'd' },
    ]);
  });
  it('handles empty sides', () => {
    expect(diffLines('', 'x')).toEqual([{ kind: 'removed', text: '' }, { kind: 'added', text: 'x' }]);
  });
});

describe('content body', () => {
  const body = {
    sections: [{
      id: 's1', title: 'Cash', blocks: [
        { type: 'p', text: 'Cash is not profit.' },
        { type: 'action_prompt', text: 'Open a business account.' },
        { type: 'checkpoint', items: ['List your fixed costs'], quiz: [{ question: 'Q', options: [{ text: 'A', correct: true }, { text: 'B' }], explanation: 'E' }] },
      ],
    }],
  };
  it('accepts the ported block schema and lists the checklist in order', () => {
    const parsed = contentBodySchema.parse(body);
    expect(checklistItems(parsed)).toEqual(['Open a business account.', 'List your fixed costs']);
  });
  it('rejects a quiz with no correct option and unknown block types', () => {
    const noCorrect = structuredClone(body);
    (noCorrect.sections[0].blocks[2] as { quiz: { options: { correct?: boolean }[] }[] }).quiz[0].options[0].correct = false;
    expect(contentBodySchema.safeParse(noCorrect).success).toBe(false);
    expect(contentBodySchema.safeParse({ sections: [{ id: 's', title: 't', blocks: [{ type: 'video', url: 'x' }] }] }).success).toBe(false);
  });
});
