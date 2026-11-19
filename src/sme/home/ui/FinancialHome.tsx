'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, FileUp, Landmark, Plus, ReceiptText, FileMinus, RefreshCw } from 'lucide-react';
import { useOrg, useOrgPermission } from '@/store/orgStore';
import { smeApi } from '@/sme/api/client';
import { DataState } from '@/sme/ui/DataState';
import { PageHeader } from '@/sme/ui/PageHeader';
import { SmeSetupBanner } from '@/sme/profile/ui/SmeSetupBanner';
import { DataCompletenessBanner } from '@/sme/kpi/ui/DataCompletenessBanner';
import { card, muted, useLedgerText } from '@/sme/ledger/ui/shared';
import type { AccountSummary } from '@/sme/ledger/types';

interface AgeingRow { currency: string; is_total: boolean; current_minor: string; d1_30_minor: string; d31_60_minor: string; d61_90_minor: string; d90_plus_minor: string; total_minor: string }
interface PayablesOverview { buckets: Array<{ currency: string; bucket: string; count: number; minor: string }> }

interface HomeData {
  accounts: AccountSummary[] | null;
  receivables: AgeingRow | null;
  payables: PayablesOverview | null;
  loadedAt: string;
}

const sum = (...values: Array<string | undefined>) => values.reduce((s, v) => s + BigInt(v ?? '0'), 0n);

