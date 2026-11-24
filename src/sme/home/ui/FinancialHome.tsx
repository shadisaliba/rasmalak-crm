'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, ChartLine, Clock, FileUp, Info, Landmark, Plus, ReceiptText, FileMinus, RefreshCw } from 'lucide-react';
import { useOrg, useOrgPermission } from '@/store/orgStore';
import { smeApi, type SmeApiError } from '@/sme/api/client';
import { DataState } from '@/sme/ui/DataState';
import { PageHeader } from '@/sme/ui/PageHeader';
import { SmeSetupBanner } from '@/sme/profile/ui/SmeSetupBanner';
import { DataCompletenessBanner } from '@/sme/kpi/ui/DataCompletenessBanner';
import { Chip, card, muted, useLedgerReferenceData, useLedgerText } from '@/sme/ledger/ui/shared';
import { fetchRun } from '@/sme/forecast/ui/fetchRun';
import type { ForecastRun } from '@/sme/forecast/api/types';
import { useActions } from '@/sme/actions/ui/ActionsPage';
import { actionHref, useActionText } from '@/sme/actions/ui/text';
import type { AccountSummary } from '@/sme/ledger/types';

interface DueSummary { due_minor: string; overdue_minor: string; count: number; other_currency: number }
interface Due { collections: DueSummary; payments: DueSummary }
type Part<T> = { status: 'loading' } | { status: 'failed'; error: SmeApiError } | { status: 'ready'; data: T };

const SEVERITY_ICON = { critical: AlertTriangle, warning: Clock, info: Info } as const;
const SEVERITY_COLOR = { critical: 'var(--ds-error-text)', warning: 'var(--ds-warning-text)', info: 'var(--ds-text-muted)' } as const;

/**
 * FIN-01, the financial home: am I OK, what comes in and goes out soon, where cash is lowest, and
 * what to do next. Every card links to its figures and offers the next step (R4).
 */
