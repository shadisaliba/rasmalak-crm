'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useParams } from 'next/navigation';
import { useOrg } from '@/store/orgStore';
import { useAuthStore } from '@/store/authStore';
import { smeApi, errorText, type SmeApiError } from '@/sme/api/client';
import { DataState } from '@/sme/ui/DataState';
import { PageHeader } from '@/sme/ui/PageHeader';
import { Chip, FormError, card, input, primaryButton, secondaryButton } from '@/sme/ledger/ui/shared';
import type { Section } from '@/sme/content/types';
import { contentBodySchema } from '@/sme/content/schema';
import { diffLines, versionText } from '@/sme/content/diff';
import LessonSectionContainer from '../CourseSection';
import { useLearnText } from '../text';
import { BlockEditor, cleanSections } from './BlockEditor';

type Locale = 'ar' | 'en';
export type VersionState = 'draft' | 'in_review' | 'changes_requested' | 'approved' | 'published' | 'retired';
interface Version {
  id: string; locale: Locale; version: number; state: VersionState; title: string; summary: string; body: { sections: Section[] };
  est_minutes: number | null; legal_source_ids: string[]; external_sources: { url: string; title: string }[];
  valid_from: string | null; valid_to: string | null; author_id: string; reviewer_id: string | null; legal_reviewer_id: string | null;
  review_note: string | null; published_at: string | null; change_note: string | null; submitted_at: string | null;
}
interface ItemResponse {
  item: { id: string; slug: string; kind: string; regulated: boolean; level: string | null; topic_tags: string[] };
  versions: Version[];
  my_roles: string[];
}
interface Draft {
  title: string; summary: string; sections: Section[]; est_minutes: string; valid_from: string; valid_to: string;
  change_note: string; sources: string; legal_source_ids: string;
}

export const STATE_TONE: Record<VersionState, 'neutral' | 'warning' | 'info'> = {
  draft: 'info', in_review: 'warning', changes_requested: 'warning', approved: 'neutral', published: 'neutral', retired: 'info',
};
const fieldLabel: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '13px', fontWeight: 500 };

function toDraft(v?: Version): Draft {
  return {
    title: v?.title ?? '', summary: v?.summary ?? '', sections: v?.body.sections ?? [], est_minutes: v?.est_minutes ? String(v.est_minutes) : '',
    valid_from: v?.valid_from ?? '', valid_to: v?.valid_to ?? '', change_note: '',
    sources: (v?.external_sources ?? []).map(s => `${s.title} | ${s.url}`).join('\n'),
    legal_source_ids: (v?.legal_source_ids ?? []).join('\n'),
  };
}

