'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useIntl } from 'react-intl';
import { supabase } from '@/lib/supabaseClient';
import { buttonStyle, cardStyle, headingStyle, inputStyle, labelStyle, mutedStyle, noticeStyle } from './styles';

type Notice = { kind: 'error' | 'success'; text: string } | null;

const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
const TOTP_CODE = /^\d{6}$/;

// Arabic keyboards type Arabic-Indic digits; authenticator codes are compared as Western digits.
function normalizeDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\D/g, '')
    .slice(0, 6);
}

function useT() {
  const intl = useIntl();
  return (id: string) => intl.formatMessage({ id });
}

export function SecuritySettings() {
  const t = useT();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '720px' }}>
      <div>
        <h1 style={{ fontSize: '24px', fontWeight: 600, color: 'var(--ds-text-heading)', margin: '0 0 4px' }}>
          {t('settings.security_settings')}
        </h1>
        <p style={mutedStyle}>{t('settings.security_description')}</p>
      </div>
      <PasswordCard />
      <TwoFactorCard />
    </div>
  );
}

function PasswordCard() {
  const t = useT();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    if (!PASSWORD_RULE.test(next)) {
      setNotice({ kind: 'error', text: t('settings.password_requirements') });
      return;
    }
    if (next !== confirm) {
      setNotice({ kind: 'error', text: t('settings.password_mismatch') });
      return;
    }
    setBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) throw new Error('no session');
      // Re-authenticating proves the person at the keyboard knows the current password.
      const { error: reauthError } = await supabase.auth.signInWithPassword({ email: user.email, password: current });
      if (reauthError) {
        setNotice({ kind: 'error', text: t('settings.password_incorrect') });
        return;
      }
      const { error } = await supabase.auth.updateUser({ password: next });
      if (error) throw error;
      setCurrent('');
      setNext('');
      setConfirm('');
      setNotice({ kind: 'success', text: t('settings.password_updated') });
    } catch {
      setNotice({ kind: 'error', text: t('settings.password_update_failed') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} style={cardStyle} aria-labelledby="change-password-heading">
      <h2 id="change-password-heading" style={headingStyle}>{t('settings.change_password')}</h2>
      {notice && <div role={notice.kind === 'error' ? 'alert' : 'status'} style={noticeStyle(notice.kind)}>{notice.text}</div>}
      <label style={labelStyle}>
        {t('settings.current_password')}
        <input type="password" autoComplete="current-password" required value={current} onChange={e => setCurrent(e.target.value)} style={inputStyle} />
      </label>
      <label style={labelStyle}>
        {t('settings.new_password')}
        <input type="password" autoComplete="new-password" required value={next} onChange={e => setNext(e.target.value)} style={inputStyle} />
        <span style={mutedStyle}>{t('settings.password_requirements')}</span>
      </label>
      <label style={labelStyle}>
        {t('settings.confirm_password')}
        <input type="password" autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)} style={inputStyle} />
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        <button type="submit" disabled={busy || !current || !next || !confirm} style={buttonStyle('primary', busy || !current || !next || !confirm)}>
          {busy ? t('settings.saving') : t('settings.update_password')}
        </button>
        <Link href="/forgot-password" style={{ fontSize: '13px', color: 'var(--ds-primary)' }}>
          {t('settings.forgot_password')}
        </Link>
      </div>
    </form>
  );
}

type Enrollment = { factorId: string; qrCode: string; secret: string };

