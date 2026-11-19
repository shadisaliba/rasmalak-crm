'use client';

import { useIntl } from 'react-intl';

/** Shown on every invoice screen (W3a-02 §5, pending gate G6). */
export function RegisterNote() {
  const intl = useIntl();
  return (
    <p role="note" data-testid="register-note" style={{ margin: 0, padding: '8px 12px', borderRadius: '10px', fontSize: '12px', background: 'var(--ds-bg-tinted)', border: '1px solid var(--ds-border-tinted)', color: 'var(--ds-text-body)' }}>
      {intl.formatMessage({ id: 'sme.receivables.note' })}
    </p>
  );
}
