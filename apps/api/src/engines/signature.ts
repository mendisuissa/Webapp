import crypto from 'crypto';
import type { AppStatusRow, ErrorSignature } from '@efm/shared';

/**
 * Builds a stable signature for incident grouping.
 * Keep it deterministic and low-PII: appId + normalizedCategory + errorCode.
 */
export function buildErrorSignature(row: Pick<AppStatusRow, 'appId' | 'normalizedCategory' | 'errorCode'>): ErrorSignature {
  const key = `${row.appId || 'unknown'}|${row.normalizedCategory || 'Unknown'}|${row.errorCode || 'Unknown'}`;
  const hash = crypto.createHash('sha1').update(key).digest('hex').slice(0, 12);
  return { key, hash };
}

/** Simple family classifier from error code prefix. */
export function detectErrorFamily(errorCode?: string): string | undefined {
  const code = (errorCode || '').trim().toLowerCase();
  if (!code) return undefined;
  if (code.startsWith('0x87d')) return '0x87D';
  if (code.startsWith('0x80073')) return '0x80073';
  if (code.startsWith('0x8007')) return '0x8007';
  if (code.startsWith('0x8019')) return '0x8019';
  return code.startsWith('0x') ? code.slice(0, 6).toUpperCase() : undefined;
}
