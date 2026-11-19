import { z } from 'zod';
import { CHANNELS, isoDate, minorAmount } from '@/sme/ledger/api/schemas';
import { DATE_FORMATS } from '../domain/types';

const column = z.number().int().min(0).max(200);
const uuid = z.uuid();

export const columnMappingSchema = z.object({
  header_row: z.number().int().min(0).max(100),
  date: column,
  description: z.array(column).min(1).max(3),
  amount: column.optional(),
  debit: column.optional(),
  credit: column.optional(),
  reference: column.optional(),
});

export const parseOptionsSchema = z.object({
  date_format: z.enum(DATE_FORMATS),
  amount_mode: z.enum(['signed', 'debit_credit']),
  decimal_separator: z.enum(['.', ',']),
  encoding: z.enum(['utf-8', 'windows-1256']).optional(),
  delimiter: z.enum([',', ';', '\t']).optional(),
  sheet: z.string().max(100).optional(),
});

export const createBatchInput = z.object({
  account_id: uuid,
  file_name: z.string().trim().min(1).max(255),
  byte_size: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/i),
  mime_type: z.string().max(120),
});

export const parseInput = z.object({ column_mapping: columnMappingSchema, parse_options: parseOptionsSchema }).refine(
  v => (v.parse_options.amount_mode === 'signed' ? v.column_mapping.amount !== undefined : v.column_mapping.debit !== undefined && v.column_mapping.credit !== undefined),
  { path: ['column_mapping'], message: 'amount_columns' },
);

export const ROW_STATUSES = ['valid', 'invalid', 'duplicate_existing', 'duplicate_suspected', 'duplicate_in_file', 'accepted', 'excluded'] as const;
export type RowStatus = (typeof ROW_STATUSES)[number];

export const reviewInput = z.object({
  bulk: z.enum(['accept_valid', 'exclude_duplicates', 'reset']).optional(),
  changes: z.array(z.object({
    row_id: uuid,
    value_date: isoDate.nullable().optional(),
    amount_minor: minorAmount.nullable().optional(),
    category_id: uuid.nullable().optional(),
    channel: z.enum(CHANNELS).optional(),
    action: z.enum(['accept', 'exclude']).optional(),
    override_reason: z.string().trim().max(500).optional(),
  })).max(1000).optional(),
});

export const rowsQuery = z.object({
  status: z.string().max(200).optional()
    .transform(v => (v ? v.split(',') : undefined))
    .pipe(z.array(z.enum(ROW_STATUSES)).optional()),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