export function FinancialHome() {
  const L = useLedgerText();
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id;
  const canLedger = useOrgPermission('sme.ledger.read');
  const canReceivables = useOrgPermission('sme.receivables.read');
  const canPayables = useOrgPermission('sme.payables.read');
  const canForecast = useOrgPermission('sme.forecast.read');
  const { categories } = useLedgerReferenceData(orgId);
  const A = useActionText(categories);
  const [reloadKey, setReloadKey] = useState(0);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Part<AccountSummary[]>>({ status: 'loading' });
  const [due, setDue] = useState<Part<Due>>({ status: 'loading' });
  const [forecast, setForecast] = useState<Part<{ run: ForecastRun; stale: boolean }>>({ status: 'loading' });
  const { load: actions, refresh: refreshActions } = useActions(canLedger ? orgId : undefined, 'open', 5);
  const tracked = useRef<string | null>(null);

  useEffect(() => {
    if (!orgId) return;
    let ignore = false;
    Promise.all([
      canLedger ? smeApi<{ items: AccountSummary[] }>('accounts', { orgId }) : null,
      canReceivables || canPayables ? smeApi<Due>('home/due?days=14', { orgId }) : null,
      canForecast ? fetchRun(orgId, null) : null,
    ]).then(([acc, d, f]) => {
      if (ignore) return;
      if (acc) setAccounts(acc.ok ? { status: 'ready', data: acc.data.items.filter(a => a.status === 'active') } : { status: 'failed', error: acc.error });
      if (d) setDue(d.ok ? { status: 'ready', data: d.data } : { status: 'failed', error: d.error });
      if (f) setForecast(f.ok ? { status: 'ready', data: f.data } : { status: 'failed', error: f.error });
      setLoadedAt(new Date().toISOString());
    });
    return () => { ignore = true; };
  }, [orgId, canLedger, canReceivables, canPayables, canForecast, reloadKey]);

  // DashboardViewed once per organization per visit (W3a-11 product events). Only codes and flags.
  useEffect(() => {
    if (!orgId || tracked.current === orgId || forecast.status === 'loading') return;
    tracked.current = orgId;
    const shortfall = forecast.status === 'ready' && forecast.data.run.result.firstBelowZeroWeek !== null;
    void smeApi('events', { orgId, method: 'POST', body: { event: 'DashboardViewed', props: { shortfall } } });
  }, [orgId, forecast]);

  const refresh = () => { setReloadKey(k => k + 1); refreshActions(); };
  const orgName = currentOrg ? L.localName(currentOrg.name, currentOrg.nameAr) : '';
  const header = (
    <PageHeader
      title={L.t('sme.home.title')}
      description={loadedAt ? L.t('sme.home.subtitle', { org: orgName, time: L.dateTime(loadedAt) }) : orgName}
      actions={
        <button type="button" onClick={refresh} aria-label={L.t('sme.home.refresh')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '7px 12px', fontSize: '13px', borderRadius: '8px', border: '1px solid var(--ds-border)', background: 'transparent', color: 'var(--ds-text-body)', cursor: 'pointer' }}>
          <RefreshCw size={14} aria-hidden /> {L.t('sme.home.refresh')}
        </button>
      }
    />
  );
  const page = (children: ReactNode) => <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>{header}{children}</div>;

  if (!canLedger && !canReceivables && !canPayables) return page(<DataState state="denied" />);
  if (canLedger && accounts.status === 'ready' && accounts.data.length === 0) {
    return page(<>
      <SmeSetupBanner />
      <DataState state="empty" message={L.t('sme.home.noAccounts')}
        action={<Link href="/crm/money/accounts" style={{ color: 'var(--ds-primary)', fontWeight: 500 }}>{L.t('sme.home.action.addAccount')}</Link>} />
    </>);
  }

  const run = forecast.status === 'ready' ? forecast.data.run.result : null;
  const shortWeek = run && run.firstBelowZeroWeek !== null ? run.weeks[run.firstBelowZeroWeek] : null;

  return page(
    <>
      <SmeSetupBanner />
      {canLedger && <DataCompletenessBanner refreshKey={reloadKey} />}

      {shortWeek && (
        <Link href="/crm/money/forecast" data-testid="home-shortfall" role="status"
          style={{ ...card, display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none', background: 'var(--ds-warning-bg)', borderColor: 'var(--ds-warning-border)', color: 'var(--ds-warning-text)' }}>
          <AlertTriangle size={18} aria-hidden />
          <span style={{ flex: 1, fontWeight: 600 }}>{L.t('forecast.summary.shortfall', { date: L.date(shortWeek.start) })}</span>
          <span style={{ fontSize: '13px' }}>{L.t('sme.home.viewForecast')}</span>
        </Link>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '12px' }}>
        {canLedger && (
          <PartCard part={accounts} onRetry={refresh} label={L.t('sme.home.cash')}>
            {list => {
              const cash = list.reduce((s, a) => s + BigInt(a.baseBalanceMinor), 0n);
              const latest = list.map(a => a.lastValueDate).filter((d): d is string => !!d).sort().at(-1) ?? null;
              return (
                <StatCard testId="home-cash" icon={<Landmark size={18} />} label={L.t('sme.home.cash')} value={L.amount(cash, 'JOD')}
                  basis={L.t('sme.home.cashBasis', { count: list.length, date: latest ? L.date(latest) : '—' })}
                  href="/crm/money/accounts" link={L.t('sme.home.viewAccounts')}
                  extra={list.length > 1 && (
                    <ul aria-label={L.t('sme.home.byAccount')} style={{ listStyle: 'none', margin: '4px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '12px', color: 'var(--ds-text-muted)' }}>
                      {[...list].sort((a, b) => (BigInt(b.baseBalanceMinor) > BigInt(a.baseBalanceMinor) ? 1 : -1)).slice(0, 3).map(a => (
                        <li key={a.id} style={{ display: 'flex', gap: '8px', justifyContent: 'space-between' }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{L.localName(a.name, a.nameAr)}</span>
                          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{L.amount(a.baseBalanceMinor, 'JOD')}</span>
                        </li>
                      ))}
                      {list.length > 3 && <li>{L.t('sme.home.moreAccounts', { count: list.length - 3 })}</li>}
                    </ul>
                  )} />
              );
            }}
          </PartCard>
        )}
        {canReceivables && (
          <PartCard part={due} onRetry={refresh} label={L.t('sme.home.comingIn')}>
            {d => (
              <StatCard testId="home-collect" icon={<ArrowDownLeft size={18} />} label={L.t('sme.home.comingIn')} value={L.amount(d.collections.due_minor, 'JOD')}
                basis={L.t('sme.home.comingInBasis', { count: d.collections.count, overdue: L.amount(d.collections.overdue_minor, 'JOD') })}
                note={d.collections.other_currency > 0 ? L.t('sme.home.otherCurrency', { count: d.collections.other_currency }) : undefined}
                warning={BigInt(d.collections.overdue_minor) > 0n} href="/crm/money/receivables" link={L.t('sme.home.viewInvoices')} />
            )}
          </PartCard>
        )}
        {canPayables && (
          <PartCard part={due} onRetry={refresh} label={L.t('sme.home.goingOut')}>
            {d => (
              <StatCard testId="home-pay" icon={<ArrowUpRight size={18} />} label={L.t('sme.home.goingOut')} value={L.amount(d.payments.due_minor, 'JOD')}
                basis={L.t('sme.home.goingOutBasis', { count: d.payments.count, overdue: L.amount(d.payments.overdue_minor, 'JOD') })}
                note={d.payments.other_currency > 0 ? L.t('sme.home.otherCurrency', { count: d.payments.other_currency }) : undefined}
                warning={BigInt(d.payments.overdue_minor) > 0n} href="/crm/money/payables" link={L.t('sme.home.viewBills')} />
            )}
          </PartCard>
        )}
        {canForecast && (
          <PartCard part={forecast} onRetry={refresh} label={L.t('sme.home.lowest')}>
            {f => (
              <StatCard testId="home-lowest" icon={<ChartLine size={18} />} label={L.t('sme.home.lowest')} value={L.amount(f.run.result.minimum.minor, 'JOD')}
                basis={L.t('sme.home.lowestWeek', { date: L.date(f.run.result.weeks[f.run.result.minimum.weekIndex].start) })}
                warning={f.run.result.firstBelowZeroWeek !== null}
                chip={f.stale ? <Chip tone="info">{L.t('sme.home.updating')}</Chip>
                  : f.run.result.firstBelowZeroWeek !== null ? <Chip tone="warning">{L.t('sme.home.shortfallChip', { date: L.date(f.run.result.weeks[f.run.result.firstBelowZeroWeek].start) })}</Chip>
                  : <Chip>{L.t('sme.home.noShortfall')}</Chip>}
                href="/crm/money/forecast" link={L.t('sme.home.viewForecast')} />
            )}
          </PartCard>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '12px', alignItems: 'start' }}>
        {canLedger && (
          <section style={{ ...card, display: 'flex', flexDirection: 'column', gap: '10px' }} aria-labelledby="home-actions">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
              <h2 id="home-actions" style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--ds-text-heading)' }}>{L.t('sme.home.priorities')}</h2>
              <Link href="/crm/money/actions" style={{ fontSize: '13px', color: 'var(--ds-accent-primary)', textDecoration: 'none' }}>{L.t('sme.home.seeAll')}</Link>
            </div>
            {actions.status === 'loading' ? <DataState state="loading" />
              : actions.status === 'failed' ? <DataState state="failed" onRetry={refresh} />
              : actions.items.length === 0 ? <p style={muted}>{actions.checking ? L.t('actions.checking') : L.t('sme.home.nothingUrgent')}</p>
              : (
                <ul data-testid="home-priorities" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  {actions.items.map(a => {
                    const Icon = SEVERITY_ICON[a.severity];
                    return (
                      <li key={a.id}>
                        <Link href={actionHref(a) ?? '/crm/money/actions'} className="sme-row-link"
                          style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px', borderRadius: '10px', textDecoration: 'none', fontSize: '14px', color: 'var(--ds-text-body)' }}>
                          <span aria-hidden style={{ display: 'inline-flex', color: SEVERITY_COLOR[a.severity] }}><Icon size={16} /></span>
                          <span className="sr-only">{A.t(`actions.severity.${a.severity}`)}</span>
                          <span style={{ flex: 1 }}>{A.title(a)}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
          </section>
        )}
        <section style={{ ...card, display: 'flex', flexDirection: 'column', gap: '10px' }} aria-labelledby="home-quick">
          <h2 id="home-quick" style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--ds-text-heading)' }}>{L.t('sme.home.quick')}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '8px' }}>
            {[
              { show: canLedger, href: '/crm/money/transactions/import', icon: <FileUp size={16} />, label: L.t('sme.money.tx.import') },
              { show: canLedger, href: '/crm/money/transactions', icon: <Plus size={16} />, label: L.t('sme.money.tx.add') },
              { show: canReceivables, href: '/crm/money/receivables', icon: <ReceiptText size={16} />, label: L.t('sme.receivables.new') },
              { show: canPayables, href: '/crm/money/payables', icon: <FileMinus size={16} />, label: L.t('sme.payables.new') },
            ].filter(q => q.show).map(q => (
              <Link key={q.href + q.label} href={q.href} className="sme-row-link" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', borderRadius: '10px', border: '1px solid var(--ds-border)', textDecoration: 'none', fontSize: '13px', color: 'var(--ds-text-body)' }}>
                <span style={{ display: 'inline-flex', color: 'var(--ds-accent-primary)' }}>{q.icon}</span>{q.label}
              </Link>
            ))}
          </div>
        </section>
      </div>
      <style>{`.sme-row-link:hover { background: var(--ds-bg-tinted); }`}</style>
    </>,
  );
}

/** The loading and failed states of one card (R3); its content renders once the data is in. */
function PartCard<T>({ part, label, onRetry, children }: { part: Part<T>; label: string; onRetry: () => void; children: (data: T) => ReactNode }) {
  const L = useLedgerText();
  if (part.status === 'ready') return <>{children(part.data)}</>;
  return (
    <section aria-label={label} aria-busy={part.status === 'loading' || undefined} style={{ ...card, display: 'flex', flexDirection: 'column', gap: '8px', minHeight: '130px' }}>
      <span style={{ fontSize: '13px', color: 'var(--ds-text-muted)' }}>{label}</span>
      {part.status === 'loading' ? <span style={{ ...muted }}>{L.t('sme.state.loading')}</span> : (
        <>
          <span role="alert" style={{ fontSize: '13px', color: 'var(--ds-error-text)' }}>{L.isAr ? part.error.message_ar : part.error.message_en}</span>
          <button type="button" onClick={onRetry} style={{ alignSelf: 'flex-start', padding: '4px 10px', fontSize: '12px', borderRadius: '8px', border: '1px solid currentColor', background: 'transparent', color: 'var(--ds-error-text)', cursor: 'pointer' }}>
            {L.t('sme.home.retry')}
          </button>
        </>
      )}
    </section>
  );
}

function StatCard({ icon, label, value, basis, href, link, warning, testId, chip, note, extra }: {
  icon: ReactNode; label: string; value: string; basis: string; href: string; link: string; warning?: boolean; testId: string;
  chip?: ReactNode; note?: string; extra?: ReactNode;
}) {
  return (
    <section data-testid={testId} style={{ ...card, display: 'flex', flexDirection: 'column', gap: '6px' }} aria-label={label}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--ds-text-muted)' }}>
        <span style={{ display: 'inline-flex', width: '30px', height: '30px', borderRadius: '8px', alignItems: 'center', justifyContent: 'center', background: 'var(--ds-bg-tinted)', color: warning ? 'var(--ds-warning-text)' : 'var(--ds-accent-primary)' }}>{icon}</span>
        {label}
      </div>
      <p style={{ margin: '4px 0 0', fontSize: '26px', fontWeight: 600, color: 'var(--ds-text-heading)', letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums' }}>{value}</p>
      {chip && <div>{chip}</div>}
      <p style={{ ...muted, fontSize: '12px', color: warning ? 'var(--ds-warning-text)' : 'var(--ds-text-muted)' }}>{basis}</p>
      {note && <p style={{ ...muted, fontSize: '12px' }}>{note}</p>}
      {extra}
      <Link href={href} style={{ marginTop: 'auto', paddingTop: '6px', fontSize: '13px', fontWeight: 500, color: 'var(--ds-accent-primary)', textDecoration: 'none' }}>{link}</Link>
    </section>
  );
}
