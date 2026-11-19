export type AccountKind = 'bank' | 'cash' | 'wallet' | 'card' | 'other';
export type SourceKind = 'manual' | 'import' | 'document' | 'opening_balance' | 'transfer' | 'reversal';
export type CategoryKind = 'income' | 'expense' | 'transfer' | 'owner_equity' | 'financing' | 'tax' | 'opening_balance';

export interface AccountSummary {
  id: string;
  kind: AccountKind;
  name: string;
  nameAr: string | null;
  institution: string | null;
  currency: string;
  status: 'active' | 'archived';
  /** Minor units as a decimal string. */
  balanceMinor: string;
  baseBalanceMinor: string;
  lastValueDate: string | null;
  transactionCount: number;
  hasEstimatedOpening: boolean;
  stale: boolean;
}

export interface TransactionRow {
  id: string;
  account_id: string;
  account_name: string;
  account_name_ar: string | null;
  value_date: string;
  amount_minor: string;
  currency: string;
  base_amount_minor: string;
  fx_rate: string | null;
  fx_rate_date: string | null;
  fx_source: string | null;
  description: string;
  external_ref: string | null;
  source_kind: SourceKind;
  import_batch_id: string | null;
  import_row_id: string | null;
  document_id: string | null;
  import_file_name: string | null;
  import_row_number: number | null;
  transfer_group_id: string | null;
  reversal_of: string | null;
  reason: string | null;
  is_estimate: boolean;
  is_reversed: boolean;
  is_reversal: boolean;
  reversal_id: string | null;
  created_by: string;
  created_at: string;
  classification: {
    id: string | null;
    category_id: string | null;
    category_code: string | null;
    category_name_en: string | null;
    category_name_ar: string | null;
    category_kind: CategoryKind | null;
    channel: string;
    counterparty_company_id: string | null;
    counterparty_contact_id: string | null;
    note: string | null;
    classified_by: string | null;
    classified_at: string | null;
  };
}
