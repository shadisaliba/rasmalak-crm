// Display currencies for CRM records. Money arithmetic and minor units live in src/sme/money.
export const CURRENCIES = [
  { code: 'JOD', name: 'Jordanian Dinar', nameAr: 'دينار أردني', symbol: 'JOD', symbolAr: 'د.أ' },
  { code: 'SAR', name: 'Saudi Riyal', nameAr: 'ريال سعودي', symbol: 'SAR', symbolAr: 'ر.س' },
  { code: 'AED', name: 'UAE Dirham', nameAr: 'درهم إماراتي', symbol: 'AED', symbolAr: 'د.إ' },
  { code: 'KWD', name: 'Kuwaiti Dinar', nameAr: 'دينار كويتي', symbol: 'KWD', symbolAr: 'د.ك' },
  { code: 'QAR', name: 'Qatari Riyal', nameAr: 'ريال قطري', symbol: 'QAR', symbolAr: 'ر.ق' },
  { code: 'BHD', name: 'Bahraini Dinar', nameAr: 'دينار بحريني', symbol: 'BHD', symbolAr: 'د.ب' },
  { code: 'OMR', name: 'Omani Rial', nameAr: 'ريال عماني', symbol: 'OMR', symbolAr: 'ر.ع' },
  { code: 'EGP', name: 'Egyptian Pound', nameAr: 'جنيه مصري', symbol: 'EGP', symbolAr: 'ج.م' },
  { code: 'MAD', name: 'Moroccan Dirham', nameAr: 'درهم مغربي', symbol: 'MAD', symbolAr: 'د.م' },
  { code: 'DZD', name: 'Algerian Dinar', nameAr: 'دينار جزائري', symbol: 'DZD', symbolAr: 'د.ج' },
  { code: 'TND', name: 'Tunisian Dinar', nameAr: 'دينار تونسي', symbol: 'TND', symbolAr: 'د.ت' },
  { code: 'IQD', name: 'Iraqi Dinar', nameAr: 'دينار عراقي', symbol: 'IQD', symbolAr: 'د.ع' },
  { code: 'LBP', name: 'Lebanese Pound', nameAr: 'ليرة لبنانية', symbol: 'LBP', symbolAr: 'ل.ل' },
  { code: 'SYP', name: 'Syrian Pound', nameAr: 'ليرة سورية', symbol: 'SYP', symbolAr: 'ل.س' },
  { code: 'LYD', name: 'Libyan Dinar', nameAr: 'دينار ليبي', symbol: 'LYD', symbolAr: 'د.ل' },
  { code: 'SDG', name: 'Sudanese Pound', nameAr: 'جنيه سوداني', symbol: 'SDG', symbolAr: 'ج.س' },
  { code: 'YER', name: 'Yemeni Rial', nameAr: 'ريال يمني', symbol: 'YER', symbolAr: 'ر.ي' },
  { code: 'USD', name: 'US Dollar', nameAr: 'دولار أمريكي', symbol: '$', symbolAr: '$' },
  { code: 'EUR', name: 'Euro', nameAr: 'يورو', symbol: '€', symbolAr: '€' },
];

// Fallback when a record has no currency; organizations carry their own.
export const DEFAULT_CURRENCY = 'JOD';

// Accent Color Options (user-selectable), organised by hue family
export const ACCENT_COLOR_OPTIONS = [
  // ── Reds ──
  { value: '#E11D48', label: 'Rose',    labelAr: 'وردي',       hover: '#FB7185', dark: '#BE123C', rgb: '225, 29, 72',   family: 'red' },
  { value: '#DC2626', label: 'Red',     labelAr: 'أحمر',       hover: '#F87171', dark: '#B91C1C', rgb: '220, 38, 38',   family: 'red' },
  { value: '#991B1B', label: 'Crimson', labelAr: 'قرمزي',      hover: '#DC2626', dark: '#7F1D1D', rgb: '153, 27, 27',   family: 'red' },
  // ── Oranges ──
  { value: '#EA580C', label: 'Orange',      labelAr: 'برتقالي',    hover: '#F97316', dark: '#C2410C', rgb: '234, 88, 12',  family: 'orange' },
  { value: '#D97706', label: 'Amber',       labelAr: 'كهرماني',    hover: '#F59E0B', dark: '#B45309', rgb: '217, 119, 6',  family: 'orange' },
  { value: '#CA8A04', label: 'Gold',        labelAr: 'ذهبي',       hover: '#EAB308', dark: '#A16207', rgb: '202, 138, 4',  family: 'orange' },
  // ── Greens ──
  { value: '#65A30D', label: 'Lime',        labelAr: 'ليموني',     hover: '#84CC16', dark: '#4D7C0F', rgb: '101, 163, 13', family: 'green' },
  { value: '#16A34A', label: 'Green',       labelAr: 'أخضر',       hover: '#22C55E', dark: '#15803D', rgb: '22, 163, 74',  family: 'green' },
  { value: '#1F7A5A', label: 'Emerald',     labelAr: 'زمردي',      hover: '#259A72', dark: '#16654A', rgb: '31, 122, 90',  family: 'green' },
  { value: '#059669', label: 'Jade',        labelAr: 'يشمي',       hover: '#10B981', dark: '#047857', rgb: '5, 150, 105',  family: 'green' },
  // ── Teals & Cyans ──
  { value: '#0D9488', label: 'Teal',        labelAr: 'أزرق مخضر',  hover: '#14B8A6', dark: '#0F766E', rgb: '13, 148, 136', family: 'teal' },
  { value: '#0891B2', label: 'Cyan',        labelAr: 'سماوي',      hover: '#06B6D4', dark: '#0E7490', rgb: '8, 145, 178',  family: 'teal' },
  // ── Blues ──
  { value: '#0284C7', label: 'Sky',         labelAr: 'سماوي فاتح', hover: '#0EA5E9', dark: '#0369A1', rgb: '2, 132, 199',  family: 'blue' },
  { value: '#2563EB', label: 'Blue',        labelAr: 'أزرق',       hover: '#3B82F6', dark: '#1D4ED8', rgb: '37, 99, 235',  family: 'blue' },
  { value: '#4F46E5', label: 'Indigo',      labelAr: 'نيلي',       hover: '#6366F1', dark: '#4338CA', rgb: '79, 70, 229',  family: 'blue' },
  // ── Purples ──
  { value: '#7C3AED', label: 'Violet',      labelAr: 'بنفسجي',     hover: '#8B5CF6', dark: '#6D28D9', rgb: '124, 58, 237', family: 'purple' },
  { value: '#9333EA', label: 'Purple',      labelAr: 'أرجواني',    hover: '#A855F7', dark: '#7E22CE', rgb: '147, 51, 234', family: 'purple' },
  // ── Pinks ──
  { value: '#C026D3', label: 'Fuchsia',     labelAr: 'فوشيا',      hover: '#D946EF', dark: '#A21CAF', rgb: '192, 38, 211', family: 'pink' },
  { value: '#DB2777', label: 'Pink',        labelAr: 'زهري',       hover: '#EC4899', dark: '#BE185D', rgb: '219, 39, 119', family: 'pink' },
  // ── Neutrals ──
  { value: '#475569', label: 'Slate',       labelAr: 'رمادي',      hover: '#64748B', dark: '#334155', rgb: '71, 85, 105',  family: 'neutral' },
] as const;

export const DEFAULT_ACCENT_COLOR = '#1F7A5A';
