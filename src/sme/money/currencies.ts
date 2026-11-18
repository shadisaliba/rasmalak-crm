// ISO 4217 minor units for the currencies the product accepts. Mirrored by the sme_currencies
// table (W2-03); a unit test keeps the two lists identical.
export const CURRENCY_TABLE = {
  JOD: { minorUnits: 3, nameEn: 'Jordanian dinar', nameAr: 'دينار أردني' },
  KWD: { minorUnits: 3, nameEn: 'Kuwaiti dinar', nameAr: 'دينار كويتي' },
  BHD: { minorUnits: 3, nameEn: 'Bahraini dinar', nameAr: 'دينار بحريني' },
  OMR: { minorUnits: 3, nameEn: 'Omani rial', nameAr: 'ريال عماني' },
  IQD: { minorUnits: 3, nameEn: 'Iraqi dinar', nameAr: 'دينار عراقي' },
  TND: { minorUnits: 3, nameEn: 'Tunisian dinar', nameAr: 'دينار تونسي' },
  LYD: { minorUnits: 3, nameEn: 'Libyan dinar', nameAr: 'دينار ليبي' },
  USD: { minorUnits: 2, nameEn: 'US dollar', nameAr: 'دولار أمريكي' },
  EUR: { minorUnits: 2, nameEn: 'Euro', nameAr: 'يورو' },
  GBP: { minorUnits: 2, nameEn: 'Pound sterling', nameAr: 'جنيه إسترليني' },
  SAR: { minorUnits: 2, nameEn: 'Saudi riyal', nameAr: 'ريال سعودي' },
  AED: { minorUnits: 2, nameEn: 'UAE dirham', nameAr: 'درهم إماراتي' },
  QAR: { minorUnits: 2, nameEn: 'Qatari riyal', nameAr: 'ريال قطري' },
  EGP: { minorUnits: 2, nameEn: 'Egyptian pound', nameAr: 'جنيه مصري' },
} as const;

export type CurrencyCode = keyof typeof CURRENCY_TABLE;

export const CURRENCY_CODES = Object.keys(CURRENCY_TABLE) as CurrencyCode[];

export function isCurrencyCode(value: string): value is CurrencyCode {
  return Object.prototype.hasOwnProperty.call(CURRENCY_TABLE, value);
}

export function minorUnits(currency: CurrencyCode): number {
  return CURRENCY_TABLE[currency].minorUnits;
}
