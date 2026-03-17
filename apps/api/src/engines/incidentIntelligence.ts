import type { AppStatusRow } from '@efm/shared';

export interface IntelligentIncident {
  signature: string;
  appName: string;
  category: string;
  errorFamily: string;
  affected: number;
  firstSeen: string;
  lastSeen: string;
  confidence: number;
}

export function detectIncidentSpikes(
  rows: AppStatusRow[],
  windowMinutes = 15,
  threshold = 3
): IntelligentIncident[] {

  const failures = rows.filter(r =>
    r.installState?.toLowerCase().includes('fail')
  );

  const groups = new Map<string, AppStatusRow[]>();

  for (const row of failures) {

    const key = row.signatureHash || row.signatureKey;

    if (!key) continue;

    if (!groups.has(key)) groups.set(key, []);

    groups.get(key)!.push(row);
  }

  const incidents: IntelligentIncident[] = [];

  const now = Date.now();
  const window = windowMinutes * 60 * 1000;

  for (const [signature, rows] of groups) {

    const recent = rows.filter(r => {
      const ts = new Date(r.lastReportedDateTime).getTime();
      return now - ts <= window;
    });

    if (recent.length < threshold) continue;

    const first = recent[0];

    incidents.push({
      signature,
      appName: first.appName,
      category: first.normalizedCategory,
      errorFamily: first.errorFamily ?? 'Unknown',
      affected: recent.length,
      firstSeen: recent[0].lastReportedDateTime,
      lastSeen: recent[recent.length - 1].lastReportedDateTime,
      confidence: first.confidence ?? 0.7
    });
  }

  return incidents.sort((a, b) => b.affected - a.affected);
}