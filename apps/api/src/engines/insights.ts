import { AppStatusRow, InsightCard } from '@efm/shared';

export function buildInsights(rows: AppStatusRow[]): InsightCard[] {
  const failed = rows.filter((r) =>
    (r.installState || '').toLowerCase().includes('fail')
  );

  const cards: InsightCard[] = [];

  // Top failing app
  const byApp = new Map<string, number>();

  for (const r of failed) {
    const k = (r.appName || r.appId || 'Unknown').trim() || 'Unknown';
    byApp.set(k, (byApp.get(k) ?? 0) + 1);
  }

  const topApp = Array.from(byApp.entries()).sort((a, b) => b[1] - a[1])[0];

  if (topApp) {
    cards.push({
      id: 'topFailingApp',
      title: 'Top failing app',
      metric: `${topApp[0]} (${topApp[1]})`,
      severity: topApp[1] >= 25 ? 'critical' : topApp[1] >= 10 ? 'warn' : 'info',
      deepLink: '/?view=apps'
    });
  }

  // Top error family
  const byFamily = new Map<string, number>();

  for (const r of failed) {
    const fam = (r.errorFamily || familyFromCode(r.errorCode) || 'Unknown')
      .trim() || 'Unknown';

    byFamily.set(fam, (byFamily.get(fam) ?? 0) + 1);
  }

  const topFam = Array.from(byFamily.entries()).sort((a, b) => b[1] - a[1])[0];

  if (topFam) {
    cards.push({
      id: 'topErrorFamily',
      title: 'Top error family',
      metric: `${topFam[0]} (${topFam[1]})`,
      severity: topFam[1] >= 25 ? 'critical' : topFam[1] >= 10 ? 'warn' : 'info'
    });
  }

  // Top incident signature
  const bySig = new Map<string, number>();

  for (const r of failed) {
    const sig =
      r.signatureHash ||
      r.signatureKey ||
      `${r.appId}|${r.normalizedCategory}|${r.errorCode}`;

    bySig.set(sig, (bySig.get(sig) ?? 0) + 1);
  }

  const topSig = Array.from(bySig.entries()).sort((a, b) => b[1] - a[1])[0];

  if (topSig) {
    cards.push({
      id: 'topSignature',
      title: 'Top incident signature',
      metric: `${topSig[0]} (${topSig[1]})`,
      severity: topSig[1] >= 25 ? 'critical' : topSig[1] >= 10 ? 'warn' : 'info',
      deepLink: '/?view=incidents'
    });
  }

  return cards;
}

function familyFromCode(errorCode?: string): string | undefined {
  const code = (errorCode || '').trim().toLowerCase();

  if (!code) return undefined;

  if (code.startsWith('0x87d')) return '0x87D';
  if (code.startsWith('0x80073')) return '0x80073';

  return code.startsWith('0x') ? code.slice(0, 6).toUpperCase() : undefined;
}