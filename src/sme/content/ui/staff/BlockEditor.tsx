'use client';

import type { CSSProperties } from 'react';
import { input, secondaryButton } from '@/sme/ledger/ui/shared';
import type { Block, QuizQuestion, Section } from '@/sme/content/types';
import { useLearnText } from '../text';

const BLOCK_TYPES: Block['type'][] = ['p', 'ul', 'key_insight', 'example', 'comparison', 'action_prompt', 'checkpoint'];
const label: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', fontWeight: 500, color: 'var(--ds-text-body)' };
const small: CSSProperties = { ...secondaryButton, padding: '4px 8px', fontSize: '12px' };

// Lists are edited one item per line. Empty lines are kept while typing and dropped on save.
const lines = (v: string) => v.split('\n');
const joined = (v: string[] | undefined) => (v ?? []).join('\n');

function blank(type: Block['type']): Block {
  switch (type) {
    case 'p': return { type, text: '' };
    case 'ul': return { type, items: [''] };
    case 'key_insight': return { type, title: '', text: '' };
    case 'example': return { type, title: '', rows: [{ label: '', value: '' }] };
    case 'comparison': return { type, leftTitle: '', rightTitle: '', leftItems: [''], rightItems: [''] };
    case 'action_prompt': return { type, text: '' };
    case 'checkpoint': return { type, title: '', items: [''] };
  }
}

/** Drops empty list lines and empty optional fields before validation and saving. */
export function cleanSections(sections: Section[]): Section[] {
  const keep = (v: string[] | undefined) => (v ?? []).map(s => s.trim()).filter(Boolean);
  return sections.map(s => ({
    ...s,
    blocks: s.blocks.map((b): Block => {
      switch (b.type) {
        case 'ul': return { ...b, items: keep(b.items) };
        case 'example': return { ...b, title: b.title?.trim() || undefined, rows: b.rows.filter(r => r.label.trim() || r.value.trim()) };
        case 'comparison': return { ...b, leftItems: keep(b.leftItems), rightItems: keep(b.rightItems) };
        case 'checkpoint': {
          const items = keep(b.items);
          return { type: 'checkpoint', title: b.title?.trim() || undefined, items: items.length ? items : undefined, quiz: b.quiz?.length ? b.quiz : undefined };
        }
        default: return b;
      }
    }),
  }));
}

export function BlockEditor({ sections, onChange, dir }: { sections: Section[]; onChange: (s: Section[]) => void; dir: 'rtl' | 'ltr' }) {
  const T = useLearnText();
  const setSection = (i: number, s: Section) => onChange(sections.map((x, n) => (n === i ? s : x)));
  const move = <X,>(list: X[], from: number, to: number) => {
    if (to < 0 || to >= list.length) return list;
    const next = [...list];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    return next;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }} dir={dir}>
      {sections.map((section, si) => (
        <fieldset key={section.id} style={{ border: '0.5px solid var(--ds-border)', borderRadius: '12px', padding: '12px', margin: 0, display: 'flex', flexDirection: 'column', gap: '10px', minWidth: 0 }}>
          <legend style={{ fontSize: '12px', fontWeight: 600, padding: '0 4px' }}>{T.t('learn.staff.section', { n: T.number(si + 1) })}</legend>
          <label style={label}>{T.t('learn.staff.sectionTitle')}
            <input value={section.title} onChange={e => setSection(si, { ...section, title: e.target.value })} style={input} />
          </label>
          {section.blocks.map((block, bi) => (
            <div key={bi} style={{ borderInlineStart: '3px solid var(--ds-border-tinted)', paddingInlineStart: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                <strong style={{ fontSize: '12px', flex: 1 }}>{T.t(`learn.staff.block.${block.type}`)}</strong>
                <button type="button" style={small} onClick={() => setSection(si, { ...section, blocks: move(section.blocks, bi, bi - 1) })} aria-label={T.t('learn.staff.moveUp')}>↑</button>
                <button type="button" style={small} onClick={() => setSection(si, { ...section, blocks: move(section.blocks, bi, bi + 1) })} aria-label={T.t('learn.staff.moveDown')}>↓</button>
                <button type="button" style={small} onClick={() => setSection(si, { ...section, blocks: section.blocks.filter((_, n) => n !== bi) })}>{T.t('learn.staff.remove')}</button>
              </div>
              <BlockFields block={block} onChange={b => setSection(si, { ...section, blocks: section.blocks.map((x, n) => (n === bi ? b : x)) })} />
            </div>
          ))}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
            <select aria-label={T.t('learn.staff.addBlock')} value="" onChange={e => { if (e.target.value) setSection(si, { ...section, blocks: [...section.blocks, blank(e.target.value as Block['type'])] }); }}
              style={{ ...input, width: 'auto' }}>
              <option value="">{T.t('learn.staff.addBlock')}</option>
              {BLOCK_TYPES.map(t => <option key={t} value={t}>{T.t(`learn.staff.block.${t}`)}</option>)}
            </select>
            <button type="button" style={small} onClick={() => onChange(sections.filter((_, n) => n !== si))}>{T.t('learn.staff.removeSection')}</button>
          </div>
        </fieldset>
      ))}
      <button type="button" style={{ ...secondaryButton, alignSelf: 'flex-start' }}
        onClick={() => onChange([...sections, { id: `s${Date.now().toString(36)}`, title: '', blocks: [] }])}>{T.t('learn.staff.addSection')}</button>
    </div>
  );
}

