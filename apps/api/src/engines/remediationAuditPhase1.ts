export interface Phase1QueueItem {
  appId: string;
  appName: string;
  clusterLabel: string;
  impactScore: number;
  suggestedPlaybook: string;
  verificationState: 'verified' | 'pending' | 'not-started';
}

export function buildQueuePreview(appAudits: Array<any>): Phase1QueueItem[] {
  return [...appAudits]
    .map((audit) => {
      const topCluster = Array.isArray(audit.clusters) ? audit.clusters[0] : null;
      const topPlaybook = Array.isArray(audit.smartPlaybooks) ? audit.smartPlaybooks[0] : null;
      const impactScore = Number(topCluster?.impactedTargets ?? 0) + Number(audit.impactedDevices ?? 0);
      return {
        appId: String(audit.appId ?? ''),
        appName: String(audit.appName ?? 'Unknown app'),
        clusterLabel: topCluster ? `${topCluster.normalizedCategory} · ${topCluster.errorCode}` : 'No dominant cluster',
        impactScore,
        suggestedPlaybook: typeof topPlaybook === 'string'
          ? topPlaybook
          : String(topPlaybook?.title ?? 'Review failure pattern and validate remediation'),
        verificationState: (audit.verification?.state ?? 'pending') as 'verified' | 'pending' | 'not-started',
      };
    })
    .filter((item) => item.appId)
    .sort((a, b) => b.impactScore - a.impactScore)
    .slice(0, 5);
}

export function buildProofSummary(appAudits: Array<any>) {
  const verifiedApps = appAudits.filter((audit) => audit.verification?.state === 'verified').length;
  const pendingVerificationApps = appAudits.filter((audit) => audit.verification?.state !== 'verified').length;
  return {
    verifiedApps,
    pendingVerificationApps,
    proofNarrative:
      verifiedApps > 0
        ? `${verifiedApps} apps already show verified improvement evidence; ${pendingVerificationApps} still require verification follow-up.`
        : `No apps are fully verified yet; ${pendingVerificationApps} need remediation proof follow-up.`
  };
}
