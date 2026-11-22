'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { smeApi, errorText, type SmeApiError } from '@/sme/api/client';
import { DataState } from '@/sme/ui/DataState';
import { PageHeader } from '@/sme/ui/PageHeader';
import { Chip, FormError, card, input, primaryButton, secondaryButton } from '@/sme/ledger/ui/shared';
import { useLearnText } from '../text';
import { STATE_TONE, type VersionState } from './ContentEditor';

interface ListItem {
  id: string; slug: string; kind: string; regulated: boolean; level: string | null; topic_tags: string[];
  content_versions: { id: string; locale: 'ar' | 'en'; version: number; state: VersionState; title: string }[];
}
const FILTERS: Array<VersionState | ''> = ['', 'in_review', 'changes_requested', 'draft', 'approved', 'published'];
const cell: CSSProperties = { padding: '8px 10px', textAlign: 'start', borderBlockEnd: '0.5px solid var(--ds-border)', verticalAlign: 'top' };

/** Staff content register: what is waiting for review, drafts and published lessons. */
export function StaffContentList() {
  const T = useLearnText();
  const router = useRouter();
  const [load, setLoad] = useState<{ status: 'loading' } | { status: 'failed'; error: SmeApiError } | { status: 'ready'; items: ListItem[] }>({ status: 'loading' });
  const [filter, setFilter] = useState<VersionState | ''>('in_review');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ slug: '', kind: 'lesson', level: '', regulated: false, tags: '' });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    smeApi<{ items: ListItem[] }>('/api/staff/v1/content', {}).then(r => {
      if (!ignore) setLoad(r.ok ? { status: 'ready', items: r.data.items } : { status: 'failed', error: r.error });
    });
    return () => { ignore = true; };
  }, []);

  const latest = (item: ListItem, locale: 'ar' | 'en') =>
    item.content_versions.filter(v => v.locale === locale).sort((a, b) => b.version - a.version)[0];
  const items = load.status === 'ready'
    ? load.items.filter(i => !filter || (['ar', 'en'] as const).some(l => latest(i, l)?.state === filter))
    : [];

  const create = async () => {
    setError(null);
    const r = await smeApi<{ id: string }>('/api/staff/v1/content', {
      method: 'POST',
      body: { slug: form.slug.trim(), kind: form.kind, regulated: form.regulated, level: form.level || null,
        topic_tags: form.tags.split(',').map(t => t.trim()).filter(Boolean) },
    });
    if (r.ok) router.push(`/crm/staff/content/${r.data.id}`);
    else setError(errorText(r.error, T.intl.locale));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <PageHeader title={T.t('learn.staff.title')} description={T.t('learn.staff.description')}
        actions={<button type="button" style={primaryButton} onClick={() => setCreating(!creating)}>{T.t('learn.staff.newItem')}</button>} />
      {creating && (
        <section style={{ ...card, display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '13px' }}>{T.t('learn.staff.field.slug')}
              <input dir="ltr" value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value.toLowerCase() })} placeholder="cash-flow-basics" style={input} /></label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '13px' }}>{T.t('learn.staff.field.kind')}
              <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })} style={input}>
                {['lesson', 'checklist', 'playbook', 'notice'].map(k => <option key={k} value={k}>{T.t(`learn.staff.kind.${k}`)}</option>)}
              </select></label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '13px' }}>{T.t('learn.filter.level')}
              <select value={form.level} onChange={e => setForm({ ...form, level: e.target.value })} style={input}>
                <option value="">—</option>
                {['beginner', 'intermediate', 'advanced'].map(l => <option key={l} value={l}>{T.t(`learn.level.${l}`)}</option>)}
              </select></label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '13px' }}>{T.t('learn.staff.field.tags')}
              <input dir="ltr" value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })} placeholder="cash, pricing" style={input} /></label>
          </div>
          <label style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '13px' }}>
            <input type="checkbox" checked={form.regulated} onChange={e => setForm({ ...form, regulated: e.target.checked })} />
            {T.t('learn.staff.field.regulated')}
          </label>
          <FormError message={error} />
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="button" style={primaryButton} onClick={create}>{T.t('learn.staff.create')}</button>
            <button type="button" style={secondaryButton} onClick={() => setCreating(false)}>{T.t('learn.staff.cancel')}</button>
          </div>
        </section>
      )}
      <div role="tablist" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        {FILTERS.map(f => (
          <button key={f || 'all'} type="button" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
            style={{ ...secondaryButton, background: filter === f ? 'var(--ds-primary)' : 'transparent', color: filter === f ? 'var(--ds-on-primary)' : 'var(--ds-text-body)' }}>
            {f ? T.t(`learn.staff.state.${f}`) : T.t('learn.staff.all')}
          </button>
        ))}
      </div>
      {load.status === 'loading' && <DataState state="loading" />}
      {load.status === 'failed' && <DataState state={load.error.code === 'ACCESS_DENIED' ? 'denied' : 'failed'} message={load.error.code === 'ACCESS_DENIED' ? T.t('learn.staff.notStaff') : errorText(load.error, T.intl.locale)} />}
      {load.status === 'ready' && items.length === 0 && <DataState state="empty" message={T.t('learn.staff.empty')} />}
      {items.length > 0 && (
        <div style={{ overflowX: 'auto', ...card, padding: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr>
                {['lesson', 'ar', 'en'].map(h => <th key={h} scope="col" style={{ ...cell, color: 'var(--ds-text-muted)', fontWeight: 500 }}>{T.t(`learn.staff.col.${h}`)}</th>)}
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id}>
                  <td style={cell}>
                    <Link href={`/crm/staff/content/${item.id}`} style={{ color: 'var(--ds-primary)', fontWeight: 500 }} dir="ltr">{item.slug}</Link>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBlockStart: '4px' }}>
                      <Chip tone="info">{T.t(`learn.staff.kind.${item.kind}`)}</Chip>
                      {item.regulated && <Chip tone="warning">{T.t('learn.staff.regulated')}</Chip>}
                    </div>
                  </td>
                  {(['ar', 'en'] as const).map(l => {
                    const v = latest(item, l);
                    return (
                      <td key={l} style={cell} dir={l === 'ar' ? 'rtl' : 'ltr'}>
                        {v ? <><div>{v.title}</div><Chip tone={STATE_TONE[v.state]}>{T.t(`learn.staff.state.${v.state}`)} · v{v.version}</Chip></> : <span style={{ color: 'var(--ds-text-muted)' }}>—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
