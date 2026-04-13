import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { AppStatusRow, FailureExplanation, NormalizationRule } from '@efm/shared';
import { buildErrorSignature, detectErrorFamily } from './signature.js';

let cachedRules: NormalizationRule[] | null = null;

function normalizeHexCode(raw?: string | null): string {
  if (!raw) return '';

  const value = String(raw).trim();
  if (!value) return '';

  if (value.toLowerCase().startsWith('0x')) {
    return value.toLowerCase();
  }

  // convert 80070002 -> 0x80070002
  if (/^[0-9a-fA-F]{8}$/.test(value)) {
    return `0x${value}`.toLowerCase();
  }

  return value.toLowerCase();
}

async function loadRules(): Promise<NormalizationRule[]> {
  if (cachedRules) {
    return cachedRules;
  }

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidatePaths = [
    path.resolve(process.cwd(), 'config', 'normalization.rules.json'),
    path.resolve(process.cwd(), 'apps', 'api', 'config', 'normalization.rules.json'),
    path.resolve(currentDir, '../../apps/api/config/normalization.rules.json'),
    path.resolve(currentDir, '../../config/normalization.rules.json')
  ];

  for (const rulesPath of candidatePaths) {
    try {
      const raw = await fs.readFile(rulesPath, 'utf8');
      const parsed = JSON.parse(raw);

      cachedRules = Array.isArray(parsed.rules)
        ? (parsed.rules as NormalizationRule[])
        : [];

      return cachedRules;
    } catch {
      continue;
    }
  }

  cachedRules = [];
  return cachedRules;
}

export async function normalizeStatus(row: AppStatusRow): Promise<FailureExplanation> {
  const rules = await loadRules();

  const normalizedCode = normalizeHexCode(row.errorCode);

  const corpus =
    `${normalizedCode} ${row.errorDescription} ${row.installState}`.toLowerCase();

  for (const rule of rules) {
    if (!rule.enabled) continue;

    const matched = rule.anyMatches.some((token: string) =>
      corpus.includes(token.toLowerCase())
    );

    if (!matched) continue;

    const family = detectErrorFamily(normalizedCode);

    const signature = buildErrorSignature({
      appId: row.appId,
      normalizedCategory: rule.failureCategory,
      errorCode: normalizedCode
    });

    return {
      normalizedCategory: rule.failureCategory,
      cause: rule.cause,
      confidence: rule.confidence,
      recommendedActions: rule.recommendedActions,

      errorFamily: family,
      signatureKey: signature.key,
      signatureHash: signature.hash,

      evidence: {
        lastReportedDateTime: row.lastReportedDateTime || 'Unknown',
        errorCode: normalizedCode || 'Unknown',
        errorDescription: row.errorDescription || 'Unknown'
      }
    };
  }

  // fallback when no rule matched
  const family = detectErrorFamily(normalizedCode);

  const signature = buildErrorSignature({
    appId: row.appId,
    normalizedCategory: 'Unknown',
    errorCode: normalizedCode
  });

  return {
    normalizedCategory: 'Unknown',
    cause: 'No rule matched. Update normalization.rules.json for this pattern.',
    confidence: 0.2,
    recommendedActions: [
      'Collect full error text/code and add a stable matching term in normalization rules.'
    ],

    errorFamily: family,
    signatureKey: signature.key,
    signatureHash: signature.hash,

    evidence: {
      lastReportedDateTime: row.lastReportedDateTime || 'Unknown',
      errorCode: normalizedCode || 'Unknown',
      errorDescription: row.errorDescription || 'Unknown'
    }
  };
}