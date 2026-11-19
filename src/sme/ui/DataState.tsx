'use client';

import type { CSSProperties, ReactNode } from 'react';
import { useIntl } from 'react-intl';

// The eight screen states every SME screen implements (blueprint §2, rule R3).
export const DATA_STATES = ['loading', 'empty', 'partial', 'validated', 'stale', 'review_needed', 'denied', 'failed'] as const;
export type DataStateKind = (typeof DATA_STATES)[number];

/** States that replace the content; the others show a notice above it. */
const REPLACES_CONTENT = new Set<DataStateKind>(['loading', 'empty', 'denied', 'failed']);

const TONE: Record<DataStateKind, CSSProperties> = {
  loading: { background: 'var(--ds-bg-card)', borderColor: 'var(--ds-border)', color: 'var(--ds-text-muted)' },
  empty: { background: 'var(--ds-bg-card)', borderColor: 'var(--ds-border)', color: 'var(--ds-text-body)' },
  partial: { background: 'var(--ds-warning-bg)', borderColor: 'var(--ds-warning-border)', color: 'var(--ds-warning-text)' },
  validated: {},
  stale: { background: 'var(--ds-warning-bg)', borderColor: 'var(--ds-warning-border)', color: 'var(--ds-warning-text)' },
  review_needed: { background: 'var(--ds-bg-tinted)', borderColor: 'var(--ds-border-tinted)', color: 'var(--ds-text-body)' },
  denied: { background: 'var(--ds-bg-card)', borderColor: 'var(--ds-border)', color: 'var(--ds-text-muted)' },
  failed: { background: 'var(--ds-error-bg)', borderColor: 'var(--ds-error-border)', color: 'var(--ds-error-text)' },
};

interface DataStateProps {
  state: DataStateKind;
  children?: ReactNode;
  /** Replaces the default message for the state. */
  message?: string;
  /** A corrective action, e.g. "Add account" for empty. */
  action?: ReactNode;
  onRetry?: () => void;
}

export function DataState({ state, children, message, action, onRetry }: DataStateProps) {
  const intl = useIntl();
  const text = message ?? intl.formatMessage({ id: `sme.state.${state}` });
  const box: CSSProperties = {
    display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 14px', padding: '12px 16px',
    borderRadius: '12px', border: '1px solid', fontSize: '14px', ...TONE[state],
  };

  if (REPLACES_CONTENT.has(state)) {
    return (
      <div data-state={state} role={state === 'denied' || state === 'failed' ? 'alert' : 'status'} aria-busy={state === 'loading' || undefined}
        style={{ ...box, padding: state === 'empty' ? '28px 20px' : box.padding, justifyContent: state === 'empty' ? 'center' : undefined, textAlign: state === 'empty' ? 'center' : undefined }}>
        <span style={{ flex: state === 'empty' ? '1 1 100%' : 1 }}>{text}</span>
        {state === 'failed' && onRetry && (
          <button type="button" onClick={onRetry} style={{ padding: '6px 12px', fontSize: '13px', borderRadius: '8px', border: '1px solid currentColor', background: 'transparent', color: 'inherit', cursor: 'pointer' }}>
            {intl.formatMessage({ id: 'sme.state.retry' })}
          </button>
        )}
        {action}
      </div>
    );
  }
  return (
    <div data-state={state} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {state !== 'validated' && <div role="status" style={box}><span style={{ flex: 1 }}>{text}</span>{action}</div>}
      {children}
    </div>
  );
}
