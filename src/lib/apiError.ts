import 'server-only';
import { NextResponse } from 'next/server';
import en from '@/messages/en/errors';
import ar from '@/messages/ar/errors';
import { ERROR_STATUS, type ErrorCode } from '@/lib/errorCodes';

export function isErrorCode(value: string): value is ErrorCode {
  return value in ERROR_STATUS;
}

// Error contract R13: bilingual message, a code from Appendix C, no stack traces.
export function errorResponse(code: ErrorCode, details?: Record<string, unknown>, headers?: HeadersInit): NextResponse {
  return NextResponse.json(
    { error: { code, message_en: en[code], message_ar: ar[code], ...(details ? { details } : {}) } },
    { status: ERROR_STATUS[code], headers },
  );
}
