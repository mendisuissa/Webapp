/**
 * WinGet / Intune deployment helpers.
 * Shared by both the interactive API route (/api/winget/deploy) and the
 * headless remediation route (/api/remediation/execute) so we never need
 * to make a loopback HTTP call that would be blocked by ensureConnected.
 */

import { graphRequest, graphList } from '../graph/graphClient.js';

// ── Types ────────────────────────────────────────────────────────────────────

export type WinGetAssignmentTarget = {
  groupId: string;
};

export type WingetIconPayload = {
  type: string;
  value: string;
};

export type WinGetCreateAppPayload = {
  packageIdentifier: string;
  displayName: string;
  publisher: string;
  runAsAccount: 'system' | 'user';
  updateMode: 'auto' | 'manual';
  notes?: string;
  icon?: WingetIconPayload;
};

export type PublishingWaitResult = {
  appId: string;
  displayName: string;
  publishingState: string;
  timedOut: boolean;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildWingetIcon(icon?: WingetIconPayload) {
  if (!icon) return undefined;
  return {
    '@odata.type': '#microsoft.graph.mimeContent',
    type: icon.type,
    value: icon.value
  };
}

// ── Graph calls ──────────────────────────────────────────────────────────────

export async function createWinGetApp(
  accessToken: string,
  payload: WinGetCreateAppPayload
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {
    '@odata.type': '#microsoft.graph.winGetApp',
    displayName: payload.displayName,
    publisher: payload.publisher,
    packageIdentifier: payload.packageIdentifier,
    description: `Managed by Modern Endpoint · Update mode: ${payload.updateMode}`,
    notes: payload.notes ?? `Managed by Modern Endpoint · Update mode: ${payload.updateMode}`,
    installExperience: {
      runAsAccount: payload.runAsAccount
    },
    isFeatured: false,
    roleScopeTagIds: ['0']
  };

  const largeIcon = buildWingetIcon(payload.icon);
  if (largeIcon) body.largeIcon = largeIcon;

  return graphRequest<Record<string, unknown>>(
    accessToken,
    '/beta/deviceAppManagement/mobileApps',
    { method: 'POST', body }
  );
}

export async function getMobileAppPublishingState(
  accessToken: string,
  appId: string
): Promise<PublishingWaitResult> {
  const app = await graphRequest<Record<string, unknown>>(
    accessToken,
    `/beta/deviceAppManagement/mobileApps/${appId}?$select=id,displayName,publishingState`
  );
  return {
    appId: String(app.id ?? appId),
    displayName: String(app.displayName ?? appId),
    publishingState: String(app.publishingState ?? 'unknown'),
    timedOut: false
  };
}

export async function waitForMobileAppPublished(
  accessToken: string,
  appId: string,
  options?: { timeoutMs?: number; intervalMs?: number }
): Promise<PublishingWaitResult> {
  const timeoutMs = options?.timeoutMs ?? 90000;
  const intervalMs = options?.intervalMs ?? 4000;
  const started = Date.now();

  let last: PublishingWaitResult = {
    appId,
    displayName: appId,
    publishingState: 'unknown',
    timedOut: false
  };

  while (Date.now() - started < timeoutMs) {
    last = await getMobileAppPublishingState(accessToken, appId);
    if (String(last.publishingState).toLowerCase() === 'published') {
      return { ...last, timedOut: false };
    }
    await sleep(intervalMs);
  }

  return { ...last, timedOut: true };
}

export async function createAssignment(
  accessToken: string,
  appId: string,
  assignment: { groupId: string; installIntent: 'required' | 'available' | 'uninstall' }
): Promise<Record<string, unknown>> {
  return graphRequest<Record<string, unknown>>(
    accessToken,
    `/beta/deviceAppManagement/mobileApps/${appId}/assignments`,
    {
      method: 'POST',
      body: {
        '@odata.type': '#microsoft.graph.mobileAppAssignment',
        intent: assignment.installIntent,
        target: {
          '@odata.type': '#microsoft.graph.groupAssignmentTarget',
          groupId: assignment.groupId
        }
      }
    }
  );
}

export async function assignTargetsToPublishedApp(
  accessToken: string,
  appId: string,
  targets: WinGetAssignmentTarget[],
  installIntent: 'required' | 'available'
): Promise<{ appId: string; createdAssignments: number; publishingState: string; pending: boolean }> {
  const publishResult = await waitForMobileAppPublished(accessToken, appId);

  if (publishResult.timedOut || publishResult.publishingState.toLowerCase() !== 'published') {
    return { appId, createdAssignments: 0, publishingState: publishResult.publishingState, pending: true };
  }

  let createdAssignments = 0;
  for (const target of targets) {
    await createAssignment(accessToken, appId, { groupId: target.groupId, installIntent });
    createdAssignments += 1;
  }

  return { appId, createdAssignments, publishingState: publishResult.publishingState, pending: false };
}

/**
 * Deploy a WinGet app to Intune using an access token.
 * Returns a result object compatible with the /api/winget/deploy response shape.
 */
export async function deployWinGetToIntune(
  accessToken: string,
  opts: {
    packageIdentifier: string;
    displayName: string;
    publisher: string;
    installIntent: 'required' | 'available';
    runAsAccount: 'system' | 'user';
    updateMode: 'auto' | 'manual';
    assignNow: boolean;
    targets: WinGetAssignmentTarget[];
    icon?: WingetIconPayload;
  }
): Promise<{
  ok: boolean;
  appId?: string;
  createdAssignments: number;
  publishingState: string;
  timedOut: boolean;
  message: string;
}> {
  const app = await createWinGetApp(accessToken, {
    packageIdentifier: opts.packageIdentifier,
    displayName: opts.displayName,
    publisher: opts.publisher,
    runAsAccount: opts.runAsAccount,
    updateMode: opts.updateMode,
    icon: opts.icon
  });

  const appId = String(app.id ?? '').trim();
  if (!appId) {
    return {
      ok: false,
      createdAssignments: 0,
      publishingState: 'unknown',
      timedOut: false,
      message: 'WinGet app creation returned no app ID.'
    };
  }

  if (!opts.assignNow || !opts.targets.length) {
    const publishResult = await waitForMobileAppPublished(accessToken, appId, { timeoutMs: 45000, intervalMs: 4000 });
    return {
      ok: true,
      appId,
      createdAssignments: 0,
      publishingState: publishResult.publishingState,
      timedOut: publishResult.timedOut,
      message: publishResult.timedOut
        ? `WinGet app ${opts.displayName} was created. Intune is still publishing it.`
        : `WinGet app ${opts.displayName} was created and is ${publishResult.publishingState}.`
    };
  }

  const assignmentResult = await assignTargetsToPublishedApp(accessToken, appId, opts.targets, opts.installIntent);
  if (assignmentResult.pending) {
    return {
      ok: true,
      appId,
      createdAssignments: 0,
      publishingState: assignmentResult.publishingState,
      timedOut: false,
      message: `WinGet app ${opts.displayName} was created but Intune has not finished publishing it yet.`
    };
  }

  return {
    ok: true,
    appId,
    createdAssignments: assignmentResult.createdAssignments,
    publishingState: assignmentResult.publishingState,
    timedOut: false,
    message: `WinGet app ${opts.displayName} created and assigned to ${assignmentResult.createdAssignments} group(s).`
  };
}
