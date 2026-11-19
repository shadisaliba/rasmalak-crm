import { normalizeDescription } from '@/sme/ledger/domain/fingerprint';

// Deterministic keyword suggestions (W2-06): generic bookkeeping labels, no AI. The reviewer
// confirms or changes every suggestion. Earlier rules win.
interface Rule { code: string; direction: 'in' | 'out'; keywords: string[] }

const RULES: Rule[] = [
  { code: 'salaries_wages', direction: 'out', keywords: ['salary', 'salaries', 'payroll', 'wages', 'رواتب', 'راتب', 'اجور'] },
  { code: 'rent', direction: 'out', keywords: ['rent', 'ايجار', 'اجار'] },
  { code: 'utilities', direction: 'out', keywords: ['electricity', 'water', 'jepco', 'edco', 'ideco', 'miyahuna', 'كهرباء', 'مياه', 'مياهنا'] },
  { code: 'telecom', direction: 'out', keywords: ['zain', 'orange', 'umniah', 'internet', 'telecom', 'زين', 'اورنج', 'امنيه', 'امنية', 'انترنت', 'اتصالات'] },
  { code: 'transport', direction: 'out', keywords: ['fuel', 'petrol', 'careem', 'uber', 'taxi', 'jopetrol', 'manaseer', 'وقود', 'بنزين', 'محروقات', 'تكسي', 'المناصير'] },
  { code: 'tax_payments', direction: 'out', keywords: ['tax', 'istd', 'ضريبه', 'ضريبة'] },
  { code: 'bank_fees', direction: 'out', keywords: ['fee', 'fees', 'commission', 'charge', 'charges', 'رسوم', 'عموله', 'عمولة'] },
  { code: 'marketing', direction: 'out', keywords: ['facebook', 'meta', 'instagram', 'google ads', 'advert', 'advertising', 'marketing', 'اعلان', 'تسويق'] },
  { code: 'professional_fees', direction: 'out', keywords: ['lawyer', 'accountant', 'audit', 'consultant', 'محامي', 'محاسب', 'تدقيق', 'استشار'] },
  { code: 'loan_principal', direction: 'out', keywords: ['loan', 'installment', 'instalment', 'قرض', 'قسط'] },
  { code: 'owner_drawings', direction: 'out', keywords: ['drawings', 'personal withdrawal', 'مسحوبات', 'سحب شخصي'] },
  { code: 'cost_of_goods', direction: 'out', keywords: ['supplier', 'inventory', 'stock purchase', 'مورد', 'بضاعه', 'بضاعة', 'بضائع'] },
  { code: 'supplies', direction: 'out', keywords: ['supplies', 'stationery', 'قرطاسيه', 'قرطاسية', 'مستلزمات'] },
  { code: 'loan_proceeds', direction: 'in', keywords: ['loan', 'قرض'] },
  { code: 'owner_capital', direction: 'in', keywords: ['capital', 'owner deposit', 'راس مال'] },
  { code: 'sales', direction: 'in', keywords: ['pos settlement', 'sales', 'sale', 'invoice', 'مبيعات', 'فاتوره', 'فاتورة', 'تحصيل'] },
  { code: 'service_income', direction: 'in', keywords: ['service', 'services', 'consulting', 'خدمات'] },
  { code: 'other_income', direction: 'in', keywords: ['interest', 'refund', 'فوائد', 'استرداد'] },
];

const CHANNELS: Array<[string, string[]]> = [
  ['cliq', ['cliq', 'كليك']],
  ['efawateercom', ['efawateer', 'e-fawateer', 'فواتيركم']],
  ['pos_card', ['pos', 'visa', 'mastercard', 'card purchase', 'نقاط البيع', 'بطاقه', 'بطاقة']],
  ['cash', ['atm', 'cash', 'صراف', 'نقدا', 'نقدي']],
  ['cheque', ['cheque', 'chq', 'شيك']],
  ['direct_debit', ['direct debit', 'standing order', 'خصم مباشر', 'امر دائم']],
  ['wallet', ['wallet', 'zaincash', 'محفظه', 'محفظة']],
  ['bank_transfer', ['transfer', 'swift', 'ach', 'حواله', 'حوالة', 'تحويل']],
];

const prepared = (words: string[]) => words.map(w => {
  const n = normalizeDescription(w);
  // Latin keywords match whole words ("tax" must not match "taxi"); Arabic ones match inside
  // words because of attached prefixes such as ال.
  return /^[a-z0-9 -]+$/.test(n) ? new RegExp(`(^|[^a-z])${n.replace(/[-]/g, '\\-')}([^a-z]|$)`) : n;
});
const RULE_MATCHERS = RULES.map(r => ({ ...r, matchers: prepared(r.keywords) }));
const CHANNEL_MATCHERS = CHANNELS.map(([channel, words]) => ({ channel, matchers: prepared(words) }));

function matches(text: string, matchers: Array<string | RegExp>): boolean {
  return matchers.some(m => (typeof m === 'string' ? text.includes(m) : m.test(text)));
}

export function suggestCategory(description: string, amountMinor: bigint): string | null {
  const text = normalizeDescription(description);
  const direction = amountMinor > 0n ? 'in' : 'out';
  return RULE_MATCHERS.find(r => r.direction === direction && matches(text, r.matchers))?.code ?? null;
}

export function suggestChannel(description: string): string {
  const text = normalizeDescription(description);
  return CHANNEL_MATCHERS.find(c => matches(text, c.matchers))?.channel ?? 'unknown';
}
