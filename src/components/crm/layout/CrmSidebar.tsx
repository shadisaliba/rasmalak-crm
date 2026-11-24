'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useIntl } from 'react-intl';
import type { LucideIcon } from 'lucide-react';
import {
  Home, LayoutDashboard, Kanban, Users, Building2, Handshake, CheckSquare, BarChart3, Zap, FileText,
  Upload, Settings, LogOut, X, Landmark, ArrowLeftRight, ReceiptText, FileMinus, BriefcaseBusiness, KeyRound, TrendingUp, ChartLine, ListChecks, Calculator, GraduationCap, FilePenLine,
} from 'lucide-react';
import { useLogout } from '@/store/useStore';
import { useAuthStore } from '@/store/authStore';
import { useOrg } from '@/store/orgStore';
import type { CrmPermissions } from '@/types/crm';
import { useSmeEnabled } from '@/sme/ui/useSmeEnabled';
import { useIsStaff } from '@/sme/content/ui/useIsStaff';

interface CrmSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

interface NavItem {
  id: string;
  path: string;
  icon: LucideIcon;
  labelKey: string;
  labelDefault: string;
  permission?: keyof CrmPermissions;
  /** Exact match only (the pipeline lives at /crm, a prefix of every page). */
  exact?: boolean;
  /** Platform staff only (content review). */
  staffOnly?: boolean;
}
interface NavGroup { id: string; labelKey?: string; labelDefault?: string; items: NavItem[] }

const SALES_ITEMS: NavItem[] = [
  { id: 'pipeline', path: '/crm', icon: Kanban, labelKey: 'crm.nav.pipeline', labelDefault: 'Pipeline', exact: true, permission: 'deals.read' },
  { id: 'contacts', path: '/crm/contacts', icon: Users, labelKey: 'crm.nav.contacts', labelDefault: 'Contacts', permission: 'contacts.read' },
  { id: 'companies', path: '/crm/companies', icon: Building2, labelKey: 'crm.nav.companies', labelDefault: 'Companies', permission: 'companies.read' },
  { id: 'deals', path: '/crm/deals', icon: Handshake, labelKey: 'crm.nav.deals', labelDefault: 'Deals', permission: 'deals.read' },
  { id: 'tasks', path: '/crm/tasks', icon: CheckSquare, labelKey: 'crm.nav.tasks', labelDefault: 'Tasks', permission: 'tasks.read' },
  { id: 'reports', path: '/crm/reports', icon: BarChart3, labelKey: 'crm.nav.reports', labelDefault: 'Reports', permission: 'reports.view' },
  { id: 'automation', path: '/crm/automation', icon: Zap, labelKey: 'crm.nav.automation', labelDefault: 'Automation' },
  { id: 'documents', path: '/crm/documents', icon: FileText, labelKey: 'crm.nav.documents', labelDefault: 'Documents' },
  { id: 'import', path: '/crm/import', icon: Upload, labelKey: 'crm.nav.import', labelDefault: 'Import Data', permission: 'import.execute' },
];

