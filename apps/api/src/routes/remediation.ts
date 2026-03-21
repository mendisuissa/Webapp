import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveCatalogApp } from '../services/remediationCatalog.js';
import { resolveWin32Search, type Win32SearchResponse } from '../engines/win32LiveResolver.js';
import { buildZip } from '../engines/win32Zip.js';

const router = Router();
const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const bundleRoot = path.resolve(currentDir, '../../../../../data/remediation-bundles');

type RemediationResolution = {
  supported: boolean;
  remediationType: string;
  autoRemediate: boolean;
  app?: {
    packageIdentifier?: string;
    wingetId?: string;
    installerType?: string;
    source?: string;
    confidence?: string;
    displayName?: string;
    publisher?: string;
    installCommand?: string;
    uninstallCommand?: string;
    detectScript?: string;
    sourceUrl?: string;
    notes?: string[];
  };
  detail?: string;
  source?: 'live-resolver' | 'catalog' | 'none';
};

function getSharedToken(req: any) {
  const authHeader = req.headers.authorization || '';
  return authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length)
    : '';
}

function hasValidSharedToken(req: any): boolean {
  const configuredToken = process.env.REMEDIATION_SHARED_TOKEN;
  if (!configuredToken) return true;
  return getSharedToken(req) === configuredToken;
}

function validateSharedToken(req: any, res: any): boolean {
  if (!hasValidSharedToken(req)) {
    res.status(401).json({ ok: false, error: 'Unauthorized remediation request.' });
    return false;
  }
  return true;
}

function extractProductQuery(finding: any) {
  const values = [
    finding?.productName,
    finding?.softwareName,
    finding?.name,
    finding?.publisher && finding?.productName ? `${finding.publisher} ${finding.productName}` : '',
    finding?.recommendation,
    finding?.description
  ]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);

  return values[0] ?? '';
}

function toResolutionFromLive(payload: Win32SearchResponse): RemediationResolution {
  const best = payload.bestMatch;
  if (!best) {
    return {
      supported: false,
      remediationType: 'manual-review',
      autoRemediate: false,
      detail: payload.message || 'No supported live package match was found.',
      source: 'none'
    };
  }

  const installerType = best.source === 'winget'
    ? 'winget'
    : best.installCommand.toLowerCase().includes('msiexec') || best.installCommand.toLowerCase().includes('.msi')
      ? 'msi'
      : best.installCommand.toLowerCase().includes('.msix')
        ? 'msix'
        : 'exe';

  return {
    supported: true,
    remediationType: installerType === 'winget' ? 'winget-intune-upgrade' : 'win32-package',
    autoRemediate: installerType === 'winget',
    source: 'live-resolver',
    app: {
      packageIdentifier: best.packageId,
      wingetId: best.packageId,
      installerType,
      source: best.source,
      confidence: best.confidence,
      displayName: best.name,
      publisher: best.publisher,
      installCommand: best.installCommand,
      uninstallCommand: best.uninstallCommand,
      detectScript: best.detectScript,
      sourceUrl: best.sourceUrl,
      notes: best.notes
    }
  };
}

async function resolveApplication(finding: any): Promise<RemediationResolution> {
  const query = extractProductQuery(finding);
  const publisher = String(finding?.publisher ?? '').trim();

  if (query) {
    try {
      const payload = await resolveWin32Search(query, 'quick');
      if (payload.bestMatch) return toResolutionFromLive(payload);
    } catch {
      // fall through to catalog
    }
  }

  const resolved = resolveCatalogApp(query, publisher);
  if (resolved.supported && resolved.app?.wingetId) {
    return {
      supported: true,
      remediationType: resolved.remediationType,
      autoRemediate: true,
      source: 'catalog',
      app: {
        packageIdentifier: resolved.app.wingetId,
        wingetId: resolved.app.wingetId,
        installerType: 'winget',
        source: 'catalog',
        confidence: 'medium',
        displayName: resolved.app.name ?? 'Unknown app',
        publisher: resolved.app.publisher,
        installCommand: `winget install --id ${resolved.app.wingetId} --silent --accept-package-agreements --accept-source-agreements`,
        uninstallCommand: `winget uninstall --id ${resolved.app.wingetId} --silent`,
        detectScript: `$app = Get-Command winget -ErrorAction SilentlyContinue
if (-not $app) { exit 1 }
$matches = winget list --id ${resolved.app.wingetId} 2>$null
if ($LASTEXITCODE -eq 0 -and $matches) { exit 0 }
exit 1`,
        notes: ['Resolved from built-in remediation catalog.']
      }
    };
  }

  return {
    supported: false,
    remediationType: 'manual-review',
    autoRemediate: false,
    detail: 'No supported EXE/MSI/Winget remediation path was identified for this finding.',
    source: 'none'
  };
}

