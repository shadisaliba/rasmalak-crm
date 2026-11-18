import type { CSSProperties } from 'react';

export const cardStyle: CSSProperties = {
  background: 'var(--ds-bg-card)',
  border: '0.5px solid var(--ds-border)',
  borderRadius: '16px',
  padding: '24px',
  boxShadow: 'var(--ds-shadow-card)',
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
};

export const headingStyle: CSSProperties = {
  fontSize: '16px',
  fontWeight: 600,
  color: 'var(--ds-text-heading)',
  margin: 0,
};

export const mutedStyle: CSSProperties = {
  fontSize: '13px',
  color: 'var(--ds-text-muted)',
  margin: 0,
};

export const labelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  fontSize: '13px',
  fontWeight: 500,
  color: 'var(--ds-text-body)',
};

export const inputStyle: CSSProperties = {
  padding: '10px 12px',
  fontSize: '14px',
  border: '1px solid var(--ds-border)',
  borderRadius: '8px',
  background: 'var(--ds-bg-input)',
  color: 'var(--ds-text-body)',
  outline: 'none',
  width: '100%',
  maxWidth: '360px',
};

export function buttonStyle(variant: 'primary' | 'secondary' | 'danger', disabled = false): CSSProperties {
  const base: CSSProperties = {
    padding: '9px 16px',
    fontSize: '13px',
    fontWeight: 500,
    borderRadius: '8px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
    alignSelf: 'flex-start',
  };
  if (variant === 'primary') return { ...base, background: 'var(--ds-primary)', color: '#FFFFFF', border: 'none' };
  if (variant === 'danger') return { ...base, background: 'var(--ds-error-bg)', color: 'var(--ds-error-text)', border: '1px solid var(--ds-error-border)' };
  return { ...base, background: 'transparent', color: 'var(--ds-text-body)', border: '1px solid var(--ds-border)' };
}

export function noticeStyle(kind: 'error' | 'success'): CSSProperties {
  return {
    padding: '10px 12px',
    fontSize: '13px',
    borderRadius: '8px',
    background: kind === 'error' ? 'var(--ds-error-bg)' : 'var(--ds-success-bg)',
    color: kind === 'error' ? 'var(--ds-error-text)' : 'var(--ds-success-text)',
    border: `1px solid ${kind === 'error' ? 'var(--ds-error-border)' : 'var(--ds-success-border)'}`,
  };
}
