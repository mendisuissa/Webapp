import type { AppStatusRow, IncidentRow, SeverityThresholds } from '@efm/shared';
import { getSeverity } from '@efm/shared';
import { config } from '../config.js';

function safeLower(x: unknown): string {
  return String(x ?? '').trim().toLowerCase();
}

function isFailed(row: AppStatusRow): boolean {
  return safeLower(row.installState).includes('fail');
}

function toWindowStart(minutes: number): number {
  return Date.now() - minutes * 60_000;
}

/**
 * Prefer enriched signature if present.
 * - If signatureHash exists => use it (short stable grouping)
 * - Else if signatureKey exists => use it
 * - Else fallback => appId|category|errorCode
 */
function buildSignature(row: AppStatusRow): string {
  const sig = String((row as any).signatureHash ?? (row as any).signatureKey ?? '').trim();
  if (sig) return sig;

  const appId = String(row.appId ?? '').trim() || 'unknown-app';
  const category = String(row.normalizedCategory ?? '').trim() || 'Unknown';
  const rawCode = String(row.errorCode ?? '').trim() || 'Unknown';

  return `${appId}|${category}|${rawCode}`;
}

export function buildIncidents(
  rows: AppStatusRow[],
  thresholds: SeverityThresholds = config.severityThresholds ?? { Low: 3, Medium: 10, High: 25 }
): IncidentRow[] {
  const failed = (rows ?? []).filter(isFailed);

  const windowStart = toWindowStart(config.incidentWindowMinutes ?? 15);

  type Bucket = {
    signature: string;
    appId: string;
    appName: string;
    normalizedCategory: string;
    errorCode: string;
    firstSeen: string;
    lastSeen: string;
    impactedCount: number;
  };

  const buckets = new Map<string, Bucket>();

  for (const row of failed) {
    // Apply rolling window filter (if timestamp exists)
    const when = String(row.lastReportedDateTime ?? '').trim() || new Date().toISOString();
    const ts = new Date(when).getTime();
    if (Number.isFinite(ts) && ts < windowStart) continue;

    const signature = buildSignature(row);

    const appId = String(row.appId ?? '').trim() || 'unknown-app';
    const appName = String(row.appName ?? '').trim() || appId;
    const normalizedCategory = String(row.normalizedCategory ?? '').trim() || 'Unknown';
    const errorCode = String(row.errorCode ?? '').trim() || 'Unknown';

    const existing = buckets.get(signature);
    if (!existing) {
      buckets.set(signature, {
        signature,
        appId,
        appName,
        normalizedCategory,
        errorCode,
        firstSeen: when,
        lastSeen: when,
        impactedCount: 1
      });
      continue;
    }

    existing.impactedCount += 1;
    if (when < existing.firstSeen) existing.firstSeen = when;
    if (when > existing.lastSeen) existing.lastSeen = when;
  }

  // Apply incident threshold count
  const minCount = config.incidentThresholdCount ?? 3;

  const out: IncidentRow[] = Array.from(buckets.values())
    .filter((b) => b.impactedCount >= minCount)
    .map((b) => {
      const severity = getSeverity(b.impactedCount, thresholds);

      return {
        id: b.signature, // stable ID (signature hash/key or fallback signature)
        signature: b.signature,
        appId: b.appId,
        appName: b.appName,
        normalizedCategory: b.normalizedCategory,
        errorCode: b.errorCode,
        impactedCount: b.impactedCount,
        firstSeen: b.firstSeen,
        lastSeen: b.lastSeen,
        severity,
        summary: `${b.appName}: ${b.impactedCount} failures in rolling window`
      };
    });

  // Sort: severity first, then impactedCount
  out.sort((a, b) => {
    const rank: Record<string, number> = { High: 3, Medium: 2, Low: 1 };
    const bySeverity = (rank[String(b.severity)] ?? 0) - (rank[String(a.severity)] ?? 0);
    if (bySeverity !== 0) return bySeverity;
    return b.impactedCount - a.impactedCount;
  });

  // Placeholder when nothing matched thresholds/window
  if (out.length === 0) {
    return [
      {
        id: 'none',
        signature: 'none',
        appId: '',
        appName: 'No active incidents',
        normalizedCategory: 'None',
        errorCode: '',
        impactedCount: 0,
        firstSeen: new Date(0).toISOString(),
        lastSeen: new Date(0).toISOString(),
        severity: 'Low',
        isPlaceholder: true,
        summary: 'No failed installs matched incident grouping rules for the selected timeframe.'
      }
    ];
  }

  return out;
}