// Blueprint navigation (§2): Home, Money, Tools and Learn, then the CRM as Sales, then Business settings.
const SME_GROUPS: NavGroup[] = [
  { id: 'home', items: [{ id: 'home', path: '/crm/dashboard', icon: Home, labelKey: 'sme.nav.home', labelDefault: 'Home' }] },
  {
    id: 'money', labelKey: 'sme.nav.money', labelDefault: 'Money', items: [
      { id: 'actions', path: '/crm/money/actions', icon: ListChecks, labelKey: 'actions.nav', labelDefault: 'Needs attention', permission: 'sme.ledger.read' },
      { id: 'accounts', path: '/crm/money/accounts', icon: Landmark, labelKey: 'sme.nav.accounts', labelDefault: 'Accounts', permission: 'sme.ledger.read' },
      { id: 'transactions', path: '/crm/money/transactions', icon: ArrowLeftRight, labelKey: 'sme.nav.transactions', labelDefault: 'Transactions', permission: 'sme.ledger.read' },
      { id: 'receivables', path: '/crm/money/receivables', icon: ReceiptText, labelKey: 'sme.nav.receivables', labelDefault: 'Invoice records', permission: 'sme.receivables.read' },
      { id: 'payables', path: '/crm/money/payables', icon: FileMinus, labelKey: 'sme.nav.payables', labelDefault: 'Bills', permission: 'sme.payables.read' },
      { id: 'forecast', path: '/crm/money/forecast', icon: ChartLine, labelKey: 'forecast.nav', labelDefault: 'Cash forecast', permission: 'sme.forecast.read' },
    ],
  },
  {
    id: 'grow', labelKey: 'sme.nav.grow', labelDefault: 'Plan and learn', items: [
      { id: 'tools', path: '/crm/tools', icon: Calculator, labelKey: 'sme.nav.tools', labelDefault: 'Tools', permission: 'sme.calc.run' },
      { id: 'learn', path: '/crm/learn', icon: GraduationCap, labelKey: 'sme.nav.learn', labelDefault: 'Learn', permission: 'sme.learn.use' },
    ],
  },
  {
    id: 'sales', labelKey: 'sme.nav.sales', labelDefault: 'Sales', items: [
      { id: 'sales-overview', path: '/crm/sales', icon: TrendingUp, labelKey: 'sme.nav.salesOverview', labelDefault: 'Sales overview' },
      ...SALES_ITEMS,
    ],
  },
  {
    id: 'business', labelKey: 'sme.nav.business', labelDefault: 'Business', items: [
      { id: 'profile', path: '/crm/settings/business/profile', icon: BriefcaseBusiness, labelKey: 'sme.nav.businessProfile', labelDefault: 'Business profile', permission: 'sme.profile.read' },
      { id: 'access', path: '/crm/settings/business/access', icon: KeyRound, labelKey: 'sme.nav.access', labelDefault: 'Team and access', permission: 'sme.access.manage' },
      { id: 'content-review', path: '/crm/staff/content', icon: FilePenLine, labelKey: 'sme.nav.contentReview', labelDefault: 'Content review', staffOnly: true },
      { id: 'settings', path: '/crm/settings', icon: Settings, labelKey: 'crm.nav.settings', labelDefault: 'Settings', exact: true },
    ],
  },
];

const CRM_GROUPS: NavGroup[] = [
  { id: 'main', items: [{ id: 'dashboard', path: '/crm/dashboard', icon: LayoutDashboard, labelKey: 'crm.nav.dashboard', labelDefault: 'Dashboard' }, ...SALES_ITEMS] },
  { id: 'settings', items: [{ id: 'settings', path: '/crm/settings', icon: Settings, labelKey: 'crm.nav.settings', labelDefault: 'Settings' }] },
];

