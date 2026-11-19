'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { useIntl } from 'react-intl';
import { useRouter } from 'next/navigation';
import { useOrg } from '@/store/orgStore';
import { useCrm } from '@/store/crmStore';
import type { CSSProperties } from 'react';
import { Menu, Bell, Languages, Sun, Moon } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { useAuthStore } from '@/store/authStore';
import type { CrmNotification } from '@/types/crm';
import { OrgSwitcher } from './OrgSwitcher';

const iconButton: CSSProperties = {
  width: '36px', height: '36px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  borderRadius: '10px', border: '1px solid transparent', background: 'transparent', color: 'var(--ds-text-body)',
  cursor: 'pointer', position: 'relative', flexShrink: 0,
};

interface CrmHeaderProps {
  onMenuToggle: () => void;
}

export function CrmHeader({ onMenuToggle }: CrmHeaderProps) {
  const intl = useIntl();
  const router = useRouter();
  const { currentOrg } = useOrg();
  const { notifications, markNotificationRead, markAllNotificationsRead } = useCrm();
  const [showNotifs, setShowNotifs] = useState(false);
  const theme = useStore(st => st.theme);
  const toggleTheme = useStore(st => st.toggleTheme);
  const setLanguage = useStore(st => st.setLanguage);
  const userEmail = useAuthStore(st => st.user?.email ?? null);
  const notifRef = useRef<HTMLDivElement>(null);

  const t = (key: string, def: string) =>
    intl.formatMessage({ id: key, defaultMessage: def });

  const isAr = intl.locale.startsWith('ar');
  const orgName = isAr
    ? (currentOrg?.nameAr || currentOrg?.name || '')
    : (currentOrg?.name || '');

  const unreadCount = useMemo(
    () => notifications.filter(n => !n.isRead).length,
    [notifications]
  );

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setShowNotifs(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleNotifClick = async (notif: CrmNotification) => {
    if (!notif.isRead) await markNotificationRead(notif.id);
    setShowNotifs(false);
    if (notif.entityType && notif.entityId) {
      const routes: Record<string, string> = {
        deal: '/crm/deals',
        contact: '/crm/contacts',
        task: '/crm/tasks',
      };
      const base = routes[notif.entityType] || '/crm';
      router.push(`${base}/${notif.entityId}`);
    }
  };

  const formatTime = (ts: string) => {
    try { return new Intl.DateTimeFormat(intl.locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(ts)); }
    catch { return ''; }
  };

  return (
    <header
      style={{
        height: '60px',
        background: 'var(--ds-bg-card)',
        borderBlockEnd: '1px solid var(--ds-border)',
        display: 'flex',
        alignItems: 'center',
        paddingInline: '1rem',
        gap: '8px',
      }}
    >
      <button onClick={onMenuToggle} className="crm-header-menu crm-header-btn" style={{ ...iconButton, display: 'none' }}
        aria-label={t('crm.header.menu', 'Menu')}>
        <Menu size={20} />
      </button>

      {/* Org name, or a switcher for users in several organizations; shrinks first on small screens. */}
      <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex' }}>
        <OrgSwitcher />
      </div>

      <button type="button" className="crm-header-btn" onClick={() => setLanguage(isAr ? 'en' : 'ar')}
        aria-label={t(isAr ? 'crm.header.switchToEnglish' : 'crm.header.switchToArabic', isAr ? 'Switch to English' : 'التبديل إلى العربية')}
        style={{ ...iconButton, width: 'auto', paddingInline: '10px', gap: '6px', border: '1px solid var(--ds-border)', fontSize: '13px', fontWeight: 500 }}>
        <Languages size={16} />
        {/* The other language, written in that language. */}
        <span className="crm-header-lang-long" lang={isAr ? 'en' : 'ar'}>{isAr ? 'English' : 'العربية'}</span>
        <span className="crm-header-lang-short" lang={isAr ? 'en' : 'ar'} style={{ display: 'none' }}>{isAr ? 'EN' : 'ع'}</span>
      </button>

      <button type="button" className="crm-header-btn" onClick={toggleTheme} style={iconButton}
        aria-label={t(theme === 'dark' ? 'crm.header.lightMode' : 'crm.header.darkMode', theme === 'dark' ? 'Light mode' : 'Dark mode')}>
        {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
      </button>

      {/* Bell icon + notification dropdown */}
      <div ref={notifRef} style={{ position: 'relative' }}>
        <button
          className="crm-header-btn"
          onClick={() => setShowNotifs(prev => !prev)}
          style={iconButton}
          aria-label={t('crm.nav.notifications', 'Notifications')}
        >
          <Bell size={19} />
          {unreadCount > 0 && (
            <span
              style={{
                position: 'absolute',
                insetBlockStart: '4px',
                insetInlineEnd: '4px',
                minWidth: '16px',
                height: '16px',
                paddingInline: '3px',
                borderRadius: '999px',
                background: 'var(--ds-error)',
                color: '#FFFFFF',
                fontSize: '9px',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {unreadCount > 9 ? intl.formatNumber(9) + '+' : intl.formatNumber(unreadCount)}
            </span>
          )}
        </button>

        {/* Notification dropdown */}
        {showNotifs && (
          <div
            className="crm-notif-dropdown"
            style={{
              position: 'absolute',
              insetBlockStart: '100%',
              insetInlineEnd: 0,
              marginTop: '8px',
              width: '340px',
              maxHeight: '400px',
              overflowY: 'auto',
              background: 'var(--ds-bg-card)',
              border: '0.5px solid var(--ds-border)',
              borderRadius: '16px',
              boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
              zIndex: 50,
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', borderBlockEnd: '1px solid var(--ds-border)' }}>
              <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--ds-text-heading)' }}>
                {t('crm.nav.notifications', 'Notifications')}
              </span>
              {unreadCount > 0 && (
                <button
                  onClick={() => markAllNotificationsRead()}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', color: 'var(--ds-accent-primary)', fontWeight: 500 }}
                >
                  {t('crm.action.markAllRead', 'Mark All Read')}
                </button>
              )}
            </div>

            {/* Notifications list */}
            {notifications.length === 0 ? (
              <div style={{ padding: '2rem 1rem', textAlign: 'center' }}>
                <p style={{ fontSize: '13px', color: 'var(--ds-text-muted)' }}>
                  {t('crm.empty.notifications.title', 'No notifications')}
                </p>
              </div>
            ) : (
              notifications.slice(0, 20).map(notif => (
                <button
                  key={notif.id}
                  onClick={() => handleNotifClick(notif)}
                  style={{
                    display: 'flex',
                    gap: '10px',
                    width: '100%',
                    padding: '12px 16px',
                    border: 'none',
                    borderBlockEnd: '1px solid var(--ds-border)',
                    background: notif.isRead ? 'transparent' : 'var(--ds-bg-tinted)',
                    cursor: 'pointer',
                    textAlign: 'start',
                  }}
                >
                  {/* Unread dot */}
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: notif.isRead ? 'transparent' : 'var(--ds-accent-primary)', flexShrink: 0, marginTop: '4px' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: notif.isRead ? 400 : 500, color: 'var(--ds-text-heading)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {isAr ? (notif.titleAr || notif.title) : notif.title}
                    </div>
                    {(notif.body || notif.bodyAr) && (
                      <div style={{ fontSize: '12px', color: 'var(--ds-text-muted)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {isAr ? (notif.bodyAr || notif.body) : notif.body}
                      </div>
                    )}
                    <div style={{ fontSize: '11px', color: 'var(--ds-text-muted)', marginTop: '4px' }}>
                      {formatTime(notif.createdAt)}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <div
        title={userEmail ?? undefined}
        style={{
          width: '32px', height: '32px', borderRadius: '50%',
          background: 'var(--ds-accent-primary)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--ds-on-primary)', fontSize: '13px', fontWeight: 600, flexShrink: 0, marginInlineStart: '4px',
        }}
      >
        {(userEmail ?? orgName).charAt(0).toUpperCase() || 'C'}
      </div>

      {/* Responsive CSS */}
      <style>{`
        .crm-header-btn:hover { background: var(--ds-bg-tinted) !important; }
        .crm-header-btn:focus-visible { outline: 2px solid var(--ds-accent-primary); outline-offset: 2px; }
        @media (max-width: 767px) {
          .crm-header-menu { display: inline-flex !important; }
          .crm-header-lang-long { display: none !important; }
          .crm-header-lang-short { display: inline !important; }
          .crm-notif-dropdown { width: 100vw !important; inset-inline-start: auto !important; inset-inline-end: -1rem !important; border-radius: 0 0 16px 16px !important; }
        }
      `}</style>
    </header>
  );
}
