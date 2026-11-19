// Mirror of sme_normalize_description / sme_fingerprint in
// supabase/migrations/20261119000400_sme_ledger.sql. Change both together; the test vectors
// in fingerprint.test.ts were produced by the SQL functions.

const LETTER_FROM = 'إأآٱ٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹ ';
const LETTER_TO = 'اااا01234567890123456789 ';
const TRANSLATE = new Map([...LETTER_FROM].map((c, i) => [c, [...LETTER_TO][i]]));

export function normalizeDescription(text: string | null | undefined): string {
  const translated = [...(text ?? '').toLowerCase()].map(c => TRANSLATE.get(c) ?? c).join('');
  return translated
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[0-9][0-9,]*\.[0-9]+/g, ' ')
    .replace(/[ \t\n\r\f\v]+/g, ' ')
    .replace(/^ +| +$/g, '');
}

export interface FingerprintInput {
  orgId: string;
  accountId: string;
  /** ISO date, YYYY-MM-DD. */
  valueDate: string;
  amountMinor: bigint;
  description: string | null | undefined;
  externalRef: string | null | undefined;
}

export async function fingerprint(input: FingerprintInput): Promise<string> {
  const source = [
    input.orgId, input.accountId, input.valueDate, input.amountMinor.toString(),
    normalizeDescription(input.description), input.externalRef ?? '',
  ].join('|');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
