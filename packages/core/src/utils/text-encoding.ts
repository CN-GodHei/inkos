const UTF8_BOM = [0xef, 0xbb, 0xbf];
const UTF16LE_BOM = [0xff, 0xfe];
const UTF16BE_BOM = [0xfe, 0xff];

/**
 * Decode a raw text buffer with best-effort encoding detection.
 *
 * Common downloaded webnovel files (txt80, 笔趣阁, etc.) are GBK/GB18030
 * encoded even when they contain no metadata saying so. Reading them as
 * UTF-8 produces mojibake that breaks chapter splitting and canon import.
 *
 * Detection order:
 *   1. Byte-order marks (UTF-8 / UTF-16 LE / UTF-16 BE).
 *   2. Strict UTF-8 validation — valid UTF-8 text decodes cleanly.
 *   3. GB18030 fallback (superset of GBK / GB2312) for legacy CJK files.
 */
export function decodeTextBuffer(buffer: Uint8Array, encoding?: string): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

  if (hasPrefix(bytes, UTF8_BOM)) {
    return decode("utf-8", bytes.subarray(UTF8_BOM.length));
  }
  if (hasPrefix(bytes, UTF16LE_BOM)) {
    return decode("utf-16le", bytes.subarray(UTF16LE_BOM.length));
  }
  if (hasPrefix(bytes, UTF16BE_BOM)) {
    return decode("utf-16be", bytes.subarray(UTF16BE_BOM.length));
  }
  if (encoding) {
    return decode(encoding, bytes);
  }
  try {
    return decode("utf-8", bytes, true);
  } catch {
    return decode("gb18030", bytes);
  }
}

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (bytes[i] !== prefix[i]) return false;
  }
  return true;
}

function decode(label: string, bytes: Uint8Array, strict = false): string {
  return new TextDecoder(label, { fatal: strict }).decode(bytes);
}