function BlockFields({ block, onChange }: { block: Block; onChange: (b: Block) => void }) {
  const T = useLearnText();
  const area = (value: string, set: (v: string) => void, key: string, rows = 3) => (
    <label style={label}>{T.t(key)}<textarea value={value} rows={rows} onChange={e => set(e.target.value)} style={{ ...input, resize: 'vertical' }} /></label>
  );
  const line = (value: string, set: (v: string) => void, key: string) => (
    <label style={label}>{T.t(key)}<input value={value} onChange={e => set(e.target.value)} style={input} /></label>
  );
  switch (block.type) {
    case 'p':
    case 'action_prompt':
      return area(block.text, text => onChange({ ...block, text }), 'learn.staff.field.text', 4);
    case 'ul':
      return area(joined(block.items), v => onChange({ ...block, items: lines(v) }), 'learn.staff.field.items');
    case 'key_insight':
      return <>{line(block.title, title => onChange({ ...block, title }), 'learn.staff.field.title')}{area(block.text, text => onChange({ ...block, text }), 'learn.staff.field.text')}</>;
    case 'example':
      return (
        <>
          {line(block.title ?? '', title => onChange({ ...block, title }), 'learn.staff.field.titleOptional')}
          {area(block.rows.map(r => (r.label || r.value ? `${r.label} | ${r.value}` : '')).join('\n'),
            v => onChange({ ...block, rows: lines(v).map(l => { const [a, ...b] = l.split('|'); return { label: a?.trim() ?? '', value: b.join('|').trim() }; }) }),
            'learn.staff.field.rows')}
        </>
      );
    case 'comparison':
      return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '8px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {line(block.leftTitle, leftTitle => onChange({ ...block, leftTitle }), 'learn.staff.field.leftTitle')}
            {area(joined(block.leftItems), v => onChange({ ...block, leftItems: lines(v) }), 'learn.staff.field.items')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {line(block.rightTitle, rightTitle => onChange({ ...block, rightTitle }), 'learn.staff.field.rightTitle')}
            {area(joined(block.rightItems), v => onChange({ ...block, rightItems: lines(v) }), 'learn.staff.field.items')}
          </div>
        </div>
      );
    case 'checkpoint':
      return (
        <>
          {line(block.title ?? '', title => onChange({ ...block, title }), 'learn.staff.field.titleOptional')}
          {area(joined(block.items), v => onChange({ ...block, items: lines(v) }), 'learn.staff.field.checklist')}
          <QuizFields quiz={block.quiz ?? []} onChange={quiz => onChange({ ...block, quiz })} />
        </>
      );
  }
}

function QuizFields({ quiz, onChange }: { quiz: QuizQuestion[]; onChange: (q: QuizQuestion[]) => void }) {
  const T = useLearnText();
  const set = (i: number, q: QuizQuestion) => onChange(quiz.map((x, n) => (n === i ? q : x)));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {quiz.map((q, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '8px', borderRadius: '8px', background: 'var(--ds-bg-tinted)' }}>
          <label style={label}>{T.t('learn.staff.quiz.question', { n: T.number(i + 1) })}<input value={q.question} onChange={e => set(i, { ...q, question: e.target.value })} style={input} /></label>
          <label style={label}>{T.t('learn.staff.quiz.options')}
            <textarea rows={3} value={q.options.map(o => `${o.correct ? '* ' : ''}${o.text}`).join('\n')} style={{ ...input, resize: 'vertical' }}
              onChange={e => set(i, { ...q, options: lines(e.target.value).map(l => (l.startsWith('*') ? { text: l.replace(/^\*\s?/, ''), correct: true } : { text: l })) })} />
          </label>
          <label style={label}>{T.t('learn.staff.quiz.explanation')}<input value={q.explanation} onChange={e => set(i, { ...q, explanation: e.target.value })} style={input} /></label>
          <button type="button" style={{ ...small, alignSelf: 'flex-start' }} onClick={() => onChange(quiz.filter((_, n) => n !== i))}>{T.t('learn.staff.remove')}</button>
        </div>
      ))}
      <button type="button" style={{ ...small, alignSelf: 'flex-start' }}
        onClick={() => onChange([...quiz, { question: '', options: [{ text: '', correct: true }, { text: '' }], explanation: '' }])}>{T.t('learn.staff.quiz.add')}</button>
    </div>
  );
}
