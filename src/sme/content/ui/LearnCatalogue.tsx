'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/store/orgStore';
import { smeApi, errorText, type SmeApiError } from '@/sme/api/client';
import { DataState } from '@/sme/ui/DataState';
import { PageHeader } from '@/sme/ui/PageHeader';
import { SmeGate } from '@/sme/profile/ui/SmeGate';
import { Chip, card, input } from '@/sme/ledger/ui/shared';
import { useLearnText } from './text';

export interface LessonListItem {
  id: string;
  item_id: string;
  title: string;
  summary: string;
  est_minutes: number | null;
  published_at: string;
  content_items: { slug: string; kind: string; level: string | null; topic_tags: string[]; regulated: boolean };
}
interface ProgressRow { item_id: string; completed_at: string | null; last_section_id: string | null }
type Load = { status: 'loading' } | { status: 'failed'; error: SmeApiError } | { status: 'ready'; items: LessonListItem[]; progress: ProgressRow[] };

const LEVELS = ['beginner', 'intermediate', 'advanced'] as const;

/** LRN-01: published lessons in the reader's language, searchable by need, level and topic. */
export function LearnCatalogue() {
  const T = useLearnText();
  const { currentOrg } = useOrg();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [level, setLevel] = useState('');
  const [topic, setTopic] = useState('');
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [topics, setTopics] = useState<string[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!currentOrg) return;
    let ignore = false;
    const params = new URLSearchParams({ locale: T.uiLocale });
    if (debounced) params.set('q', debounced);
    if (level) params.set('level', level);
    if (topic) params.set('topic', topic);
    smeApi<{ items: LessonListItem[]; progress: ProgressRow[] }>(`learn/lessons?${params}`, { orgId: currentOrg.id }).then(r => {
      if (ignore) return;
      if (!r.ok) { setLoad({ status: 'failed', error: r.error }); return; }
      setLoad({ status: 'ready', items: r.data.items, progress: r.data.progress });
      // Topic filters come from the unfiltered list, so choosing one does not hide the others.
      if (!debounced && !level && !topic) setTopics([...new Set(r.data.items.flatMap(i => i.content_items.topic_tags))].sort());
    });
    return () => { ignore = true; };
  }, [currentOrg, debounced, level, topic, T.uiLocale, reloadKey]);

  const done = useMemo(() => new Set(load.status === 'ready' ? load.progress.filter(p => p.completed_at).map(p => p.item_id) : []),
    [load]);
  const started = useMemo(() => new Set(load.status === 'ready' ? load.progress.map(p => p.item_id) : []), [load]);
  const filtering = !!(debounced || level || topic);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <PageHeader title={T.t('learn.title')} description={T.t('learn.description')} />
      <SmeGate permission="sme.learn.use">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
          <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={T.t('learn.search.placeholder')}
            aria-label={T.t('learn.search.label')} style={{ ...input, flex: '2 1 240px', width: 'auto' }} />
          <select value={level} onChange={e => setLevel(e.target.value)} aria-label={T.t('learn.filter.level')} style={{ ...input, flex: '1 1 150px', width: 'auto' }}>
            <option value="">{T.t('learn.filter.allLevels')}</option>
            {LEVELS.map(l => <option key={l} value={l}>{T.t(`learn.level.${l}`)}</option>)}
          </select>
          {topics.length > 0 && (
            <select value={topic} onChange={e => setTopic(e.target.value)} aria-label={T.t('learn.filter.topic')} style={{ ...input, flex: '1 1 150px', width: 'auto' }}>
              <option value="">{T.t('learn.filter.allTopics')}</option>
              {topics.map(tp => <option key={tp} value={tp}>{T.topic(tp)}</option>)}
            </select>
          )}
        </div>
        {load.status === 'loading' && <DataState state="loading" />}
        {load.status === 'failed' && <DataState state="failed" message={errorText(load.error, T.intl.locale)} onRetry={() => { setLoad({ status: 'loading' }); setReloadKey(k => k + 1); }} />}
        {load.status === 'ready' && load.items.length === 0 && (
          <DataState state={filtering ? 'empty' : 'review_needed'} message={T.t(filtering ? 'learn.empty.filtered' : 'learn.empty.none')} />
        )}
        {load.status === 'ready' && load.items.length > 0 && (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))', gap: '12px' }}>
            {load.items.map(item => (
              <li key={item.id}>
                <Link href={`/crm/learn/${item.content_items.slug}`} className="crm-nav-item"
                  style={{ ...card, display: 'flex', flexDirection: 'column', gap: '8px', height: '100%', textDecoration: 'none', color: 'inherit' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {item.content_items.level && <Chip>{T.t(`learn.level.${item.content_items.level}`)}</Chip>}
                    {item.est_minutes && <Chip tone="info">{T.t('learn.minutes', { n: item.est_minutes })}</Chip>}
                    {item.content_items.regulated && <Chip tone="info">{T.t('learn.reviewedGuidance')}</Chip>}
                    {done.has(item.item_id) ? <Chip tone="neutral">{T.t('learn.completed')}</Chip> : started.has(item.item_id) && <Chip tone="info">{T.t('learn.inProgress')}</Chip>}
                  </div>
                  <h2 style={{ fontSize: '15px', fontWeight: 600, margin: 0, color: 'var(--ds-text-heading)' }}>{item.title}</h2>
                  <p style={{ fontSize: '13px', lineHeight: 1.6, margin: 0, color: 'var(--ds-text-muted)' }}>{item.summary}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SmeGate>
    </div>
  );
}
