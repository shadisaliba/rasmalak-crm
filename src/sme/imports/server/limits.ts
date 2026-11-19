import 'server-only';
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_ROWS } from '../domain/limits';

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function importLimits(): { maxBytes: number; maxRows: number } {
  return {
    maxBytes: positiveInt(process.env.SME_IMPORT_MAX_BYTES, DEFAULT_MAX_BYTES),
    maxRows: positiveInt(process.env.SME_IMPORT_MAX_ROWS, DEFAULT_MAX_ROWS),
  };
}
