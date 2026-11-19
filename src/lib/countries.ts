// Organizations store ISO 3166-1 alpha-2 codes; `labelKey` reuses the existing org.country.* messages.
export const ORG_COUNTRIES = [
  { code: 'JO', labelKey: 'jordan' },
  { code: 'AE', labelKey: 'uae' },
  { code: 'SA', labelKey: 'ksa' },
  { code: 'EG', labelKey: 'egypt' },
  { code: 'IQ', labelKey: 'iraq' },
  { code: 'KW', labelKey: 'kuwait' },
  { code: 'QA', labelKey: 'qatar' },
  { code: 'BH', labelKey: 'bahrain' },
  { code: 'OM', labelKey: 'oman' },
  { code: 'other', labelKey: 'other' },
] as const;
