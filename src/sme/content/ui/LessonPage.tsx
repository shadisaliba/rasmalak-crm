'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { useOrg } from '@/store/orgStore';
import { supabase } from '@/lib/supabaseClient';
import { smeApi, errorText, type SmeApiError } from '@/sme/api/client';
import { DataState } from '@/sme/ui/DataState';
import { PageHeader } from '@/sme/ui/PageHeader';
import { SmeGate } from '@/sme/profile/ui/SmeGate';
import { Chip, FormError, card, input, primaryButton, secondaryButton } from '@/sme/ledger/ui/shared';
import { checklistItems, contentBodySchema, type ContentBody } from '../schema';
import LessonSectionContainer from './CourseSection';
import { useLearnText } from './text';

type Locale = 'ar' | 'en';
interface LessonVersion {
  id: string; locale: Locale; version: number; title: string; summary: string; body: unknown; est_minutes: number | null;
  external_sources: { url: string; title: string }[]; valid_from: string | null; valid_to: string | null;
  published_at: string; reviewed_at: string | null; legal_reviewed_at: string | null;
}
interface LessonResponse {
  item: { id: string; slug: string; level: string | null; regulated: boolean; topic_tags: string[] };
  version: LessonVersion | null;
  available_locales: Locale[];
  progress: { version_id: string; last_section_id: string | null; completed_at: string | null; quiz_score: number | null } | null;
}
type Load = { status: 'loading' } | { status: 'failed'; error: SmeApiError } | { status: 'ready'; data: LessonResponse; body: ContentBody | null };

/** LRN-02: one lesson, with optional quizzes, resumable progress, a checklist and feedback. */
export function LessonPage() {
  const { slug } = useParams<{ slug: string }>();
  const T = useLearnText();
  const { currentOrg } = useOrg();
  // A reader may open the other language when theirs is not published; nothing is translated.
  const [locale, setLocale] = useState<Locale>(T.uiLocale);
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [completedAt, setCompletedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const lastSection = useRef<string | null>(null);

  useEffect(() => {
    if (!currentOrg) return;
    let ignore = false;
    smeApi<LessonResponse>(`learn/lessons/${encodeURIComponent(slug)}?locale=${locale}`, { orgId: currentOrg.id }).then(r => {
      if (ignore) return;
      if (!r.ok) { setLoad({ status: 'failed', error: r.error }); return; }
      const parsed = r.data.version ? contentBodySchema.safeParse(r.data.version.body) : null;
      setLoad({ status: 'ready', data: r.data, body: parsed?.success ? parsed.data : null });
      setCompletedAt(r.data.progress?.completed_at ?? null);
      lastSection.current = r.data.progress?.last_section_id ?? null;
    });
    return () => { ignore = true; };
  }, [currentOrg, slug, locale, reloadKey]);

  const version = load.status === 'ready' ? load.data.version : null;
  const body = load.status === 'ready' ? load.body : null;

  const record = async (progress: { section_id?: string; completed?: boolean; quiz_score?: number }) => {
    if (!currentOrg || !version) return null;
    const r = await smeApi<{ completed_at: string | null }>('learn/progress', { orgId: currentOrg.id, method: 'POST', body: { version_id: version.id, ...progress } });
    if (!r.ok) { setSaveError(errorText(r.error, T.intl.locale)); return null; }
    setSaveError(null);
    return r.data;
  };

  // Opening a lesson records it, and the reader resumes at the section they reached last time.
  useEffect(() => {
    if (!version || !body || body.sections.length === 0) return;
    const resume = lastSection.current;
    if (resume) document.getElementById(`section-${resume}`)?.scrollIntoView({ block: 'start' });
    else void record({ section_id: body.sections[0].id });
    const ids = body.sections.map(s => s.id);
    const observer = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const id = e.target.id.replace(/^section-/, '');
        if (ids.indexOf(id) > ids.indexOf(lastSection.current ?? '')) { lastSection.current = id; void record({ section_id: id }); }
      }
    }, { threshold: 0.4 });
    ids.forEach(id => { const el = document.getElementById(`section-${id}`); if (el) observer.observe(el); });
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per loaded version
  }, [version?.id]);

  const complete = async () => {
    const r = await record({ completed: true });
    if (r?.completed_at) setCompletedAt(r.completed_at);
  };

  const downloadChecklist = async () => {
    const { data } = await supabase.auth.getSession();
    const res = await fetch(`/api/sme/v1/learn/lessons/${encodeURIComponent(slug)}/checklist?locale=${locale}`, {
      headers: data.session ? { authorization: `Bearer ${data.session.access_token}` } : {},
    });
    if (!res.ok) { setSaveError(T.t('learn.checklist.failed')); return; }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}-checklist.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const back = { href: '/crm/learn', label: T.t('learn.back') };
  const other: Locale = locale === 'ar' ? 'en' : 'ar';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {load.status !== 'ready' || !version ? (
        <>
          <PageHeader title={T.t('learn.title')} back={back} />
          <SmeGate permission="sme.learn.use">
            {load.status === 'loading' && <DataState state="loading" />}
            {load.status === 'failed' && (load.error.code === 'NOT_FOUND'
              ? <DataState state="empty" message={T.t('learn.notFound')} />
              : <DataState state="failed" message={errorText(load.error, T.intl.locale)} onRetry={() => { setLoad({ status: 'loading' }); setReloadKey(k => k + 1); }} />)}
            {load.status === 'ready' && !version && (
              <DataState state="partial" message={T.t(`learn.notInLocale.${locale}`)}
                action={load.data.available_locales.includes(other)
                  ? <button type="button" style={secondaryButton} onClick={() => { setLoad({ status: 'loading' }); setLocale(other); }}>{T.t(`learn.readIn.${other}`)}</button>
                  : undefined} />
            )}
          </SmeGate>
        </>
      ) : (
        <>
          <PageHeader title={<span lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'}>{version.title}</span>} back={back}
            description={<span lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'}>{version.summary}</span>}
            badge={completedAt ? <Chip>{T.t('learn.completed')}</Chip> : undefined} />
          <SmeGate permission="sme.learn.use">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', fontSize: '12px', color: 'var(--ds-text-muted)' }}>
              {load.data.item.level && <Chip>{T.t(`learn.level.${load.data.item.level}`)}</Chip>}
              {version.est_minutes && <Chip tone="info">{T.t('learn.minutes', { n: version.est_minutes })}</Chip>}
              <span>{T.t('learn.publishedOn', { date: T.date(version.published_at) })}</span>
              {locale !== T.uiLocale && <Chip tone="warning">{T.t(`learn.showingIn.${locale}`)}</Chip>}
            </div>

            {load.data.item.regulated && (
              <section style={{ ...card, display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px' }} aria-label={T.t('learn.sources.title')}>
                <strong>{T.t('learn.sources.title')}</strong>
                {version.legal_reviewed_at && <span>{T.t('learn.sources.reviewedOn', { date: T.date(version.legal_reviewed_at) })}</span>}
                {version.valid_from && <span>{T.t('learn.sources.effective', { from: T.date(version.valid_from) })}</span>}
                {version.external_sources.length > 0 && (
                  <ul style={{ margin: 0, paddingInlineStart: '18px' }}>
                    {version.external_sources.map(s => <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--ds-primary)' }}>{s.title}</a></li>)}
                  </ul>
                )}
              </section>
            )}

            {body ? (
              <article lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'} style={{ ...card, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {body.sections.map((section, i) => (
                  <div key={section.id} id={`section-${section.id}`} style={{ scrollMarginTop: '80px' }}>
                    <LessonSectionContainer section={section} sectionIndex={i} lessonLabel={T.number(i + 1)} completed={!!completedAt}
                      alternateBackground={i % 2 === 1} onQuizScore={score => { void record({ quiz_score: score }); }} />
                  </div>
                ))}
              </article>
            ) : <DataState state="failed" message={T.t('learn.bodyInvalid')} />}

            <p role="note" style={{ fontSize: '12px', color: 'var(--ds-text-muted)', margin: 0 }}>{T.t('learn.disclaimer')}</p>
            <FormError message={saveError} />

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
              {completedAt
                ? <span role="status" style={{ fontSize: '13px' }}>{T.t('learn.completedOn', { date: T.date(completedAt) })}</span>
                : <button type="button" style={primaryButton} onClick={complete}>{T.t('learn.markComplete')}</button>}
              {body && checklistItems(body).length > 0 && (
                <button type="button" style={secondaryButton} onClick={downloadChecklist}>{T.t('learn.checklist.download')}</button>
              )}
            </div>

            {currentOrg && <Feedback orgId={currentOrg.id} versionId={version.id} />}
          </SmeGate>
        </>
      )}
    </div>
  );
}

