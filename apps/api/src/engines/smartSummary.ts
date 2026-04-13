import type { AppStatusRow, SmartSummary } from '@efm/shared';

export function buildSmartSummary(rows: AppStatusRow[]): SmartSummary {
  const total = rows.length || 0;
  const failed = rows.filter((r) => (r.installState || '').toLowerCase().includes('fail'));
  const failedCount = failed.length;

  const byError = new Map<string, number>();
  for (const r of failed) {
    const code = (r.errorCode || 'Unknown').trim() || 'Unknown';
    byError.set(code, (byError.get(code) ?? 0) + 1);
  }

  const top = Array.from(byError.entries()).sort((a, b) => b[1] - a[1])[0];

  const failureRate = total ? failedCount / total : 0;
  const severity: SmartSummary['severity'] =
    failureRate >= 0.3 ? 'critical' : failureRate >= 0.1 ? 'warn' : 'info';

  const bullets: string[] = [];
  bullets.push(`${failedCount} failed out of ${total} status rows (${Math.round(failureRate * 100)}%).`);
  if (top) bullets.push(`Top error: ${top[0]} (${top[1]} occurrences).`);
  bullets.push(`Top category: ${topCategory(failed) ?? 'Unknown'}.`);

  const recommendedNextActions: string[] = [];
  if (top?.[0]?.toLowerCase().startsWith('0x80073')) {
    recommendedNextActions.push('Check MSIX/AppX dependencies (VCLibs, WindowsAppRuntime) and version conflicts.');
  }
  if (top?.[0]?.toLowerCase().startsWith('0x87d')) {
    recommendedNextActions.push('Validate detection rule + requirement rules + install command/return codes.');
  }
  recommendedNextActions.push('Open the Incidents view and group by signature to validate impact scope.');

  return {
    title: 'Smart Summary',
    severity,
    bullets,
    recommendedNextActions,
    confidence: top ? 0.75 : 0.55,
    topErrorCode: top?.[0],
    impactedCount: top?.[1]
  };
}

function topCategory(rows: AppStatusRow[]): string | undefined {
  const map = new Map<string, number>();
  for (const r of rows) {
    const c = (r.normalizedCategory || 'Unknown').trim() || 'Unknown';
    map.set(c, (map.get(c) ?? 0) + 1);
  }
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
}