export function CrmSidebar({ isOpen, onClose }: CrmSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const logout = useLogout();
  const intl = useIntl();
  const { currentOrg, userPermissions } = useOrg();
  const email = useAuthStore(s => s.user?.email ?? '');
  const sme = useSmeEnabled();
  const staff = useIsStaff();
  const t = (key: string, def: string) => intl.formatMessage({ id: key, defaultMessage: def });

  const groups = (sme ? SME_GROUPS : CRM_GROUPS)
    .map(g => ({ ...g, items: g.items.filter(i => (!i.permission || userPermissions[i.permission]) && (!i.staffOnly || staff)) }))
    .filter(g => g.items.length > 0);
  const isActive = (item: NavItem) => (item.exact ? pathname === item.path : pathname === item.path || pathname.startsWith(`${item.path}/`));
  const orgName = currentOrg ? (intl.locale.startsWith('ar') ? currentOrg.nameAr || currentOrg.name : currentOrg.name) : '';

  return (
    <>
      {isOpen && (
        <div onClick={onClose} className="crm-sidebar-backdrop"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 60 }} aria-hidden />
      )}

      <aside className="crm-sidebar" style={{
        width: '16rem', minHeight: '100vh', background: 'var(--ds-bg-card)', borderInlineEnd: '1px solid var(--ds-border)',
        display: 'flex', flexDirection: 'column', position: 'fixed', insetBlockStart: 0, insetInlineStart: isOpen ? 0 : '-16rem',
        zIndex: 70, transition: 'inset-inline-start 200ms ease', overflowY: 'auto',
      }}>
        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '0 1rem', height: '60px', borderBlockEnd: '1px solid var(--ds-border)', flexShrink: 0 }}>
          <span aria-hidden style={{ width: '32px', height: '32px', borderRadius: '9px', background: 'var(--ds-accent-primary)', color: 'var(--ds-on-primary)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '17px', fontWeight: 700 }}>ر</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--ds-text-heading)', lineHeight: 1.2 }}>{t('crm.brand.name', 'Rasmalak')}</div>
            <div style={{ fontSize: '11px', color: 'var(--ds-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{orgName}</div>
          </div>
          <button onClick={onClose} className="crm-sidebar-close" aria-label={t('crm.nav.closeMenu', 'Close menu')}
            style={{ display: 'none', background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: 'var(--ds-text-muted)' }}>
            <X size={20} />
          </button>
        </div>

        <nav aria-label={t('crm.nav.main', 'Main')} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '18px', padding: '14px 10px' }}>
          {groups.map(group => (
            <div key={group.id} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {group.labelKey && (
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--ds-text-muted)', padding: '0 10px 6px', letterSpacing: '0.02em' }}>
                  {t(group.labelKey, group.labelDefault ?? '')}
                </div>
              )}
              {group.items.map(item => {
                const Icon = item.icon;
                const active = isActive(item);
                return (
                  <Link key={item.id} href={item.path} onClick={onClose} aria-current={active ? 'page' : undefined} className="crm-nav-item"
                    style={{
                      position: 'relative', display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', minHeight: '38px',
                      borderRadius: '8px', textDecoration: 'none', fontSize: '14px', fontWeight: active ? 600 : 400,
                      color: active ? 'var(--ds-text-heading)' : 'var(--ds-text-body)', background: active ? 'var(--ds-bg-tinted)' : 'transparent',
                    }}>
                    {active && <span aria-hidden style={{ position: 'absolute', insetInlineStart: 0, insetBlock: '8px', width: '3px', borderRadius: '3px', background: 'var(--ds-accent-primary)' }} />}
                    <Icon size={18} style={{ color: active ? 'var(--ds-accent-primary)' : 'var(--ds-text-muted)', flexShrink: 0 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t(item.labelKey, item.labelDefault)}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div style={{ borderBlockStart: '1px solid var(--ds-border)', padding: '10px', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          <span title={email} style={{ flex: 1, minWidth: 0, fontSize: '12px', color: 'var(--ds-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingInlineStart: '6px' }} dir="ltr">{email}</span>
          <button onClick={async () => { await logout(); router.replace('/login'); }} className="crm-nav-item"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '7px 10px', borderRadius: '8px', border: 'none', background: 'transparent', color: 'var(--ds-text-body)', cursor: 'pointer', fontSize: '13px' }}>
            <LogOut size={16} className="rtl:-scale-x-100" aria-hidden />
            {t('crm.nav.signOut', 'Sign out')}
          </button>
        </div>
      </aside>

      <style>{`
        .crm-nav-item:hover { background: var(--ds-bg-tinted) !important; }
        .crm-nav-item:focus-visible { outline: 2px solid var(--ds-accent-primary); outline-offset: -2px; }
        @media (min-width: 768px) {
          .crm-sidebar { position: sticky !important; inset-inline-start: 0 !important; height: 100vh; min-height: 0 !important; }
          .crm-sidebar-backdrop { display: none; }
        }
        @media (max-width: 767px) {
          .crm-sidebar-close { display: inline-flex !important; }
        }
      `}</style>
    </>
  );
}