/** FIN-01, the financial home: cash, money to collect and to pay, completeness, what to do next. */
export function FinancialHome() {
  const L = useLedgerText();
  const { currentOrg } = useOrg();
  const canLedger = useOrgPermission('sme.ledger.read');
  const canReceivables = useOrgPermission('sme.receivables.read');
  const canPayables = useOrgPermission('sme.payables.read');
  const [data, setData] = useState<HomeData | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!currentOrg) return;
    let ignore = false;
    const orgId = currentOrg.id;
    Promise.all([
      canLedger ? smeApi<{ items: AccountSummary[] }>('accounts', { orgId }) : null,
      canReceivables ? smeApi<{ items: AgeingRow[] }>('ageing?register=invoice', { orgId }) : null,
      canPayables ? smeApi<PayablesOverview>('payables/overview', { orgId }) : null,
    ]).then(([accounts, receivables, payables]) => {
      if (ignore) return;
      setData({
        accounts: accounts?.ok ? accounts.data.items.filter(a => a.status === 'active') : null,
        receivables: receivables?.ok ? receivables.data.items.find(r => r.is_total && r.currency === 'JOD') ?? null : null,
        payables: payables?.ok ? payables.data : null,
        loadedAt: new Date().toISOString(),
      });
    });
    return () => { ignore = true; };
  }, [currentOrg, canLedger, canReceivables, canPayables, reloadKey]);

  const orgName = currentOrg ? L.localName(currentOrg.name, currentOrg.nameAr) : '';
  const header = (
    <PageHeader
      title={L.t('sme.home.title')}
      description={data ? L.t('sme.home.subtitle', { org: orgName, time: L.dateTime(data.loadedAt) }) : orgName}
      actions={
        <button type="button" onClick={() => setReloadKey(k => k + 1)} aria-label={L.t('sme.home.refresh')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '7px 12px', fontSize: '13px', borderRadius: '8px', border: '1px solid var(--ds-border)', background: 'transparent', color: 'var(--ds-text-body)', cursor: 'pointer' }}>
          <RefreshCw size={14} aria-hidden /> {L.t('sme.home.refresh')}
        </button>
      }
    />
  );

  if (!canLedger && !canReceivables && !canPayables) {
    return <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>{header}<DataState state="denied" /></div>;
  }
  if (!data) return <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>{header}<DataState state="loading" /></div>;

  const accounts = data.accounts ?? [];
  const cash = accounts.reduce((s, a) => s + BigInt(a.baseBalanceMinor), 0n);
  const latest = accounts.map(a => a.lastValueDate).filter((d): d is string => !!d).sort().at(-1) ?? null;
  const stale = accounts.filter(a => a.stale).length;
  const estimated = accounts.some(a => a.hasEstimatedOpening);
  const r = data.receivables;
  const collectOverdue = r ? sum(r.d1_30_minor, r.d31_60_minor, r.d61_90_minor, r.d90_plus_minor) : 0n;
  const collectTotal = r ? BigInt(r.total_minor) : 0n;
  const bucket = (name: string) => data.payables?.buckets.find(b => b.currency === 'JOD' && b.bucket === name);
  const payOverdue = BigInt(bucket('overdue')?.minor ?? '0');
  const pay7 = BigInt(bucket('d7')?.minor ?? '0');
  const payTotal = (data.payables?.buckets ?? []).filter(b => b.currency === 'JOD').reduce((s, b) => s + BigInt(b.minor), 0n);

  const actions: Array<{ icon: ReactNode; text: string; href: string; tone?: 'warning' }> = [];
  if (canLedger && accounts.length === 0) actions.push({ icon: <Landmark size={16} />, text: L.t('sme.home.action.addAccount'), href: '/crm/money/accounts' });
  if (collectOverdue > 0n) actions.push({ icon: <AlertTriangle size={16} />, text: L.t('sme.home.action.collectOverdue', { amount: L.amount(collectOverdue, 'JOD') }), href: '/crm/money/receivables', tone: 'warning' });
  if (payOverdue + pay7 > 0n) actions.push({ icon: <AlertTriangle size={16} />, text: L.t('sme.home.action.payDue', { amount: L.amount(payOverdue + pay7, 'JOD') }), href: '/crm/money/payables', tone: payOverdue > 0n ? 'warning' : undefined });
  if (stale > 0) actions.push({ icon: <FileUp size={16} />, text: L.t('sme.home.action.stale', { count: stale }), href: '/crm/money/transactions/import' });
  if (estimated) actions.push({ icon: <Landmark size={16} />, text: L.t('sme.home.action.estimate'), href: '/crm/money/accounts' });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {header}
      <SmeSetupBanner />
      {canLedger && <DataCompletenessBanner refreshKey={reloadKey} />}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>
        {canLedger && (
          <StatCard testId="home-cash" icon={<Landmark size={18} />} label={L.t('sme.home.cash')} value={L.amount(cash, 'JOD')}
            basis={accounts.length ? L.t('sme.home.cashBasis', { count: accounts.length, date: latest ? L.date(latest) : '—' }) : L.t('sme.home.noAccounts')}
            href="/crm/money/accounts" link={L.t('sme.home.viewAccounts')} />
        )}
        {canReceivables && (
          <StatCard testId="home-collect" icon={<ArrowDownLeft size={18} />} label={L.t('sme.home.toCollect')} value={L.amount(collectTotal, 'JOD')}
            basis={L.t('sme.home.collectBasis', { overdue: L.amount(collectOverdue, 'JOD'), notDue: L.amount(r ? BigInt(r.current_minor) : 0n, 'JOD') })}
            warning={collectOverdue > 0n} href="/crm/money/receivables" link={L.t('sme.home.viewInvoices')} />
        )}
        {canPayables && (
          <StatCard testId="home-pay" icon={<ArrowUpRight size={18} />} label={L.t('sme.home.toPay')} value={L.amount(payTotal, 'JOD')}
            basis={L.t('sme.home.payBasis', { overdue: L.amount(payOverdue, 'JOD'), week: L.amount(pay7, 'JOD') })}
            warning={payOverdue > 0n} href="/crm/money/payables" link={L.t('sme.home.viewBills')} />
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '12px', alignItems: 'start' }}>
        <section style={{ ...card, display: 'flex', flexDirection: 'column', gap: '10px' }} aria-labelledby="home-actions">
          <h2 id="home-actions" style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--ds-text-heading)' }}>{L.t('sme.home.priorities')}</h2>
          {actions.length === 0 ? <p style={muted}>{L.t('sme.home.nothingUrgent')}</p> : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {actions.map((a, i) => (
                <li key={i}>
                  <Link href={a.href} className="sme-row-link" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px', borderRadius: '10px', textDecoration: 'none', fontSize: '14px', color: a.tone === 'warning' ? 'var(--ds-warning-text)' : 'var(--ds-text-body)' }}>
                    <span style={{ display: 'inline-flex', color: a.tone === 'warning' ? 'var(--ds-warning-text)' : 'var(--ds-accent-primary)' }}>{a.icon}</span>
                    <span style={{ flex: 1 }}>{a.text}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
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
    </div>
  );
}

function StatCard({ icon, label, value, basis, href, link, warning, testId }: {
  icon: ReactNode; label: string; value: string; basis: string; href: string; link: string; warning?: boolean; testId: string;
}) {
  return (
    <section data-testid={testId} style={{ ...card, display: 'flex', flexDirection: 'column', gap: '6px' }} aria-label={label}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--ds-text-muted)' }}>
        <span style={{ display: 'inline-flex', width: '30px', height: '30px', borderRadius: '8px', alignItems: 'center', justifyContent: 'center', background: 'var(--ds-bg-tinted)', color: warning ? 'var(--ds-warning-text)' : 'var(--ds-accent-primary)' }}>{icon}</span>
        {label}
      </div>
      <p style={{ margin: '4px 0 0', fontSize: '26px', fontWeight: 600, color: 'var(--ds-text-heading)', letterSpacing: '-0.01em' }}>{value}</p>
      <p style={{ ...muted, fontSize: '12px', color: warning ? 'var(--ds-warning-text)' : 'var(--ds-text-muted)' }}>{basis}</p>
      <Link href={href} style={{ marginTop: 'auto', paddingTop: '6px', fontSize: '13px', fontWeight: 500, color: 'var(--ds-accent-primary)', textDecoration: 'none' }}>{link}</Link>
    </section>
  );
}