function TwoFactorCard() {
  const t = useT();
  const [verifiedFactorId, setVerifiedFactorId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<'idle' | 'enrolling' | 'removing'>('idle');
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const loadFactors = useCallback(async () => {
    const { data, error } = await supabase.auth.mfa.listFactors();
    // `totp` lists verified TOTP factors only.
    setVerifiedFactorId(error ? null : data.totp[0]?.id ?? null);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void loadFactors();
  }, [loadFactors]);

  const resetFlow = () => {
    setMode('idle');
    setEnrollment(null);
    setCode('');
  };

  const startEnrollment = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const { data: list } = await supabase.auth.mfa.listFactors();
      // An abandoned setup leaves an unverified factor that would block a new enrolment.
      for (const factor of list?.all ?? []) {
        if (factor.factor_type === 'totp' && factor.status === 'unverified') {
          await supabase.auth.mfa.unenroll({ factorId: factor.id });
        }
      }
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Rasmalak CRM' });
      if (error) throw error;
      setEnrollment({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
      setCode('');
      setMode('enrolling');
    } catch {
      setNotice({ kind: 'error', text: t('settings.two_factor_error') });
    } finally {
      setBusy(false);
    }
  };

  const cancelEnrollment = async () => {
    const pending = enrollment;
    resetFlow();
    if (pending) await supabase.auth.mfa.unenroll({ factorId: pending.factorId });
  };

  const verifyEnrollment = async () => {
    if (!enrollment) return;
    if (!TOTP_CODE.test(code)) {
      setNotice({ kind: 'error', text: t('settings.two_factor_invalid_code') });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrollment.factorId, code });
      if (error) {
        setNotice({ kind: 'error', text: t('settings.two_factor_invalid_code') });
        return;
      }
      resetFlow();
      await loadFactors();
      setNotice({ kind: 'success', text: t('settings.two_factor_success') });
    } finally {
      setBusy(false);
    }
  };

  const confirmRemoval = async () => {
    if (!verifiedFactorId) return;
    if (!TOTP_CODE.test(code)) {
      setNotice({ kind: 'error', text: t('settings.two_factor_invalid_code') });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      // Supabase only removes a verified factor from an aal2 session, so prove possession first.
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: verifiedFactorId, code });
      if (verifyError) {
        setNotice({ kind: 'error', text: t('settings.two_factor_invalid_code') });
        return;
      }
      const { error } = await supabase.auth.mfa.unenroll({ factorId: verifiedFactorId });
      if (error) throw error;
      resetFlow();
      await loadFactors();
      setNotice({ kind: 'success', text: t('settings.two_factor_removed') });
    } catch {
      setNotice({ kind: 'error', text: t('settings.two_factor_error') });
    } finally {
      setBusy(false);
    }
  };

  const codeInput = (
    <label style={labelStyle}>
      {t('settings.verification_code')}
      <input
        value={code}
        onChange={e => setCode(normalizeDigits(e.target.value))}
        inputMode="numeric"
        autoComplete="one-time-code"
        dir="ltr"
        style={{ ...inputStyle, maxWidth: '160px', letterSpacing: '0.3em', fontFamily: 'monospace' }}
      />
    </label>
  );

  return (
    <section style={cardStyle} aria-labelledby="two-factor-heading">
      <div>
        <h2 id="two-factor-heading" style={headingStyle}>{t('settings.two_factor_auth')}</h2>
        <p style={{ ...mutedStyle, marginTop: '4px' }}>
          {verifiedFactorId ? t('settings.two_factor_enabled_desc') : t('settings.two_factor_auth_description')}
        </p>
      </div>

      {notice && <div role={notice.kind === 'error' ? 'alert' : 'status'} style={noticeStyle(notice.kind)}>{notice.text}</div>}

      {loaded && mode === 'idle' && !verifiedFactorId && (
        <button type="button" onClick={startEnrollment} disabled={busy} style={buttonStyle('primary', busy)}>
          {t('settings.two_factor_setup')}
        </button>
      )}

      {loaded && mode === 'idle' && verifiedFactorId && (
        <>
          <p style={{ ...mutedStyle, color: 'var(--ds-text-body)' }}>{t('settings.two_factor_method')}</p>
          <button type="button" onClick={() => { setNotice(null); setCode(''); setMode('removing'); }} style={buttonStyle('danger')}>
            {t('settings.two_factor_disable')}
          </button>
        </>
      )}

      {mode === 'enrolling' && enrollment && (
        <>
          <div>
            <h3 style={{ ...headingStyle, fontSize: '14px' }}>{t('settings.two_factor_step1_title')}</h3>
            <p style={{ ...mutedStyle, marginTop: '4px' }}>{t('settings.two_factor_step1_desc')}</p>
          </div>
          {/* Supabase returns the QR code as an SVG data URI; next/image adds nothing for it. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enrollment.qrCode} alt={t('settings.two_factor_step1_title')} width={180} height={180} style={{ background: '#FFFFFF', borderRadius: '8px', padding: '8px' }} />
          <div>
            <p style={mutedStyle}>{t('settings.two_factor_secret_hint')}</p>
            <code dir="ltr" style={{ display: 'inline-block', marginTop: '6px', fontSize: '13px', padding: '6px 10px', borderRadius: '6px', background: 'var(--ds-bg-tinted)', color: 'var(--ds-text-heading)', wordBreak: 'break-all' }}>
              {enrollment.secret}
            </code>
          </div>
          <div>
            <h3 style={{ ...headingStyle, fontSize: '14px' }}>{t('settings.two_factor_step2_title')}</h3>
            <p style={{ ...mutedStyle, marginTop: '4px' }}>{t('settings.two_factor_step2_desc')}</p>
          </div>
          {codeInput}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="button" onClick={verifyEnrollment} disabled={busy || code.length !== 6} style={buttonStyle('primary', busy || code.length !== 6)}>
              {busy ? t('settings.verifying') : t('settings.two_factor_verify')}
            </button>
            <button type="button" onClick={cancelEnrollment} disabled={busy} style={buttonStyle('secondary', busy)}>
              {t('settings.cancel')}
            </button>
          </div>
        </>
      )}

      {mode === 'removing' && (
        <>
          <p style={{ ...mutedStyle, color: 'var(--ds-text-body)' }}>{t('settings.two_factor_disable_confirm')}</p>
          <p style={mutedStyle}>{t('settings.two_factor_remove_prompt')}</p>
          {codeInput}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="button" onClick={confirmRemoval} disabled={busy || code.length !== 6} style={buttonStyle('danger', busy || code.length !== 6)}>
              {busy ? t('settings.verifying') : t('settings.two_factor_disable')}
            </button>
            <button type="button" onClick={resetFlow} disabled={busy} style={buttonStyle('secondary', busy)}>
              {t('settings.cancel')}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
