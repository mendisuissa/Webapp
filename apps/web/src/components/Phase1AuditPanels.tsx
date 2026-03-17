import type { AppAuditResponse } from '../api/client.js';

type Props = {
  audit: AppAuditResponse | null;
};

export default function Phase1AuditPanels({ audit }: Props) {
  if (!audit) return null;

  return (
    <section className="panel phase1-audit-shell">
      <div className="panel-toolbar panel-toolbar-top phase1-audit-header">
        <div>
          <div className="panel-eyebrow">Operational audit</div>
          <div className="panel-title">Failure clustering, remediation, and verification</div>
        </div>
        <div className="panel-caption">Focused follow-up for the selected app</div>
      </div>

      <div className="phase1-audit-grid">
        <div className="info-card phase1-audit-card">
          <div className="section-title">Failure clustering</div>
          <div className="detail-list">
            {audit.clusters.length ? (
              audit.clusters.slice(0, 6).map((cluster) => (
                <div key={cluster.id} className="detail-row stack phase1-stack-row">
                  <div className="detail-key">
                    {cluster.normalizedCategory} · {cluster.errorCode}
                  </div>
                  <div className="detail-value">
                    {cluster.occurrences} failures · {cluster.impactedTargets} impacted targets
                  </div>
                  {cluster.targetTypes.length ? (
                    <div className="phase1-subline">Targets: {cluster.targetTypes.join(', ')}</div>
                  ) : null}
                  {cluster.recommendedActions.length ? (
                    <ul className="phase1-bullet-list">
                      {cluster.recommendedActions.slice(0, 3).map((action, idx) => (
                        <li key={`${cluster.id}-${idx}`}>{action}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="phase1-empty-state">
                <div className="phase1-empty-title">No recurring failure clusters detected.</div>
                <div className="summary-text muted">
                  This app currently has no repeated failure signature that crossed the audit threshold.
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="info-card phase1-audit-card">
          <div className="section-title">Smart remediation playbooks</div>
          <div className="detail-list">
            {audit.smartPlaybooks.length ? (
              audit.smartPlaybooks.map((playbook, idx) => (
                <div key={`playbook-${idx}`} className="detail-row stack phase1-stack-row">
                  <div className="detail-value">{playbook}</div>
                </div>
              ))
            ) : (
              <div className="phase1-empty-state">
                <div className="phase1-empty-title">No remediation playbooks suggested yet.</div>
                <div className="summary-text muted">
                  Playbooks appear when the service can map recurring failure patterns to actionable remediation steps.
                </div>
              </div>
            )}
          </div>

          <div className="phase1-safety-card">
            <div className="section-title">Rollout safety</div>
            <div className="detail-list">
              <div className="detail-row"><div className="detail-key">Risk level</div><div className="detail-value">{audit.rolloutSafety.riskLevel}</div></div>
              <div className="detail-row stack"><div className="detail-key">Pilot recommendation</div><div className="detail-value">{audit.rolloutSafety.pilotRecommendation}</div></div>
              <div className="detail-row stack"><div className="detail-key">Rollback note</div><div className="detail-value">{audit.rolloutSafety.rollbackNote}</div></div>
            </div>
          </div>
        </div>

        <div className="info-card phase1-audit-card">
          <div className="section-title">Verification</div>
          <div className="detail-list">
            <div className="detail-row"><div className="detail-key">Improved devices</div><div className="detail-value">{audit.verification.improvedDeviceCount}</div></div>
            <div className="detail-row"><div className="detail-key">Unresolved remainder</div><div className="detail-value">{audit.verification.unresolvedRemainder}</div></div>
            <div className="detail-row"><div className="detail-key">Confidence score</div><div className="detail-value">{audit.verification.confidenceScore}%</div></div>
          </div>
          <div className="phase1-proof-note">
            Based on post-remediation status improvement trend and remaining unresolved signals.
          </div>
          <div className="phase1-narrative-card">
            <div className="section-title">Management narrative</div>
            <div className="summary-text muted">{audit.managementNarrative}</div>
          </div>
        </div>
      </div>
    </section>
  );
}
