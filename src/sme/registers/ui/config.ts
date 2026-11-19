import type { CrmPermissions, PartyRole } from '@/types/crm';

export type RegisterKind = 'invoice' | 'bill';

export interface RegisterConfig {
  kind: RegisterKind;
  /** /api/sme/v1/<api> */
  api: 'invoices' | 'bills';
  allocationsApi: 'invoice-allocations' | 'bill-allocations';
  unallocatedApi: 'receipts/unallocated' | 'payments/unallocated';
  route: '/crm/money/receivables' | '/crm/money/payables';
  partyRole: PartyRole;
  /** Prefix of the party columns: customer_company_id, supplier_company_id, ... */
  party: 'customer' | 'supplier';
  readPerm: keyof CrmPermissions;
  writePerm: keyof CrmPermissions;
  /** Message prefix: sme.receivables or sme.payables. */
  msg: 'sme.receivables' | 'sme.payables';
  statusMsg: 'sme.invoiceStatus' | 'sme.billStatus';
  idField: 'invoice_id' | 'bill_id';
  refField: 'number' | 'supplier_reference';
  canWriteOff: boolean;
  /** Bills can be marked paid with a new payment recorded in the same step. */
  canPayNew: boolean;
}

export const REGISTERS: Record<RegisterKind, RegisterConfig> = {
  invoice: {
    kind: 'invoice', api: 'invoices', allocationsApi: 'invoice-allocations', unallocatedApi: 'receipts/unallocated',
    route: '/crm/money/receivables', partyRole: 'customer', party: 'customer', readPerm: 'sme.receivables.read',
    writePerm: 'sme.receivables.write', msg: 'sme.receivables', statusMsg: 'sme.invoiceStatus', idField: 'invoice_id',
    refField: 'number', canWriteOff: true, canPayNew: false,
  },
  bill: {
    kind: 'bill', api: 'bills', allocationsApi: 'bill-allocations', unallocatedApi: 'payments/unallocated',
    route: '/crm/money/payables', partyRole: 'supplier', party: 'supplier', readPerm: 'sme.payables.read',
    writePerm: 'sme.payables.write', msg: 'sme.payables', statusMsg: 'sme.billStatus', idField: 'bill_id',
    refField: 'supplier_reference', canWriteOff: false, canPayNew: true,
  },
};

export type RegisterStatus = 'draft' | 'open' | 'partially_paid' | 'paid' | 'overdue' | 'void' | 'written_off';

export const STATUS_TONE: Record<RegisterStatus, 'neutral' | 'warning' | 'info'> = {
  draft: 'info', open: 'neutral', partially_paid: 'neutral', paid: 'neutral', overdue: 'warning', void: 'info', written_off: 'info',
};
