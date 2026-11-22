'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/store/orgStore';
import { smeApi, errorText, type SmeApiError } from '@/sme/api/client';
import { DataState } from '@/sme/ui/DataState';
import { PageHeader } from '@/sme/ui/PageHeader';
import { SmeGate } from '@/sme/profile/ui/SmeGate';
import { Chip, card, secondaryButton } from '@/sme/ledger/ui/shared';
import { CALCULATOR_GROUPS } from '../core/types';
import type { CatalogueEntry } from '../core/run';
import { useCalcText } from './format';

type Load = { status: 'loading' } | { status: 'failed'; error: SmeApiError } | { status: 'ready'; items: CatalogueEntry[] };

/** CAL-01: calculators grouped by business need, with complexity and availability. */
export function ToolsCatalogue() {
  const T = useCalcText();
  const { currentOrg } = useOrg();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!currentOrg) return;
    let ignore = false;
    smeApi<{ items: CatalogueEntry[] }>('calculators', { orgId: currentOrg.id }).then(r => {
      if (!ignore) setLoad(r.ok ? { status: 'ready', items: r.data.items } : { status: 'failed', error: r.error });
    });
    return () => { ignore = true; };
  }, [currentOrg, reloadKey]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <PageHeader title={T.t('tools.title')} description={T.t('tools.description')}
        actions={<Link href="/crm/tools/saved" style={{ ...secondaryButton, textDecoration: 'none' }}>{T.t('tools.saved.link')}</Link>} />
      <SmeGate permission="sme.calc.run">
        {load.status === 'loading' && <DataState state="loading" />}
        {load.status === 'failed' && <DataState state="failed" message={errorText(load.error, T.intl.locale)} onRetry={() => { setLoad({ status: 'loading' }); setReloadKey(k => k + 1); }} />}
        {load.status === 'ready' && load.items.length === 0 && <DataState state="empty" />}
        {load.status === 'ready' && CALCULATOR_GROUPS.map(group => {
          const items = load.items.filter(i => i.group === group);
          if (items.length === 0) return null;
          return (
            <section key={group} aria-labelledby={`tools-${group}`} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <h2 id={`tools-${group}`} style={{ fontSize: '15px', fontWeight: 600, margin: 0, color: 'var(--ds-text-heading)' }}>{T.t(`tools.group.${group}`)}</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '12px' }}>
                {items.map(item => <CatalogueCard key={item.code} item={item} />)}
              </div>
            </section>
          );
        })}
      </SmeGate>
    </div>
  );
}

function CatalogueCard({ item }: { item: CatalogueEntry }) {
  const T = useCalcText();
  const unavailable = item.availability === 'unavailable';
  const body = (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
        <Chip>{T.t(`tools.complexity.${item.complexity}`)}</Chip>
        {item.availability === 'needs_rule' && <Chip tone="warning">{T.t('tools.availability.needs_rule')}</Chip>}
        {unavailable && <Chip tone="info">{T.t('tools.availability.unavailable')}</Chip>}
      </div>
      <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0, color: 'var(--ds-text-heading)' }}>{T.t(`calc.${item.code}.title`)}</h3>
      <p style={{ fontSize: '13px', lineHeight: 1.6, margin: 0, color: 'var(--ds-text-muted)' }}>
        {unavailable && item.unavailableReasonKey ? T.t(item.unavailableReasonKey) : T.t(`calc.${item.code}.description`)}
      </p>
    </>
  );
  const style = { ...card, display: 'flex', flexDirection: 'column' as const, gap: '8px', textDecoration: 'none', color: 'inherit', minHeight: '140px' };
  if (unavailable) return <div style={{ ...style, opacity: 0.75 }} aria-disabled>{body}</div>;
  return <Link href={`/crm/tools/${item.code}`} className="crm-nav-item" style={style}>{body}</Link>;
}
