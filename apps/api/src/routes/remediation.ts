import { Router } from 'express';
import crypto from 'crypto';
import { resolveCatalogApp } from '../services/remediationCatalog.js';

const router = Router();

function validateSharedToken(req: any, res: any): boolean {
  const configuredToken = process.env.REMEDIATION_SHARED_TOKEN;
  const authHeader = req.headers.authorization || '';

  if (!configuredToken) return true;

  const incomingToken = authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length)
    : '';

  if (!incomingToken || incomingToken !== configuredToken) {
    res.status(401).json({ ok: false, error: 'Unauthorized remediation request.' });
    return false;
  }

  return true;
}

router.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'webapp-remediation-executor' });
});

router.post('/resolve', async (req, res) => {
  if (!validateSharedToken(req, res)) return;

  const { finding = {} } = req.body || {};
  const productName = finding.productName || finding.softwareName || '';
  const publisher = finding.publisher || '';

  const resolved = resolveCatalogApp(productName, publisher);

  return res.json({
    ok: true,
    input: {
      productName,
      publisher,
      cveId: finding.cveId || null
    },
    resolution: resolved
  });
});

router.post('/execute', async (req, res) => {
  if (!validateSharedToken(req, res)) return;

  const { tenantId, approvalId, devices = [], finding = {}, plan = {} } = req.body || {};

  const resolved =
    plan?.app?.wingetId
      ? {
          supported: true,
          remediationType: plan.remediationType || 'winget-intune-upgrade',
          autoRemediate: true,
          app: plan.app
        }
      : resolveCatalogApp(finding.productName || finding.softwareName, finding.publisher);

  if (!resolved.supported || !resolved.app?.wingetId) {
    return res.status(400).json({
      ok: false,
      error: 'Unsupported application for automatic remediation.',
      resolution: resolved
    });
  }

  const jobId = `rem_${crypto.randomBytes(6).toString('hex')}`;

  return res.json({
    ok: true,
    jobId,
    status: 'queued',
    executor: 'webapp',
    tenantId: tenantId || null,
    approvalId: approvalId || null,
    targets: devices,
    app: resolved.app,
    execution: {
      type: resolved.remediationType,
      nextStep: 'Replace this stub with your real Intune/Winget packaging and assignment workflow.'
    },
    sourceFinding: {
      cveId: finding.cveId || null,
      productName: finding.productName || finding.softwareName || null,
      publisher: finding.publisher || null,
      recommendation: finding.recommendation || null
    }
  });
});

export default router;