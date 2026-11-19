'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

/** The one page header used across the finance screens: back link, title, description, actions. */
export function PageHeader({ title, description, actions, back, badge }: {
  title: ReactNode;
  /** Shown beside the title, e.g. a status chip. */
  badge?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <header style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 16px', alignItems: 'flex-end', justifyContent: 'space-between' }}>
      <div style={{ flex: '1 1 320px', minWidth: 0 }}>
        {back && (
          <Link href={back.href} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--ds-text-muted)', textDecoration: 'none', marginBottom: '8px' }}>
            {/* Points back: right in RTL, left in LTR. */}
            <ArrowRight size={14} className="ltr:rotate-180" aria-hidden />
            {back.label}
          </Link>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: '22px', fontWeight: 600, lineHeight: 1.3, color: 'var(--ds-text-heading)', margin: 0, overflowWrap: 'anywhere' }}>{title}</h1>
          {badge}
        </div>
        {description && <p style={{ fontSize: '14px', lineHeight: 1.6, color: 'var(--ds-text-muted)', margin: '6px 0 0', maxWidth: '72ch' }}>{description}</p>}
      </div>
      {actions && <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>{actions}</div>}
    </header>
  );
}
