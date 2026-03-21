import { Router } from 'express';
import crypto from 'crypto';
import { resolveCatalogApp } from '../services/remediationCatalog.js';
import { resolveWin32Search } from '../engines/win32LiveResolver.js';

type Finding = {
  productName?: string;
  softwareName?: string;
  name?: string;
  publisher?: string;
  cveId?: string;
  recommendation?: string;
};

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

function inferInstallerType(best: {
  source: string;
  installCommand?: string;
  sourceUrl?: string;
}) {
  const command = String(best.installCommand || '');
  const url = String(best.sourceUrl || '').toLowerCase();
  if (best.source === 'winget') return 'winget';
  if (/msiexec/i.test(command) || url.endsWith('.msi')) return 'msi';
  if (url.endsWith('.msix') || url.endsWith('.appx')) return 'msix';
  if (url.endsWith('.zip')) return 'zip';
  return 'exe';
}

function buildQuery(finding: Finding) {
  return String(
    finding?.productName ||
    finding?.softwareName ||
    finding?.name ||
    finding?.publisher ||
    finding?.cveId ||
    ''
  ).trim();
}

async function resolveApplication(finding: Finding) {
  const productName = String(finding?.productName || finding?.softwareName || finding?.name || '');
  const publisher = String(finding?.publisher || '');
  const query = buildQuery(finding);

  const catalog = resolveCatalogApp(productName, publisher);

  let live: Awaited<ReturnType<typeof resolveWin32Search>> | null = null;
  if (query) {
    try {
      live = await resolveWin32Search(query, 'quick');
    } catch {
      live = null;
    }
  }

  const best = live?.bestMatch;
  if (best) {
    return {
      supported: true,
      remediationType: 'win32-package',
      autoRemediate: true,
      source: best.source,
      confidence: best.confidence,
      query,
      app: {
        name: best.name,
        publisher: best.publisher,
        packageId: best.packageId || null,
        installerType: inferInstallerType(best),
        installCommand: best.installCommand,
        uninstallCommand: best.uninstallCommand,
        sourceUrl: best.sourceUrl || null,
        whySelected: best.whySelected,
        notes: best.notes || [],
        evidence: best.evidence || []
      },
      alternatives: live?.candidates?.slice(0, 5) || []
    };
  }

  if (catalog.supported && catalog.app?.wingetId) {
    return {
      supported: true,
      remediationType: catalog.remediationType,
      autoRemediate: catalog.autoRemediate,
      source: 'catalog',
      confidence: 'medium',
      query,
      app: {
        name: catalog.app.name,
        publisher: catalog.app.publisher,
        packageId: catalog.app.wingetId,
        installerType: 'winget',
        installCommand: `winget install --id ${catalog.app.wingetId} --exact --silent --accept-source-agreements --accept-package-agreements`,
        uninstallCommand: `winget uninstall --id ${catalog.app.wingetId} --exact --silent`,
        sourceUrl: null,
        whySelected: 'Matched internal application remediation catalog.',
        notes: [],
        evidence: []
      },
      alternatives: live?.candidates?.slice(0, 5) || []
    };
  }

  return {
    supported: false,
    remediationType: 'manual-review',
    autoRemediate: false,
    query,
    app: null,
    alternatives: live?.candidates?.slice(0, 5) || []
  };
}

router.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'webapp-remediation-executor' });
});

router.post('/resolve', async (req, res) => {
  if (!validateSharedToken(req, res)) return;

  try {
    const { finding = {} } = req.body || {};
    const resolution = await resolveApplication(finding);

    return res.json({
      ok: true,
      input: {
        productName: finding.productName || finding.softwareName || finding.name || '',
        publisher: finding.publisher || '',
        cveId: finding.cveId || null
      },
      resolution
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to resolve remediation plan.'
    });
  }
});

router.post('/execute', async (req, res) => {
  if (!validateSharedToken(req, res)) return;

  try {
    const { tenantId, approvalId, devices = [], finding = {}, plan = {} } = req.body || {};

    const resolved = plan?.app?.installCommand
      ? {
          supported: true,
          remediationType: plan.remediationType || 'win32-package',
          autoRemediate: true,
          app: plan.app,
          source: plan.app?.installerType || plan.app?.source || 'external'
        }
      : await resolveApplication(finding);

    if (!resolved.supported || !resolved.app?.installCommand) {
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
        installerType: resolved.app.installerType,
        source: resolved.source || resolved.app.installerType,
        nextStep: 'Wire this queued job into your Intune Win32 packaging/assignment workflow.'
      },
      sourceFinding: {
        cveId: finding.cveId || null,
        productName: finding.productName || finding.softwareName || finding.name || null,
        publisher: finding.publisher || null,
        recommendation: finding.recommendation || null
      }
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to queue remediation job.'
    });
  }
});

export default router;