function Feedback({ orgId, versionId }: { orgId: string; versionId: string }) {
  const T = useLearnText();
  const [useful, setUseful] = useState<boolean | null>(null);
  const [comment, setComment] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  const key = useRef(crypto.randomUUID());

  const send = async () => {
    if (useful === null) return;
    setState('sending');
    const r = await smeApi('learn/feedback', { orgId, method: 'POST', idempotencyKey: key.current, body: { version_id: versionId, useful, comment: comment.trim() || undefined } });
    if (r.ok) setState('sent');
    else { setState('idle'); setError(errorText(r.error, T.intl.locale)); }
  };

  if (state === 'sent') return <p role="status" style={{ fontSize: '13px', margin: 0 }}>{T.t('learn.feedback.thanks')}</p>;
  return (
    <section style={{ ...card, display: 'flex', flexDirection: 'column', gap: '10px' }} aria-labelledby="lesson-feedback">
      <h2 id="lesson-feedback" style={{ fontSize: '14px', fontWeight: 600, margin: 0 }}>{T.t('learn.feedback.question')}</h2>
      <div role="radiogroup" style={{ display: 'flex', gap: '8px' }}>
        {[true, false].map(v => (
          <button key={String(v)} type="button" role="radio" aria-checked={useful === v} onClick={() => setUseful(v)}
            style={{ ...secondaryButton, background: useful === v ? 'var(--ds-bg-tinted)' : 'transparent', borderColor: useful === v ? 'var(--ds-primary)' : 'var(--ds-border)' }}>
            {T.t(v ? 'learn.feedback.yes' : 'learn.feedback.no')}
          </button>
        ))}
      </div>
      {useful !== null && (
        <>
          <textarea value={comment} onChange={e => setComment(e.target.value)} maxLength={1000} rows={3} placeholder={T.t('learn.feedback.comment')}
            aria-label={T.t('learn.feedback.comment')} style={{ ...input, resize: 'vertical' }} />
          <FormError message={error} />
          <button type="button" style={{ ...primaryButton, alignSelf: 'flex-start' }} onClick={send} disabled={state === 'sending'}>{T.t('learn.feedback.send')}</button>
        </>
      )}
    </section>
  );
}
