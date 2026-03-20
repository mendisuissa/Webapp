import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { resolveCatalogApp } from '../services/remediationCatalog.js';
import { resolveWin32Search } from '../engines/win32LiveResolver.js';
import { logger } from '../utils/logger.js';

const router = Router();

type GenericFinding = {
  productName?: string;
  softwareName?: string;
  name?: string;
  publisher?: string;
  recommendation?: string;
  cveId?: string;
};

type ResolvedApp = {
  name?: string;
  publisher?: string;
  packageId?: string | null;
  installCommand?: string | null;
  uninstallCommand?: string | null;
  source?: string | null;
  confidence?: string | null;
  confidenceScore?: number | null;
  confidenceReasons?: string[];
  sourceUrl?: string | null;
  installerType?: string | null;
  installerUrl?: string | null;
  downloadPageUrl?: string | null;
  version?: string | null;
  exportReadiness?: string | null;
};

function validateSharedToken(req: Request, res: Response): boolean {
  const configuredToken = process.env.REMEDIATION_SHARED_TOKEN;
  const authHeader = String(req.headers.authorization || '');

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

function buildQuery(finding: GenericFinding = {}, hint = ''): string {
  return (
    hint ||
    finding.productName ||
    finding.softwareName ||
    finding.name ||
    finding.recommendation ||
    finding.cveId ||
    ''
  ).trim();
}

function inferInstallerType(bestMatch: ResolvedApp): string {
  const explicit = String(bestMatch?.installerType || '').toLowerCase();
  if (explicit) return explicit;

  const installerUrl = String(bestMatch?.installerUrl || '').toLowerCase();
  if (installerUrl.endsWith('.msi')) return 'msi';
  if (installerUrl.endsWith('.msix') || installerUrl.endsWith('.msixbundle')) return 'msix';
  if (installerUrl.endsWith('.exe')) return 'exe';

  const installCommand = String(bestMatch?.installCommand || '').toLowerCase();
  if (installCommand.includes('msiexec')) return 'msi';
  if (installCommand.includes('winget')) return 'winget';
  if (installCommand.includes('.msix')) return 'msix';
  if (installCommand.includes('.exe') || installCommand.includes('/s') || installCommand.includes('/silent')) return 'exe';
  return 'unknown';
}

async function resolveAdvancedApp(productName: string, publisher: string, finding: GenericFinding = {}) {
  const query = buildQuery(finding, productName);
  const live = await resolveWin32Search(query, 'quick');
  const best = (live?.bestMatch || null) as ResolvedApp | null;

  if (best) {
    return {
      supported: true,
      remediationType: best.packageId ? 'catalog-package-upgrade' : 'custom-win32-package',
      autoRemediate: true,
      app: {
        name: best.name,
        publisher: best.publisher,
        packageId: best.packageId || null,
        installCommand: best.installCommand || null,
        uninstallCommand: best.uninstallCommand || null,
        source: best.source || null,
        confidence: best.confidence || null,
        confidenceScore: best.confidenceScore ?? null,
        confidenceReasons: best.confidenceReasons || [],
        sourceUrl: best.sourceUrl || null,
        installerType: inferInstallerType(best),
        installerUrl: best.installerUrl || null,
        downloadPageUrl: best.downloadPageUrl || null,
        version: best.version || null,
        exportReadiness: best.exportReadiness || null
      },
      candidates: live?.candidates || [],
      checkedSources: live?.checkedSources || [],
      message: live?.message || 'Resolved from Win32 catalog/live sources.'
    };
  }

  const catalog = resolveCatalogApp(productName, publisher);
  return {
    ...catalog,
    remediationType: catalog?.remediationType || 'manual-review',
    message: 'No Win32 live match found. Falling back to static catalog.'
  };
}

router.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'webapp-remediation-executor' });
});

router.post('/resolve', async (req, res) => {
  if (!validateSharedToken(req, res)) return;

  try {
    const { finding = {} } = req.body || {};
    const typedFinding = (finding || {}) as GenericFinding;
    const productName = typedFinding.productName || typedFinding.softwareName || typedFinding.name || '';
    const publisher = typedFinding.publisher || '';

    const resolved = await resolveAdvancedApp(productName, publisher, typedFinding);

    return res.json({
      ok: true,
      input: {
        productName,
        publisher,
        cveId: typedFinding.cveId || null
      },
      resolution: resolved
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to resolve remediation request');
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to resolve remediation request.'
    });
  }
});

router.post('/execute', async (req, res) => {
  if (!validateSharedToken(req, res)) return;

  try {
    const { tenantId, approvalId, devices = [], finding = {}, plan = {} } = req.body || {};
    const typedFinding = (finding || {}) as GenericFinding;
    const resolved =
      plan?.app?.name
        ? {
            supported: true,
            remediationType: plan.remediationType || 'custom-win32-package',
            autoRemediate: true,
            app: plan.app
          }
        : await resolveAdvancedApp(
            typedFinding.productName || typedFinding.softwareName || typedFinding.name || '',
            typedFinding.publisher || '',
            typedFinding
          );

    if (!resolved.supported || !resolved.app) {
      return res.status(400).json({
        ok: false,
        error: 'Unsupported application for automatic remediation.',
        resolution: resolved
      });
    }

    const jobId = `rem_${crypto.randomBytes(6).toString('hex')}`;
    const installerType = resolved.app.installerType || inferInstallerType(resolved.app);

    return res.json({
      ok: true,
      jobId,
      status: 'queued',
      executor: 'webapp',
      tenantId: tenantId || null,
      approvalId: approvalId || null,
      targets: Array.isArray(devices) ? devices : [],
      app: resolved.app,
      execution: {
        type: resolved.remediationType,
        installerType,
        nextStep:
          installerType === 'winget'
            ? 'Use the package identifier in your Intune/Winget workflow.'
            : 'Use the returned install/uninstall commands to build the Win32 package and assign it.'
      },
      sourceFinding: {
        cveId: typedFinding.cveId || null,
        productName: typedFinding.productName || typedFinding.softwareName || typedFinding.name || null,
        publisher: typedFinding.publisher || null,
        recommendation: typedFinding.recommendation || null
      }
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to queue remediation execution');
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to queue remediation execution.'
    });
  }
});

export default router;
