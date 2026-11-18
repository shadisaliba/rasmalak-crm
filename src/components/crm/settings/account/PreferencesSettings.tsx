'use client';

import type { ReactNode } from 'react';
import { useIntl } from 'react-intl';
import { Check } from 'lucide-react';
import { useStore, type Theme } from '@/store/useStore';
import { ACCENT_COLOR_OPTIONS } from '@/lib/constants';
import type { Language } from '@/lib/translations';
import { cardStyle, headingStyle, mutedStyle } from './styles';

// The design system excludes purple, violet and indigo; fuchsia reads as purple too.
const EXCLUDED_ACCENTS = new Set(['Indigo', 'Fuchsia']);
const ALLOWED_ACCENTS = ACCENT_COLOR_OPTIONS.filter(o => o.family !== 'purple' && !EXCLUDED_ACCENTS.has(o.label));

function ChoiceButton({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      style={{
        padding: '10px 16px',
        fontSize: '14px',
        borderRadius: '10px',
        cursor: 'pointer',
        border: selected ? '1.5px solid var(--ds-primary)' : '1px solid var(--ds-border)',
        background: selected ? 'var(--ds-bg-tinted)' : 'var(--ds-bg-card)',
        color: 'var(--ds-text-heading)',
        fontWeight: selected ? 600 : 400,
        minWidth: '120px',
      }}
    >
      {children}
    </button>
  );
}

export function PreferencesSettings() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const language = useStore(s => s.language);
  const setLanguage = useStore(s => s.setLanguage);
  const theme = useStore(s => s.theme);
  const setTheme = useStore(s => s.setTheme);
  const accentColor = useStore(s => s.accentColor);
  const setAccentColor = useStore(s => s.setAccentColor);

  const languages: Array<{ value: Language; label: string }> = [
    { value: 'ar', label: 'العربية' },
    { value: 'en', label: 'English' },
  ];
  const themes: Array<{ value: Theme; labelId: string }> = [
    { value: 'light', labelId: 'settings.light' },
    { value: 'dark', labelId: 'settings.dark' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '720px' }}>
      <div>
        <h1 style={{ fontSize: '24px', fontWeight: 600, color: 'var(--ds-text-heading)', margin: '0 0 4px' }}>
          {t('settings.preferences')}
        </h1>
        <p style={mutedStyle}>{t('settings.preferences_description')}</p>
      </div>

      <section style={cardStyle} aria-labelledby="pref-language">
        <div>
          <h2 id="pref-language" style={headingStyle}>{t('settings.interface_language')}</h2>
          <p style={{ ...mutedStyle, marginTop: '4px' }}>{t('settings.language_applies_immediately')}</p>
        </div>
        <div role="radiogroup" aria-labelledby="pref-language" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {languages.map(l => (
            <ChoiceButton key={l.value} selected={language === l.value} onClick={() => setLanguage(l.value)}>
              <span lang={l.value}>{l.label}</span>
            </ChoiceButton>
          ))}
        </div>
      </section>

      <section style={cardStyle} aria-labelledby="pref-theme">
        <h2 id="pref-theme" style={headingStyle}>{t('settings.appearance')}</h2>
        <div role="radiogroup" aria-labelledby="pref-theme" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {themes.map(th => (
            <ChoiceButton key={th.value} selected={theme === th.value} onClick={() => setTheme(th.value)}>
              {t(th.labelId)}
            </ChoiceButton>
          ))}
        </div>
      </section>

      <section style={cardStyle} aria-labelledby="pref-accent">
        <div>
          <h2 id="pref-accent" style={headingStyle}>{t('settings.accent_color')}</h2>
          <p style={{ ...mutedStyle, marginTop: '4px' }}>{t('settings.accent_color_description')}</p>
        </div>
        <div role="radiogroup" aria-labelledby="pref-accent" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {ALLOWED_ACCENTS.map(option => {
            const selected = accentColor === option.value;
            const label = language === 'ar' ? option.labelAr : option.label;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={label}
                title={label}
                onClick={() => setAccentColor(option.value)}
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  background: option.value,
                  border: selected ? '2px solid var(--ds-text-heading)' : '2px solid transparent',
                  outline: '1px solid var(--ds-border)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {selected && <Check size={16} color="#FFFFFF" aria-hidden />}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