/** Staff editor (W3b-01): bilingual drafts with live preview, review, publishing and history. */
export function ContentEditor() {
  const { id } = useParams<{ id: string }>();
  const T = useLearnText();
  const { currentOrg } = useOrg();
  const me = useAuthStore(s => s.user?.id ?? '');
  const [load, setLoad] = useState<{ status: 'loading' } | { status: 'failed'; error: SmeApiError } | { status: 'ready'; data: ItemResponse }>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [locale, setLocale] = useState<Locale>('ar');
  const [draft, setDraft] = useState<Draft>(toDraft());
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [compare, setCompare] = useState<string | null>(null);

  useEffect(() => {
    if (!currentOrg) return;
    let ignore = false;
    smeApi<ItemResponse>(`/api/staff/v1/content/${id}`, { orgId: currentOrg.id }).then(r => {
      if (!ignore) setLoad(r.ok ? { status: 'ready', data: r.data } : { status: 'failed', error: r.error });
    });
    return () => { ignore = true; };
  }, [currentOrg, id, reloadKey]);

  const versions = useMemo(() => (load.status === 'ready' ? load.data.versions.filter(v => v.locale === locale) : []), [load, locale]);
  const latest = versions[0];
  const open = latest && (latest.state === 'draft' || latest.state === 'changes_requested') ? latest : undefined;
  // The form follows the latest version of the chosen locale (React's "adjust state on prop change").
  const syncKey = `${locale}:${latest?.id ?? 'none'}`;
  const [syncedKey, setSyncedKey] = useState('');
  if (load.status === 'ready' && syncedKey !== syncKey) {
    setSyncedKey(syncKey);
    setDraft(toDraft(latest));
    setEditing(!latest || !!open);
    setError(null);
    setCompare(null);
  }

  if (load.status !== 'ready') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <PageHeader title={T.t('learn.staff.title')} back={{ href: '/crm/staff/content', label: T.t('learn.staff.title') }} />
        {load.status === 'loading' ? <DataState state="loading" /> : <DataState state={load.error.code === 'ACCESS_DENIED' ? 'denied' : 'failed'} message={errorText(load.error, T.intl.locale)} />}
      </div>
    );
  }
  const { item, my_roles: roles } = load.data;
  const has = (...r: string[]) => r.some(x => roles.includes(x));
  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  const act = async (path: string, body?: unknown) => {
    if (!currentOrg) return false;
    setBusy(true);
    setError(null);
    const r = await smeApi(`/api/staff/v1/content/${path}`, { orgId: currentOrg.id, method: 'POST', body });
    setBusy(false);
    if (!r.ok) {
      const reason = typeof r.error.details?.reason === 'string' ? T.t(`learn.staff.reason.${r.error.details.reason}`) : null;
      setError(reason && !reason.startsWith('learn.staff.reason.') ? reason : errorText(r.error, T.intl.locale));
      return false;
    }
    setReloadKey(k => k + 1);
    return true;
  };

  const save = async () => {
    const sections = cleanSections(draft.sections);
    const parsed = contentBodySchema.safeParse({ sections });
    if (!parsed.success) { setError(T.t('learn.staff.invalidBody')); return; }
    const sources = draft.sources.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
      const [title, ...rest] = l.split('|');
      return { title: title.trim(), url: rest.join('|').trim() };
    });
    await act(`${item.id}/draft`, {
      locale,
      draft: {
        title: draft.title.trim(), summary: draft.summary.trim(), body: parsed.data,
        est_minutes: draft.est_minutes ? Number(draft.est_minutes) : null,
        valid_from: draft.valid_from || null, valid_to: draft.valid_to || null,
        external_sources: sources, legal_source_ids: draft.legal_source_ids.split(/\s+/).filter(Boolean),
        change_note: draft.change_note.trim() || null,
      },
    });
  };

  const shown = editing ? null : latest;
  const previewSections = editing ? draft.sections : latest?.body.sections ?? [];
  const compareWith = compare ? versions.find(v => v.id === compare) : undefined;
  const previous = compareWith ? versions.find(v => v.version === compareWith.version - 1) : undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <PageHeader title={<span dir="ltr">{item.slug}</span>} back={{ href: '/crm/staff/content', label: T.t('learn.staff.title') }}
        badge={item.regulated ? <Chip tone="warning">{T.t('learn.staff.regulated')}</Chip> : undefined}
        description={T.t('learn.staff.itemMeta', { kind: T.t(`learn.staff.kind.${item.kind}`), level: item.level ? T.t(`learn.level.${item.level}`) : '—', tags: item.topic_tags.join(', ') || '—' })} />

      <div role="tablist" style={{ display: 'flex', gap: '6px' }}>
        {(['ar', 'en'] as const).map(l => (
          <button key={l} type="button" role="tab" aria-selected={locale === l} onClick={() => setLocale(l)}
            style={{ ...secondaryButton, background: locale === l ? 'var(--ds-primary)' : 'transparent', color: locale === l ? 'var(--ds-on-primary)' : 'var(--ds-text-body)' }}>
            {T.t(`learn.staff.locale.${l}`)}
          </button>
        ))}
      </div>

      {item.regulated && <DataState state="review_needed" message={T.t('learn.staff.regulatedNote')} />}
      {open?.state === 'changes_requested' && open.review_note && <DataState state="partial" message={T.t('learn.staff.changesRequested', { note: open.review_note })} />}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))', gap: '16px', alignItems: 'start' }}>
        <section style={{ ...card, display: 'flex', flexDirection: 'column', gap: '12px' }} aria-label={T.t('learn.staff.editor')}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
            {latest ? <Chip tone={STATE_TONE[latest.state]}>{T.t(`learn.staff.state.${latest.state}`)} · v{latest.version}</Chip> : <Chip tone="info">{T.t('learn.staff.noVersion')}</Chip>}
          </div>
          {editing ? (
            <>
              <label style={fieldLabel}>{T.t('learn.staff.field.lessonTitle')}<input dir={dir} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} style={input} maxLength={200} /></label>
              <label style={fieldLabel}>{T.t('learn.staff.field.summary')}<textarea dir={dir} rows={2} value={draft.summary} onChange={e => setDraft({ ...draft, summary: e.target.value })} style={{ ...input, resize: 'vertical' }} maxLength={600} /></label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px' }}>
                <label style={fieldLabel}>{T.t('learn.staff.field.minutes')}<input type="number" min={3} max={7} value={draft.est_minutes} onChange={e => setDraft({ ...draft, est_minutes: e.target.value })} style={input} /></label>
                <label style={fieldLabel}>{T.t('learn.staff.field.validFrom')}<input type="date" value={draft.valid_from} onChange={e => setDraft({ ...draft, valid_from: e.target.value })} style={input} /></label>
                <label style={fieldLabel}>{T.t('learn.staff.field.validTo')}<input type="date" value={draft.valid_to} onChange={e => setDraft({ ...draft, valid_to: e.target.value })} style={input} /></label>
              </div>
              <label style={fieldLabel}>{T.t('learn.staff.field.sources')}<textarea dir="ltr" rows={2} value={draft.sources} onChange={e => setDraft({ ...draft, sources: e.target.value })} style={{ ...input, resize: 'vertical' }} placeholder="Title | https://…" /></label>
              {item.regulated && (
                <label style={fieldLabel}>{T.t('learn.staff.field.legalSources')}<textarea dir="ltr" rows={2} value={draft.legal_source_ids} onChange={e => setDraft({ ...draft, legal_source_ids: e.target.value })} style={{ ...input, resize: 'vertical' }} /></label>
              )}
              <BlockEditor sections={draft.sections} onChange={sections => setDraft({ ...draft, sections })} dir={dir} />
              <label style={fieldLabel}>{T.t('learn.staff.field.changeNote')}<input value={draft.change_note} onChange={e => setDraft({ ...draft, change_note: e.target.value })} style={input} maxLength={500} /></label>
              <FormError message={error} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {has('content_editor') && <button type="button" style={primaryButton} disabled={busy} onClick={save}>{T.t('learn.staff.save')}</button>}
                {has('content_editor') && open && <button type="button" style={secondaryButton} disabled={busy} onClick={() => act(`versions/${open.id}/submit`)}>{T.t('learn.staff.submit')}</button>}
                {!open && latest && <button type="button" style={secondaryButton} onClick={() => { setEditing(false); setDraft(toDraft(latest)); }}>{T.t('learn.staff.cancel')}</button>}
              </div>
            </>
          ) : shown && (
            <>
              <h2 dir={dir} style={{ fontSize: '17px', margin: 0 }}>{shown.title}</h2>
              <p dir={dir} style={{ fontSize: '13px', margin: 0, color: 'var(--ds-text-muted)' }}>{shown.summary}</p>
              <FormError message={error} />
              {shown.state === 'in_review' && has('subject_reviewer', 'legal_reviewer') && (
                shown.author_id === me
                  ? <p style={{ fontSize: '13px', margin: 0, color: 'var(--ds-text-muted)' }}>{T.t('learn.staff.ownVersion')}</p>
                  : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder={T.t('learn.staff.reviewNote')} aria-label={T.t('learn.staff.reviewNote')} style={{ ...input, resize: 'vertical' }} />
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                        <button type="button" style={primaryButton} disabled={busy} onClick={async () => { if (await act(`versions/${shown.id}/review`, { decision: 'approve', note: note || undefined })) setNote(''); }}>{T.t('learn.staff.approve')}</button>
                        <button type="button" style={secondaryButton} disabled={busy} onClick={async () => { if (await act(`versions/${shown.id}/review`, { decision: 'request_changes', note })) setNote(''); }}>{T.t('learn.staff.requestChanges')}</button>
                      </div>
                    </div>
                  )
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {shown.state === 'approved' && has('content_editor', 'subject_reviewer', 'compliance_lead') && (
                  <button type="button" style={primaryButton} disabled={busy} onClick={() => act(`versions/${shown.id}/publish`)}>{T.t('learn.staff.publish')}</button>
                )}
                {(shown.state === 'published' || shown.state === 'approved') && has('subject_reviewer', 'compliance_lead') && (
                  <button type="button" style={secondaryButton} disabled={busy} onClick={() => act(`versions/${shown.id}/retire`)}>{T.t('learn.staff.retire')}</button>
                )}
                {has('content_editor') && shown.state !== 'in_review' && (
                  <button type="button" style={secondaryButton} onClick={() => setEditing(true)}>{T.t('learn.staff.newVersion')}</button>
                )}
              </div>
            </>
          )}
        </section>

        <section style={{ ...card, display: 'flex', flexDirection: 'column', gap: '8px' }} aria-label={T.t('learn.staff.preview')}>
          <h2 style={{ fontSize: '14px', fontWeight: 600, margin: 0 }}>{T.t('learn.staff.preview')}</h2>
          <div lang={locale} dir={dir}>
            {previewSections.length === 0 ? <DataState state="empty" message={T.t('learn.staff.previewEmpty')} /> : previewSections.map((s, i) => (
              <LessonSectionContainer key={s.id} section={s} sectionIndex={i} lessonLabel={T.number(i + 1)} completed={false} alternateBackground={i % 2 === 1} />
            ))}
          </div>
        </section>
      </div>

      <section style={{ ...card, display: 'flex', flexDirection: 'column', gap: '8px' }} aria-labelledby="content-history">
        <h2 id="content-history" style={{ fontSize: '14px', fontWeight: 600, margin: 0 }}>{T.t('learn.staff.history')}</h2>
        {versions.length === 0 ? <p style={{ fontSize: '13px', margin: 0, color: 'var(--ds-text-muted)' }}>{T.t('learn.staff.noVersion')}</p> : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px' }}>
            {versions.map(v => (
              <li key={v.id} style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                <strong>v{v.version}</strong>
                <Chip tone={STATE_TONE[v.state]}>{T.t(`learn.staff.state.${v.state}`)}</Chip>
                {v.published_at && <span>{T.t('learn.publishedOn', { date: T.date(v.published_at) })}</span>}
                {v.change_note && <span style={{ color: 'var(--ds-text-muted)' }}>{v.change_note}</span>}
                {v.version > 1 && <button type="button" style={{ ...secondaryButton, padding: '3px 8px', fontSize: '12px' }} onClick={() => setCompare(compare === v.id ? null : v.id)}>{T.t('learn.staff.compare')}</button>}
              </li>
            ))}
          </ul>
        )}
        {compareWith && previous && (
          <pre dir="ltr" style={{ margin: 0, maxHeight: '360px', overflow: 'auto', fontSize: '12px', lineHeight: 1.5, background: 'var(--ds-bg-page)', borderRadius: '8px', padding: '8px' }}>
            {diffLines(versionText(previous), versionText(compareWith)).filter(l => l.kind !== 'same').map((l, i) => (
              <div key={i} style={{ color: l.kind === 'added' ? 'var(--ds-success-text)' : 'var(--ds-error-text)' }}>{l.kind === 'added' ? '+ ' : '− '}{l.text}</div>
            ))}
          </pre>
        )}
      </section>
    </div>
  );
}
