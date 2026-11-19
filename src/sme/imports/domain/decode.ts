import type { TextEncodingName } from './types';

/**
 * Suggests an encoding. UTF-8 is certain when the bytes carry a BOM or decode as UTF-8 with
 * non-ASCII text; otherwise the file is most likely Windows-1256 (Arabic Excel exports), which
 * the user must confirm against the preview.
 */
export function detectEncoding(bytes: Uint8Array): { encoding: TextEncodingName; certain: boolean } {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { encoding: 'utf-8', certain: true };
  const ascii = bytes.every(b => b < 0x80);
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { encoding: 'utf-8', certain: !ascii };
  } catch {
    return { encoding: 'windows-1256', certain: false };
  }
}

/** Throws when the user chose UTF-8 and the bytes are not valid UTF-8. */
export function decodeText(bytes: Uint8Array, encoding: TextEncodingName): string {
  return new TextDecoder(encoding, { fatal: encoding === 'utf-8' }).decode(bytes);
}