function buildBundleZip(resolution: RemediationResolution) {
  const app = resolution.app ?? {};
  const appName = String(app.displayName ?? 'RemediationApp').trim();

  const safeName =
    appName
      .replace(/[^\w.-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'remediation-app';

  const root = `${safeName}/Intune-Package`;

  const installScript = [
    '$ErrorActionPreference = "Stop"',
    String(app.installCommand ?? 'Write-Error "No install command provided."')
  ].join('\n');

  const uninstallScript = [
    '$ErrorActionPreference = "Stop"',
    String(app.uninstallCommand ?? 'Write-Output "No uninstall command provided."')
  ].join('\n');

  const detectScript = String(
    app.detectScript ??
      [
        'Write-Output "Detection script missing"',
        'exit 1'
      ].join('\n')
  );

  const readme = [
    `${appName} remediation bundle`,
    '',
    `Installer type: ${app.installerType ?? 'unknown'}`,
    `Source: ${app.source ?? 'unknown'}`,
    `Package ID: ${app.packageIdentifier ?? 'n/a'}`,
    `Source URL: ${app.sourceUrl ?? 'n/a'}`,
    '',
    'Files included:',
    '- install.ps1',
    '- uninstall.ps1',
    '- detect.ps1',
    '- README.txt',
    '- files/put-installer-here.txt'
  ].join('\n');

  return {
    safeName,
    bytes: buildZip([
      { name: `${root}/install.ps1`, content: installScript },
      { name: `${root}/uninstall.ps1`, content: uninstallScript },
      { name: `${root}/detect.ps1`, content: detectScript },
      { name: `${root}/README.txt`, content: readme },
      {
        name: `${root}/files/put-installer-here.txt`,
        content: 'Place the original installer media in this folder before packaging.'
      }
    ])
  };
}

async function writeBundle(jobId: string, resolution: RemediationResolution) {
  await fs.mkdir(bundleRoot, { recursive: true });
  const { safeName, bytes } = buildBundleZip(resolution);
  const filePath = path.join(bundleRoot, `${jobId}-${safeName}.zip`);
  await fs.writeFile(filePath, Buffer.from(bytes));
  return { filePath, fileName: path.basename(filePath) };
}

function getBaseUrl(req: any) {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost:4000');
  return `${proto}://${host}`;
}

async function callSelfApi(req: any, endpoint: string, body: Record<string, unknown>) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };

  const cookie = String(req.headers.cookie || '');
  if (cookie) headers.cookie = cookie;

  const sharedToken = getSharedToken(req);
  if (sharedToken) headers.authorization = `Bearer ${sharedToken}`;

  const response = await fetch(`${getBaseUrl(req)}${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      payload
    };
  }
  return {
    ok: true,
    status: response.status,
    payload
  };
}

router.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'webapp-remediation-executor',
    bundleRoot,
    sharedTokenConfigured: !!process.env.REMEDIATION_SHARED_TOKEN,
    sharedTokenAccepted: hasValidSharedToken(req)
  });
});

router.get('/bundles/:fileName', async (req, res) => {
  const fileName = path.basename(String(req.params.fileName || ''));
  const filePath = path.join(bundleRoot, fileName);
  try {
    await fs.access(filePath);
    return res.download(filePath, fileName);
  } catch {
    return res.status(404).json({ ok: false, error: 'Bundle not found.' });
  }
});

router.post('/resolve', async (req, res) => {
  if (!validateSharedToken(req, res)) return;

  const { finding = {} } = req.body || {};
  const resolution = await resolveApplication(finding);

  return res.json({
    ok: true,
    input: {
      productName: finding.productName || finding.softwareName || null,
      publisher: finding.publisher || null,
      cveId: finding.cveId || null,
      category: finding.category || null,
      severity: finding.severity || null
    },
    connection: {
      mode: (req as any).session?.accessToken ? 'session' : hasValidSharedToken(req) ? 'shared-token' : 'none',
      executable: !!(req as any).session?.accessToken || hasValidSharedToken(req)
    },
    resolution
  });
});

router.post('/execute', async (req, res) => {
  if (!validateSharedToken(req, res)) return;

  const { tenantId, approvalId, devices = [], finding = {}, plan = {} } = req.body || {};
  const accessToken = (req as any).session?.accessToken as string | undefined;
  const sharedToken = hasValidSharedToken(req);

  const resolution = plan?.app?.wingetId || plan?.app?.installCommand
    ? {
        supported: true,
        remediationType: plan.remediationType || (plan?.app?.installerType === 'winget' ? 'winget-intune-upgrade' : 'win32-package'),
        autoRemediate: plan?.app?.installerType === 'winget',
        source: 'live-resolver' as const,
        app: plan.app
      }
    : await resolveApplication(finding);

  if (!resolution.supported || !resolution.app) {
    return res.status(400).json({
      ok: false,
      error: 'Unsupported application for automatic remediation.',
      resolution
    });
  }

  const jobId = `rem_${crypto.randomBytes(6).toString('hex')}`;

  if (resolution.app.installerType === 'winget' && resolution.app.packageIdentifier && accessToken) {
    const live = await callSelfApi(req, '/api/winget/deploy', {
      packageIdentifier: resolution.app.packageIdentifier,
      displayName: resolution.app.displayName || finding.productName || finding.softwareName || resolution.app.packageIdentifier,
      publisher: resolution.app.publisher || finding.publisher || 'Unknown',
      assignNow: false,
      installIntent: 'required',
      runAsAccount: 'system',
      updateMode: 'manual',
      targets: Array.isArray(devices) ? devices : []
    });

    if (live.ok) {
      return res.json({
        ok: true,
        jobId,
        status: live.status === 202 ? 'publishing' : 'executed',
        executor: 'webapp',
        mode: 'live-winget-intune',
        tenantId: tenantId || null,
        approvalId: approvalId || null,
        app: resolution.app,
        live: live.payload,
        sourceFinding: {
          cveId: finding.cveId || null,
          productName: finding.productName || finding.softwareName || null,
          publisher: finding.publisher || null,
          recommendation: finding.recommendation || null
        }
      });
    }

    const bundleInfo = await writeBundle(jobId, resolution);
    return res.status(202).json({
      ok: true,
      jobId,
      status: 'bundle-created',
      executor: 'webapp',
      mode: 'bundle-fallback',
      tenantId: tenantId || null,
      approvalId: approvalId || null,
      targets: devices,
      app: resolution.app,
      liveError: live.payload,
      connection: {
        mode: accessToken ? 'session' : sharedToken ? 'shared-token' : 'none',
        liveWingetAvailable: !!accessToken,
        reason: 'Live WinGet Intune execution requires an interactive Webapp session. Falling back to bundle generation.'
      },
      bundle: bundleInfo,
      execution: {
        type: resolution.remediationType,
        nextStep: 'Bundle created because live Intune winget execution was not available from the current connection context.'
      },
      sourceFinding: {
        cveId: finding.cveId || null,
        productName: finding.productName || finding.softwareName || null,
        publisher: finding.publisher || null,
        recommendation: finding.recommendation || null
      }
    });
  }

  const bundle = await writeBundle(jobId, resolution);
  return res.status(202).json({
    ok: true,
    jobId,
    status: 'bundle-created',
    executor: 'webapp',
    mode: accessToken ? 'bundle-fallback' : 'offline-bundle',
    tenantId: tenantId || null,
    approvalId: approvalId || null,
    targets: devices,
    app: resolution.app,
    connection: {
      mode: accessToken ? 'session' : sharedToken ? 'shared-token' : 'none',
      liveWingetAvailable: !!accessToken
    },
    bundle: {
      fileName: bundle.fileName,
      downloadPath: `/api/remediation/bundles/${encodeURIComponent(bundle.fileName)}`
    },
    execution: {
      type: resolution.remediationType,
      nextStep: accessToken
        ? 'Bundle created because live Intune winget execution was not available for this installer type.'
        : 'Bundle created. Sign in to Webapp to enable live WinGet Intune execution for Winget-backed packages.'
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
