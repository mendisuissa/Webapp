import { Router, type NextFunction, type Request, type Response } from 'express';
import fs from 'fs/promises';
import { buildZip } from '../engines/win32Zip.js';
import { resolveWin32Search, type Win32SearchMode } from '../engines/win32LiveResolver.js';
import { DashboardData, SettingsData, ViewName } from '@efm/shared';
import { config } from '../config.js';
import { normalizeStatus } from '../engines/normalization.js';
import { buildIncidents } from '../engines/incidents.js';
import { buildSmartSummary } from '../engines/smartSummary.js';
import { buildInsights } from '../engines/insights.js';
import { recommendPlaybooks } from '../engines/playbooks.js';
import { getDataBundle } from '../graph/provider.js';
import { graphList, graphRequest } from '../graph/graphClient.js';
import { logger } from '../utils/logger.js';
import { toCsv } from '../utils/safe.js';
import { PrismaIncidentRepository } from '../storage/incidentRepository.js';
import { postIntuneAi } from './intuneAi.js';

const incidentRepo = new PrismaIncidentRepository();

function ensureConnected(req: Request, res: Response, next: NextFunction): void {
  if (config.mockMode || (req as any).session?.accessToken) {
    next();
    return;
  }
  res.status(401).json({ message: 'Not connected. Click Connect first.' });
}

async function getViewData(accessToken?: string) {
  const bundle = await getDataBundle(accessToken);

  const statuses = [] as typeof bundle.appStatuses;
  for (const row of bundle.appStatuses ?? []) {
    const normalized = await normalizeStatus(row);
    statuses.push({
      ...row,
      normalizedCategory: normalized.normalizedCategory,
      cause: normalized.cause,
      confidence: normalized.confidence,
      recommendedActions: normalized.recommendedActions,
      errorFamily: normalized.errorFamily,
      signatureKey: normalized.signatureKey,
      signatureHash: normalized.signatureHash
    });
  }

  // Build incidents and try persist
  const incidents = buildIncidents(statuses as any, config.severityThresholds);
  try {
    await incidentRepo.upsertMany(incidents);
  } catch (error) {
    logger.warn({ err: error }, 'Incident persistence failed; continuing with in-memory incidents.');
  }

  // Merge users from directory + devices + statuses
  const mergedUsers = new Map<string, { id: string; displayName: string; userPrincipalName: string; mail: string }>();

  for (const user of bundle.users ?? []) {
    const upn = (user.userPrincipalName ?? '').trim().toLowerCase();
    if (!upn) continue;

    mergedUsers.set(upn, {
      id: user.id,
      displayName: user.displayName,
      userPrincipalName: user.userPrincipalName,
      mail: user.mail
    });
  }

  for (const device of bundle.devices ?? []) {
    const upn = (device.userPrincipalName ?? '').trim().toLowerCase();
    if (!upn || mergedUsers.has(upn)) continue;

    mergedUsers.set(upn, {
      id: `device:${upn}`,
      displayName: device.userDisplayName || upn.split('@')[0],
      userPrincipalName: upn,
      mail: upn
    });
  }

  for (const status of statuses as any[]) {
    if (status.targetType !== 'user') continue;
    const candidate = (status.targetName ?? '').trim().toLowerCase();
    if (!candidate.includes('@') || mergedUsers.has(candidate)) continue;

    mergedUsers.set(candidate, {
      id: `status:${candidate}`,
      displayName: status.targetName,
      userPrincipalName: candidate,
      mail: candidate
    });
  }

  const users = Array.from(mergedUsers.values()).sort((a, b) => a.displayName.localeCompare(b.displayName));

  return {
    apps: bundle.apps ?? [],
    devices: bundle.devices ?? [],
    users,
    statuses,
    incidents
  };
}



function normalizeGraphPlatform(rawType: string): string {
  const text = String(rawType ?? '').toLowerCase();
  if (text.includes('mac')) return 'macOS';
  if (text.includes('ios') || text.includes('android') || text.includes('mobile')) return 'mobile';
  if (text.includes('win') || text.includes('msi')) return 'windows';
  return text || 'unknown';
}

function summarizeAssignmentTarget(target: Record<string, unknown>): string {
  const type = String(target['@odata.type'] ?? '').toLowerCase();
  if (type.includes('alllicensedusers')) return 'All licensed users';
  if (type.includes('alldevices')) return 'All devices';
  if (type.includes('groupassignmenttarget')) return `Group ${String(target.groupId ?? '').slice(0, 8) || 'target'}`;
  return type ? type.replace('#microsoft.graph.', '').replace('microsoft.graph.', '') : 'Unknown target';
}

function sanitizeAssignmentPayload(assignment: Record<string, unknown>, intent: 'uninstall' | 'required' | 'available' = 'uninstall') {
  return {
    '@odata.type': '#microsoft.graph.mobileAppAssignment',
    intent,
    target: assignment.target,
    settings: assignment.settings
  };
}

function summarizeAssignmentTargetType(target: Record<string, unknown>): string {
  const type = String(target['@odata.type'] ?? '').toLowerCase();
  if (type.includes('alllicensedusers')) return 'all-users';
  if (type.includes('alldevices')) return 'all-devices';
  if (type.includes('groupassignmenttarget')) return 'group';
  return 'unknown';
}

function mapAssignmentRow(assignment: Record<string, unknown>) {
  const target = (assignment.target ?? {}) as Record<string, unknown>
  const targetType = summarizeAssignmentTargetType(target);
  const filterId = String(target.deviceAndAppManagementAssignmentFilterId ?? '').trim();
  const filterType = String(target.deviceAndAppManagementAssignmentFilterType ?? '').trim();
  return {
    id: String(assignment.id ?? ''),
    intent: String(assignment.intent ?? 'unknown'),
    targetType,
    targetName: summarizeAssignmentTarget(target),
    groupId: String(target.groupId ?? ''),
    filterInfo: filterId ? `${filterType || 'filter'} · ${filterId}` : ''
  };
}

function encodeGraphString(value: string): string {
  return value.replace(/'/g, "''");
}

async function searchLiveGroups(accessToken: string, query: string) {
  const trimmed = query.trim();
  if (!trimmed) return [] as Array<{ id: string; displayName: string; description?: string }>;

  const guidPattern = /^[0-9a-fA-F-]{36}$/;
  if (guidPattern.test(trimmed)) {
    try {
      const group = await graphRequest<Record<string, unknown>>(accessToken, `/v1.0/groups/${trimmed}?$select=id,displayName,description`);
      return [{
        id: String(group.id ?? trimmed),
        displayName: String(group.displayName ?? trimmed),
        description: String(group.description ?? '')
      }];
    } catch (error) {
      logger.warn({ err: error }, 'Direct group lookup by object ID failed.');
    }
  }

  const q = encodeGraphString(trimmed);
  const endpoints = [
    `/v1.0/groups?$top=12&$select=id,displayName,description&$filter=startswith(displayName,'${q}')`,
    `/v1.0/groups?$top=12&$select=id,displayName,description&$search="displayName:${q}"`,
    `/beta/groups?$top=12&$select=id,displayName,description&$filter=startswith(displayName,'${q}')`
  ];

  for (const endpoint of endpoints) {
    try {
      const rows = await graphList(accessToken, endpoint, endpoint.includes('$search=') ? { ConsistencyLevel: 'eventual' } : {});
      if (rows.length) {
        return rows.map((row) => ({
          id: String(row.id ?? ''),
          displayName: String(row.displayName ?? row.id ?? 'Unknown group'),
          description: String(row.description ?? '')
        }));
      }
    } catch (error) {
      logger.warn({ err: error, endpoint }, 'Group search attempt failed.');
    }
  }

  return [];
}



type TokenDiagnostics = {
  scopes: string[];
  roles: string[];
  appId: string;
  audience: string;
  tenantId: string;
  expiresAt: string;
};

type ReadinessCheck = {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
};

type PlatformReadiness = {
  connected: boolean;
  mockMode: boolean;
  diagnostics: TokenDiagnostics;
  checks: ReadinessCheck[];
  groupLookupHint: string;
  uninstallHint: string;
};

function decodeJwtPayload(token?: string): Record<string, unknown> {
  if (!token) return {};
  const parts = token.split('.');
  if (parts.length < 2) return {};
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
    const json = Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function getTokenDiagnostics(accessToken?: string): TokenDiagnostics {
  const payload = decodeJwtPayload(accessToken);
  const scopes = String(payload.scp ?? '').split(' ').map((item) => item.trim()).filter(Boolean);
  const roles = Array.isArray(payload.roles) ? payload.roles.map((item) => String(item)) : [];
  const exp = Number(payload.exp ?? 0);
  return {
    scopes,
    roles,
    appId: String(payload.appid ?? payload.azp ?? ''),
    audience: String(payload.aud ?? ''),
    tenantId: String(payload.tid ?? ''),
    expiresAt: exp ? new Date(exp * 1000).toISOString() : ''
  };
}

function hasPermission(diag: TokenDiagnostics, permission: string): boolean {
  return diag.scopes.includes(permission) || diag.roles.includes(permission);
}

async function canReadGroups(accessToken: string): Promise<{ ok: boolean; detail: string }> {
  try {
    await graphRequest<Record<string, unknown>>(accessToken, `/v1.0/groups?$top=1&$select=id,displayName`, { headers: { ConsistencyLevel: 'eventual' } });
    return { ok: true, detail: 'Graph group lookup succeeded.' };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Group lookup failed.';
    return { ok: false, detail };
  }
}

async function buildPlatformReadiness(accessToken?: string): Promise<PlatformReadiness> {
  const diagnostics = getTokenDiagnostics(accessToken);
  const connected = Boolean(accessToken);
  const checks: ReadinessCheck[] = [
    {
      id: 'graph-token',
      label: 'Graph session token',
      ok: connected,
      detail: connected ? 'User session is connected to Microsoft Graph.' : 'Sign in first to get a delegated Graph token.'
    },
    {
      id: 'managed-devices-read',
      label: 'Managed devices read',
      ok: hasPermission(diagnostics, 'DeviceManagementManagedDevices.Read.All'),
      detail: hasPermission(diagnostics, 'DeviceManagementManagedDevices.Read.All')
        ? 'Managed device read scope detected in the token.'
        : 'Add DeviceManagementManagedDevices.Read.All and sign in again.'
    },
    {
      id: 'apps-rw',
      label: 'Intune app read-write',
      ok: hasPermission(diagnostics, 'DeviceManagementApps.ReadWrite.All'),
      detail: hasPermission(diagnostics, 'DeviceManagementApps.ReadWrite.All')
        ? 'App assignment write scope detected. WinGet deploy and uninstall can use live Graph operations.'
        : 'Add DeviceManagementApps.ReadWrite.All, grant admin consent, then disconnect and sign in again.'
    },
    {
      id: 'groups-read',
      label: 'Group lookup',
      ok: hasPermission(diagnostics, 'Group.Read.All') || hasPermission(diagnostics, 'Directory.Read.All'),
      detail: (hasPermission(diagnostics, 'Group.Read.All') || hasPermission(diagnostics, 'Directory.Read.All'))
        ? 'Directory/group read scope detected in the token.'
        : 'Add Group.Read.All or Directory.Read.All to search target groups from the UI.'
    }
  ];

  if (connected && !config.mockMode) {
    const groupCheck = await canReadGroups(accessToken!);
    const existing = checks.find((item) => item.id === 'groups-read');
    if (existing) {
      existing.ok = existing.ok && groupCheck.ok;
      existing.detail = existing.ok
        ? 'Directory/group read scope is present and live Graph group lookup succeeded.'
        : groupCheck.detail;
    }
  }

  return {
    connected,
    mockMode: config.mockMode,
    diagnostics,
    checks,
    groupLookupHint: 'Use Group.Read.All or Directory.Read.All for group search. You can also paste a group object ID directly.',
    uninstallHint: 'Intune uninstall works by switching existing assignments to uninstall intent. Choose specific user/device group assignments before applying changes.'
  };
}

async function searchWingetCatalog(query: string) {
  const trimmed = query.trim();
  if (!trimmed) return [] as Array<Record<string, string>>;

  const response = await fetch(`https://winget.run/search?query=${encodeURIComponent(trimmed)}`, {
    headers: { 'User-Agent': 'ModernEndpoint/1.0' }
  });

  if (!response.ok) {
    throw new Error(`WinGet search failed (${response.status}).`);
  }

  const html = await response.text();
  const matches = html.matchAll(/\/pkg\/([^"'?#<\s]+)\/([^"'?#<\s]+)/g);
  const seen = new Set<string>();
  const rows: Array<Record<string, string>> = [];

  for (const match of matches) {
    const publisher = decodeURIComponent(match[1] ?? '').trim();
    const name = decodeURIComponent(match[2] ?? '').trim();
    if (!publisher || !name) continue;

    const packageIdentifier = `${publisher}.${name}`;
    if (seen.has(packageIdentifier)) continue;
    seen.add(packageIdentifier);

    rows.push({
      packageIdentifier,
      name: name.replace(/[-_.]+/g, ' '),
      publisher,
      sourceUrl: `https://winget.run/pkg/${publisher}/${name}`
    });

    if (rows.length >= 12) break;
  }

  if (!rows.length && trimmed.includes('.')) {
    const [publisher, ...rest] = trimmed.split('.');
    rows.push({
      packageIdentifier: trimmed,
      name: rest.join(' ') || trimmed,
      publisher,
      sourceUrl: 'https://winget.run'
    });
  }

  return rows;
}

type WinGetAssignmentTarget = {
  groupId: string;
};

type WingetIconPayload = {
  type: string;
  value: string;
};

type WinGetCreateAppPayload = {
  packageIdentifier: string;
  displayName: string;
  publisher: string;
  runAsAccount: 'system' | 'user';
  updateMode: 'auto' | 'manual';
  notes?: string;
  icon?: WingetIconPayload;
};

type WingetOperationStatus = 'created' | 'publishing' | 'published' | 'published-unassigned' | 'assigned' | 'failed';

type PublishingWaitResult = {
  appId: string;
  displayName: string;
  publishingState: string;
  timedOut: boolean;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeWingetTargets(targets: unknown[]): WinGetAssignmentTarget[] {
  const seen = new Set<string>();
  const normalized: WinGetAssignmentTarget[] = [];

  for (const target of targets) {
    const groupId = String((target as any)?.groupId ?? '').trim();
    if (!groupId || seen.has(groupId)) continue;
    seen.add(groupId);
    normalized.push({ groupId });
  }

  return normalized;
}

function normalizeWingetIcon(input: unknown): WingetIconPayload | undefined {
  const type = String((input as any)?.type ?? '').trim();
  const value = String((input as any)?.value ?? '').trim();
  if (!type || !value) return undefined;
  return { type, value };
}

function buildWingetIcon(icon?: WingetIconPayload) {
  if (!icon) return undefined;
  return {
    '@odata.type': '#microsoft.graph.mimeContent',
    type: icon.type,
    value: icon.value
  };
}

async function createAssignment(accessToken: string, appId: string, assignment: { groupId: string; installIntent: 'required' | 'available' | 'uninstall' }) {
  return graphRequest<Record<string, unknown>>(accessToken, `/beta/deviceAppManagement/mobileApps/${appId}/assignments`, {
    method: 'POST',
    body: {
      '@odata.type': '#microsoft.graph.mobileAppAssignment',
      intent: assignment.installIntent,
      target: {
        '@odata.type': '#microsoft.graph.groupAssignmentTarget',
        groupId: assignment.groupId
      }
    }
  });
}

async function createWinGetApp(accessToken: string, payload: WinGetCreateAppPayload) {
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

  return graphRequest<Record<string, unknown>>(accessToken, '/beta/deviceAppManagement/mobileApps', {
    method: 'POST',
    body
  });
}

async function updateWinGetApp(accessToken: string, appId: string, payload: Partial<WinGetCreateAppPayload>) {
  const body: Record<string, unknown> = {
    '@odata.type': '#microsoft.graph.winGetApp'
  };

  if (payload.displayName) body.displayName = payload.displayName;
  if (payload.publisher) body.publisher = payload.publisher;
  if (payload.notes) body.notes = payload.notes;
  if (payload.updateMode) body.description = `Managed by Modern Endpoint · Update mode: ${payload.updateMode}`;

  const largeIcon = buildWingetIcon(payload.icon);
  if (largeIcon) body.largeIcon = largeIcon;

  if (Object.keys(body).length === 1) {
    return { id: appId, message: 'No mutable WinGet app fields were provided.' } as Record<string, unknown>;
  }

  return graphRequest<Record<string, unknown>>(accessToken, `/beta/deviceAppManagement/mobileApps/${appId}`, {
    method: 'PATCH',
    body
  });
}

async function getMobileAppPublishingState(accessToken: string, appId: string): Promise<PublishingWaitResult> {
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

async function waitForMobileAppPublished(
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

async function assignTargetsToPublishedApp(
  accessToken: string,
  appId: string,
  targets: WinGetAssignmentTarget[],
  installIntent: 'required' | 'available'
) {
  const publishResult = await waitForMobileAppPublished(accessToken, appId);

  if (publishResult.timedOut || publishResult.publishingState.toLowerCase() !== 'published') {
    return {
      appId,
      createdAssignments: 0,
      publishingState: publishResult.publishingState,
      pending: true
    };
  }

  let createdAssignments = 0;
  for (const target of targets) {
    await createAssignment(accessToken, appId, {
      groupId: target.groupId,
      installIntent
    });
    createdAssignments += 1;
  }

  return {
    appId,
    createdAssignments,
    publishingState: publishResult.publishingState,
    pending: false
  };
}

async function getLiveAssignments(accessToken: string, appId: string) {
  const assignments = await graphList(accessToken, `/v1.0/deviceAppManagement/mobileApps/${appId}/assignments`);
  return assignments.map(mapAssignmentRow);
}

async function getLiveAppDetails(accessToken: string, appId: string, fallbackName = '') {
  const app = await graphRequest<Record<string, unknown>>(accessToken, `/v1.0/deviceAppManagement/mobileApps/${appId}`);
  const assignments = await graphList(accessToken, `/v1.0/deviceAppManagement/mobileApps/${appId}/assignments`);
  const platform = normalizeGraphPlatform(String(app['@odata.type'] ?? app.platform ?? ''));
  const assignmentTargets = assignments.map((assignment) => summarizeAssignmentTarget((assignment.target ?? {}) as Record<string, unknown>));
  const installIntentSummary = assignments.map((assignment) => String(assignment.intent ?? 'unknown')).join(', ');

  return {
    id: String(app.id ?? appId),
    name: String((app.displayName ?? fallbackName) || appId),
    publisher: String(app.publisher ?? ''),
    platform,
    rawType: String(app['@odata.type'] ?? ''),
    description: String(app.description ?? ''),
    developer: String(app.developer ?? ''),
    owner: String(app.owner ?? ''),
    notes: String(app.notes ?? ''),
    informationUrl: String(app.informationUrl ?? ''),
    privacyInformationUrl: String(app.privacyInformationUrl ?? ''),
    isAssigned: Boolean(app.isAssigned ?? assignments.length > 0),
    createdDateTime: String(app.createdDateTime ?? ''),
    lastModifiedDateTime: String(app.lastModifiedDateTime ?? ''),
    publishingState: String(app.publishingState ?? 'unknown'),
    packageIdentifier: String(app.packageIdentifier ?? ''),
    assignmentCount: assignments.length,
    assignmentTargets,
    installIntentSummary,
    assignments
  };
}

function buildDashboard(data: Awaited<ReturnType<typeof getViewData>>): DashboardData & Record<string, unknown> {
  const failed = (data.statuses as any[]).filter((row) => String(row.installState ?? '').toLowerCase().includes('fail'));
  const healthy = (data.statuses as any[]).filter((row) => !String(row.installState ?? '').toLowerCase().includes('fail'));

  const appCounts = new Map<string, number>();
  const categoryCounts = new Map<string, number>();
  const targetCounts = new Map<string, Set<string>>();
  const recommendedActions = new Map<string, number>();
  const assignmentScopeCounts = new Map<string, number>();

  for (const row of failed) {
    appCounts.set(row.appName, (appCounts.get(row.appName) ?? 0) + 1);
    categoryCounts.set(row.normalizedCategory, (categoryCounts.get(row.normalizedCategory) ?? 0) + 1);
    if (!targetCounts.has(row.appName)) targetCounts.set(row.appName, new Set());
    targetCounts.get(row.appName)!.add(String(row.targetName ?? row.targetId ?? 'unknown'));
    const firstAction = Array.isArray(row.recommendedActions) ? String(row.recommendedActions[0] ?? '').trim() : '';
    if (firstAction) recommendedActions.set(firstAction, (recommendedActions.get(firstAction) ?? 0) + 1);
    assignmentScopeCounts.set(String(row.targetType ?? 'unknown'), (assignmentScopeCounts.get(String(row.targetType ?? 'unknown')) ?? 0) + 1);
  }

  const totalStatuses = (data.statuses as any[]).length || 1;
  const successRate = Math.round((healthy.length / totalStatuses) * 100);
  const impactedEndpoints = new Set(failed.map((row) => String(row.targetName ?? row.targetId ?? 'unknown'))).size;
  const affectedApps = appCounts.size;
  const appsNeedingAttention = Array.from(appCounts.entries())
    .map(([name, count]) => ({ name, count, impacted: targetCounts.get(name)?.size ?? count }))
    .sort((a, b) => b.impacted - a.impacted || b.count - a.count)
    .slice(0, 5);
  const remediationQueue = Array.from(recommendedActions.entries())
    .map(([action, count]) => ({ action, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    totalDevices: data.devices.length,
    totalApps: data.apps.length,
    totalUsers: data.users.length,
    failedStatuses: failed.length,
    topFailingApps: Array.from(appCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
    topCategories: Array.from(categoryCounts.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
    lastRefresh: new Date().toISOString(),
    smartSummary: buildSmartSummary(data.statuses as any),
    insights: buildInsights(data.statuses as any),
    impactedEndpoints,
    affectedApps,
    successRate,
    remediationQueue,
    appsNeedingAttention,
    assignmentRisk: Array.from(assignmentScopeCounts.entries()).map(([scope, count]) => ({ scope, count })),
    managementNarrative: failed.length
      ? `${failed.length} failing app signals are currently affecting ${impactedEndpoints} endpoints across ${affectedApps} apps.`
      : 'No active failing app signals were detected in the current data window.',
    valueProof: {
      unresolvedRemainder: failed.length,
      improvedCountEstimate: healthy.length,
      verificationConfidence: failed.length ? Math.max(45, Math.min(92, successRate)) : 98
    },
    recommendedActions: remediationQueue.map((item) => item.action)
  };
}

function buildFailureClusters(statuses: any[]) {
  const clusters = new Map<string, any>();
  for (const row of statuses) {
    const key = [row.appName, row.normalizedCategory || 'Unknown', row.errorCode || 'Unknown'].join('::');
    if (!clusters.has(key)) {
      clusters.set(key, {
        id: key,
        appName: row.appName,
        normalizedCategory: row.normalizedCategory || 'Unknown',
        errorCode: row.errorCode || 'Unknown',
        occurrences: 0,
        impactedTargets: new Set<string>(),
        targetTypes: new Set<string>(),
        recommendedActions: new Set<string>(),
        latest: row.lastReportedDateTime || ''
      });
    }
    const cluster = clusters.get(key);
    cluster.occurrences += 1;
    cluster.impactedTargets.add(String(row.targetName ?? row.targetId ?? 'unknown'));
    cluster.targetTypes.add(String(row.targetType ?? 'unknown'));
    for (const action of Array.isArray(row.recommendedActions) ? row.recommendedActions : []) {
      if (action) cluster.recommendedActions.add(String(action));
    }
    if (String(row.lastReportedDateTime ?? '') > cluster.latest) cluster.latest = String(row.lastReportedDateTime ?? '');
  }
  return Array.from(clusters.values())
    .map((cluster) => ({
      id: cluster.id,
      appName: cluster.appName,
      normalizedCategory: cluster.normalizedCategory,
      errorCode: cluster.errorCode,
      occurrences: cluster.occurrences,
      impactedTargets: cluster.impactedTargets.size,
      targetTypes: Array.from(cluster.targetTypes),
      recommendedActions: Array.from(cluster.recommendedActions).slice(0, 3),
      latest: cluster.latest
    }))
    .sort((a, b) => b.occurrences - a.occurrences || b.impactedTargets - a.impactedTargets);
}

function buildAppAudit(appId: string, data: Awaited<ReturnType<typeof getViewData>>) {
  const app = data.apps.find((candidate) => candidate.id === appId);
  const statuses = (data.statuses as any[]).filter((row) => row.appId === appId);
  const failures = statuses.filter((row) => String(row.installState ?? '').toLowerCase().includes('fail'));
  const clusters = buildFailureClusters(failures);
  const affectedUsers = new Set(failures.filter((row) => String(row.targetType ?? '') === 'user').map((row) => String(row.targetName ?? row.targetId ?? 'unknown'))).size;
  const affectedDevices = new Set(failures.filter((row) => String(row.targetType ?? '') !== 'user').map((row) => String(row.targetName ?? row.targetId ?? 'unknown'))).size;
  const totalTargets = new Set(statuses.map((row) => String(row.targetName ?? row.targetId ?? 'unknown'))).size || 1;
  const successRate = Math.max(0, Math.round(((totalTargets - new Set(failures.map((row) => String(row.targetName ?? row.targetId ?? 'unknown'))).size) / totalTargets) * 100));
  const topFailureReasons = clusters.slice(0, 3).map((cluster) => `${cluster.normalizedCategory} · ${cluster.errorCode}`);
  const playbooks = clusters.flatMap((cluster) => cluster.recommendedActions).filter(Boolean).slice(0, 5);
  const verificationConfidence = failures.length ? Math.max(35, Math.min(93, successRate + 10)) : 98;
  const migrationCandidate = Boolean(app && String(app.platform ?? '').toLowerCase().includes('windows') && !String((app as any).packageIdentifier ?? '').trim());

  return {
    appId,
    appName: app?.displayName ?? 'Unknown app',
    successRate,
    impactedUsers: affectedUsers,
    impactedDevices: affectedDevices,
    unresolvedRemainder: failures.length,
    verificationConfidence,
    healthTrend: failures.length ? 'Needs attention' : 'Stable',
    topFailureReasons,
    clusters,
    smartPlaybooks: playbooks,
    rolloutSafety: {
      riskLevel: failures.length > 10 ? 'High' : failures.length > 3 ? 'Medium' : 'Low',
      pilotRecommendation: failures.length > 0 ? 'Start with a pilot ring before broad remediation.' : 'Safe for wider rollout validation.',
      rollbackNote: 'Keep the current assignment path available until post-fix verification reaches the target confidence.',
      affectedGroupsPreview: Array.from(new Set(failures.map((row) => `${row.targetType}:${row.targetName}`))).slice(0, 5)
    },
    verification: {
      improvedDeviceCount: Math.max(0, totalTargets - failures.length),
      unresolvedRemainder: failures.length,
      confidenceScore: verificationConfidence
    },
    migration: {
      isCandidate: migrationCandidate,
      recommendation: migrationCandidate ? 'Candidate for WinGet modernization workflow.' : 'Keep under current deployment model until stability improves.',
      mappingStatus: migrationCandidate ? 'Needs mapping' : 'Mapped or not applicable'
    },
    managementNarrative: failures.length
      ? `${app?.displayName ?? 'This app'} is impacting ${affectedUsers + affectedDevices} endpoints with ${clusters.length} recurring failure patterns.`
      : `${app?.displayName ?? 'This app'} currently shows no active failure clusters.`
  };
}

function buildWinGetMigrationCandidates(data: Awaited<ReturnType<typeof getViewData>>) {
  const appsGrid = buildAppsGrid(data) as any[];
  return appsGrid
    .filter((row) => String(row.platform ?? '').toLowerCase().includes('windows'))
    .map((row) => ({
      id: row.id,
      name: row.name,
      publisher: row.publisher,
      failed: row.failed,
      statuses: row.statuses,
      readinessScore: Math.max(30, 100 - (Number(row.failed ?? 0) * 7)),
      migrationPriority: Number(row.failed ?? 0) > 5 ? 'High' : Number(row.failed ?? 0) > 0 ? 'Medium' : 'Low',
      recommendation: Number(row.failed ?? 0) > 0
        ? 'Map this app to WinGet, pilot a replacement, and verify install success before broad rollout.'
        : 'Good candidate for WinGet standardization with low current risk.'
    }))
    .sort((a, b) => Number(b.failed) - Number(a.failed) || a.name.localeCompare(b.name))
    .slice(0, 12);
}

function inferAppMetadata(app: any, statusCount: number, failedCount: number) {
  const platform = String(app.platform ?? '').toLowerCase();
  const name = String(app.displayName ?? '').toLowerCase();

  let deploymentType = 'Store app';
  if (platform.includes('windows')) deploymentType = name.includes('portal') ? 'Microsoft Store' : 'Win32';
  if (platform.includes('mac')) deploymentType = 'macOS PKG';
  if (platform.includes('ios')) deploymentType = 'iOS store app';
  if (platform.includes('android') || platform.includes('mobile')) deploymentType = 'Mobile line-of-business';
  if (name.includes('msi')) deploymentType = 'MSI';

  return {
    deploymentType,
    installContext: platform.includes('windows') ? 'System' : 'User',
    assignmentScope: failedCount > 0 ? 'Required' : 'Available',
    architecture: platform.includes('windows') ? 'x64' : platform.includes('mac') ? 'Universal' : 'Mixed',
    packageIdentifier: `pkg.${String(app.id ?? 'unknown').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}`,
    wingetId: platform.includes('windows') ? `${String(app.publisher ?? 'Vendor').replace(/[^a-zA-Z0-9]+/g, '')}.${String(app.displayName ?? 'App').replace(/[^a-zA-Z0-9]+/g, '')}` : '',
    uninstallCommand: platform.includes('windows')
      ? `winget uninstall --id ${String(app.publisher ?? 'Vendor').replace(/[^a-zA-Z0-9]+/g, '')}.${String(app.displayName ?? 'App').replace(/[^a-zA-Z0-9]+/g, '')} --silent`
      : 'Managed uninstall through Intune assignment removal',
    targetCount: statusCount,
    healthState: failedCount > 0 ? 'Needs attention' : 'Healthy'
  };
}

function buildAppsGrid(data: Awaited<ReturnType<typeof getViewData>>) {
  return data.apps.map((app) => {
    const statuses = (data.statuses as any[]).filter((status) => status.appId === app.id);
    const failedCount = statuses.filter((status) => String(status.installState ?? '').includes('fail')).length;
    const inferred = inferAppMetadata(app, statuses.length, failedCount);

    return {
      id: app.id,
      name: app.displayName,
      publisher: app.publisher,
      platform: app.platform,
      statuses: statuses.length,
      failed: failedCount,
      lastModifiedDateTime: app.lastModifiedDateTime,
      ...inferred,
      details: `App: ${app.displayName}\nPublisher: ${app.publisher}\nPlatform: ${app.platform}\nStatuses: ${statuses.length}\nFailed: ${failedCount}`
    };
  });
}

function buildUsersGrid(data: Awaited<ReturnType<typeof getViewData>>) {
  return data.users.map((user) => {
    const mappedDevices = data.devices.filter(
      (device) => (device.userPrincipalName ?? '').toLowerCase() === user.userPrincipalName.toLowerCase()
    );

    return {
      id: user.id,
      displayName: user.displayName,
      userPrincipalName: user.userPrincipalName,
      mail: user.mail,
      managedDevices: mappedDevices.length,
      details: `User: ${user.displayName}\nUPN: ${user.userPrincipalName}\nManaged devices: ${mappedDevices.length}`
    };
  });
}

function buildDevicesGrid(data: Awaited<ReturnType<typeof getViewData>>) {
  return data.devices.map((device) => ({
    id: device.id,
    deviceName: device.deviceName,
    operatingSystem: device.operatingSystem,
    osVersion: device.osVersion,
    complianceState: device.complianceState,
    lastSyncDateTime: device.lastSyncDateTime,
    userPrincipalName: device.userPrincipalName,
    details: `Device: ${device.deviceName}\nOS: ${device.operatingSystem} ${device.osVersion}\nCompliance: ${device.complianceState}\nLast Sync: ${device.lastSyncDateTime}`
  }));
}

function buildStatusesGrid(data: Awaited<ReturnType<typeof getViewData>>) {
  return (data.statuses as any[]).map((row) => {
    const playbooks = recommendPlaybooks({
      errorCode: row.errorCode,
      errorFamily: row.errorFamily,
      normalizedCategory: row.normalizedCategory
    });

    return {
      id: row.id,
      appName: row.appName,
      targetType: row.targetType,
      targetName: row.targetName,
      installState: row.installState,
      errorCode: row.errorCode || 'Unknown',
      errorDescription: row.errorDescription || 'Unknown',
      normalizedCategory: row.normalizedCategory || 'Unknown',
      confidence: row.confidence,
      lastReportedDateTime: row.lastReportedDateTime,
      recommendedActions: row.recommendedActions,

      errorFamily: row.errorFamily || 'Unknown',
      signatureKey: row.signatureKey || '',
      signatureHash: row.signatureHash || '',

      playbooks,

      details:
        `App: ${row.appName}\n` +
        `State: ${row.installState}\n` +
        `ErrorCode: ${row.errorCode || 'Unknown'}\n` +
        `ErrorDescription: ${row.errorDescription || 'Unknown'}\n` +
        `Category: ${row.normalizedCategory || 'Unknown'}\n` +
        `Family: ${row.errorFamily || 'Unknown'}\n` +
        `Signature: ${row.signatureHash || ''}`
    };
  });
}

function buildOcrGrid(data: Awaited<ReturnType<typeof getViewData>>) {
  const rows = (data.statuses as any[]).map((row) => ({
    id: row.id,
    appName: row.appName,
    targetName: row.targetName,
    normalizedCategory: row.normalizedCategory || 'Unknown',
    confidence: row.confidence,
    errorCode: row.errorCode || 'Unknown',
    errorDescription: row.errorDescription || 'Unknown',
    cause: row.cause || 'Unknown',
    recommendedActions: Array.isArray(row.recommendedActions) ? row.recommendedActions.join(' | ') : '',
    details: `App: ${row.appName}\nTarget: ${row.targetName}\nCategory: ${row.normalizedCategory || 'Unknown'}\nCause: ${row.cause || 'Unknown'}\nConfidence: ${row.confidence}`
  }));

  if (rows.length > 0) return rows;

  const deviceFallback = data.devices
    .filter((device) => (device.deviceName ?? '').trim().length > 0)
    .slice(0, 200)
    .map((device) => {
      const compliance = (device.complianceState ?? 'unknown').toLowerCase();
      const isHealthy = compliance === 'compliant';
      const category = isHealthy ? 'DeviceHealth' : 'ComplianceRisk';
      const cause = isHealthy
        ? 'Device is reporting compliant state; app-level telemetry is not currently available.'
        : `Device reports ${device.complianceState} compliance state.`;

      return {
        id: `device-ocr:${device.id}`,
        appName: 'Device Compliance Baseline',
        targetName: device.deviceName,
        normalizedCategory: category,
        confidence: isHealthy ? 0.45 : 0.7,
        errorCode: isHealthy ? '-' : 'DEVICE_NONCOMPLIANT',
        errorDescription: isHealthy ? 'Compliant device baseline signal.' : 'Non-compliant device signal from managedDevices.',
        cause,
        recommendedActions: isHealthy
          ? 'Assign at least one required app and wait for Intune status telemetry to populate OCR app analysis.'
          : 'Open device in Intune and review compliance policies, app assignment state, and recent check-in.',
        details: `Device: ${device.deviceName}\nCompliance: ${device.complianceState}\nOS: ${device.operatingSystem} ${device.osVersion}\nLast Sync: ${device.lastSyncDateTime}`
      };
    });

  if (deviceFallback.length > 0) return deviceFallback;

  return [
    {
      id: 'ocr-empty',
      appName: 'No OCR telemetry yet',
      targetName: '-',
      normalizedCategory: 'DataUnavailable',
      confidence: 0,
      errorCode: '-',
      errorDescription: 'No app installation status rows were returned from Graph.',
      cause: 'Either there are currently no app status events, or delegated permissions are not sufficient.',
      recommendedActions: 'Grant admin consent for DeviceManagementApps.Read.All and refresh again.',
      details: 'OCR needs app status telemetry. Verify Microsoft Graph delegated permissions and Intune app assignment/status availability.'
    }
  ];
}

export const apiRouter = Router();

const DEFAULT_MCP_PROTO = '2025-11-25';

// ✅ Shared tool input schema — includes $schema required by OpenAI scanner
const MCP_TOOL_INPUT_SCHEMA = {
  type: 'object',
  $schema: 'http://json-schema.org/draft-07/schema#',
  additionalProperties: true,
  properties: {
    signature: { type: 'string' },
    view: { type: 'string' },
    row: { type: 'object' }
  },
  required: ['signature', 'row']
};

// ✅ health must be before ensureConnected
apiRouter.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true, mockMode: config.mockMode, now: new Date().toISOString() });
});

/**
 * ✅ MCP GET — returns JSON server metadata (required by OpenAI scanner)
 * Served at: https://api.modernendpoint.tech/api/mcp
 *
 * FIX: Was returning text/plain "OK" — OpenAI scanner expects JSON with server info.
 * FIX: Added WWW-Authenticate header to signal no-auth mode to scanner.
 */
apiRouter.get('/mcp', (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('mcp-protocol-version', DEFAULT_MCP_PROTO);
  // Signals to OpenAI scanner that no auth is required
  res.setHeader('WWW-Authenticate', 'Bearer realm="no-auth"');
  res.json({
    name: 'modernendpoint-mcp',
    version: '1.0.0',
    protocolVersion: DEFAULT_MCP_PROTO
  });
});

apiRouter.options('/mcp', (_req: Request, res: Response) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('mcp-protocol-version', DEFAULT_MCP_PROTO);
  res.status(204).send('');
});

/**
 * ✅ MCP POST — handles all JSON-RPC 2.0 MCP messages
 *
 * FIX: Added `instructions` field to `initialize` result (required by OpenAI scanner).
 * FIX: Tool inputSchema now includes `$schema` for strict JSON Schema validation.
 */
apiRouter.post('/mcp', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');

  // OpenAI sometimes sends protocol version in header
  const headerProto = String(req.header('mcp-protocol-version') ?? '').trim();
  const effectiveProto = headerProto || DEFAULT_MCP_PROTO;
  res.setHeader('mcp-protocol-version', effectiveProto);

  const msg = req.body as any;
  const requests = Array.isArray(msg) ? msg : [msg];
  const responses: any[] = [];

  for (const r of requests) {
    const id = r?.id;
    const method = String(r?.method ?? '');
    const params = r?.params ?? {};
    const isNotification = id === null || id === undefined;

    if (method === 'initialized') continue;

    if (method === 'ping') {
      if (!isNotification) responses.push({ jsonrpc: '2.0', id, result: {} });
      continue;
    }

    if (method === 'initialize') {
      const clientProto = String(params?.protocolVersion ?? effectiveProto ?? DEFAULT_MCP_PROTO);

      if (!isNotification) {
        responses.push({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: clientProto,
            // FIX: `instructions` field required by OpenAI scanner
            instructions: 'Use intune.explain to analyze Intune rows, intune.runbook to generate remediation runbooks, or intune.exec_summary for executive summaries.',
            capabilities: {
              tools: { listChanged: false },
              resources: {},
              prompts: {},
              logging: {}
            },
            serverInfo: { name: 'modernendpoint-mcp', version: '1.0.0' }
          }
        });
      }
      continue;
    }

    if (method === 'methods/list') {
      if (!isNotification) {
        responses.push({
          jsonrpc: '2.0',
          id,
          result: {
            methods: [
              'initialize',
              'tools/list',
              'tools/call',
              'resources/list',
              'prompts/list',
              'logging/setLevel',
              'ping'
            ]
          }
        });
      }
      continue;
    }

    if (method === 'tools/list') {
      const tools = [
        {
          name: 'intune_explain',
          description: 'Explain selected Intune row: meaning, likely causes, and checks.',
          inputSchema: {
            type: 'object',
            additionalProperties: true,
            properties: { signature: { type: 'string' }, view: { type: 'string' }, row: { type: 'object' } },
            required: ['signature', 'row']
          },
          annotations: {
            readOnlyHint: true,
            openWorldHint: true,
            destructiveHint: false
          }
        },
        {
          name: 'intune_runbook',
          description: 'Generate a step-by-step runbook with commands and validations.',
          inputSchema: {
            type: 'object',
            additionalProperties: true,
            properties: { signature: { type: 'string' }, view: { type: 'string' }, row: { type: 'object' } },
            required: ['signature', 'row']
          },
          annotations: {
            readOnlyHint: true,
            openWorldHint: true,
            destructiveHint: false
          }
        },
        {
          name: 'intune_exec_summary',
          description: 'Generate an executive summary for dashboards.',
          inputSchema: {
            type: 'object',
            additionalProperties: true,
            properties: { signature: { type: 'string' }, view: { type: 'string' }, row: { type: 'object' } },
            required: ['signature', 'row']
          },
          annotations: {
            readOnlyHint: true,
            openWorldHint: true,
            destructiveHint: false
          }
        }
      ];

      if (!isNotification) responses.push({ jsonrpc: '2.0', id, result: { tools } });
      continue;
    }

    if (method === 'resources/list') {
      if (!isNotification) responses.push({ jsonrpc: '2.0', id, result: { resources: [] } });
      continue;
    }

    if (method === 'prompts/list') {
      if (!isNotification) responses.push({ jsonrpc: '2.0', id, result: { prompts: [] } });
      continue;
    }

    if (method === 'logging/setLevel') {
      if (!isNotification) responses.push({ jsonrpc: '2.0', id, result: {} });
      continue;
    }

    if (method === 'tools/call') {
      const toolName = String(params?.name ?? 'unknown');
      if (!isNotification) {
        responses.push({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: `Tool call received: ${toolName}` }],
            isError: false
          }
        });
      }
      continue;
    }

    if (!isNotification) {
      responses.push({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` }
      });
    }
  }

  if (!Array.isArray(msg)) return res.status(200).send(responses[0] ?? { jsonrpc: '2.0', id: null, result: {} });
  return res.status(200).send(responses);
});

apiRouter.get('/mcp/.well-known/openid-configuration', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ issuer: 'https://api.modernendpoint.tech' });
});

apiRouter.get('/mcp/.well-known/oauth-authorization-server', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ issuer: 'https://api.modernendpoint.tech' });
});

// ✅ Everything below requires auth session
apiRouter.use(ensureConnected);

// ✅ Intune AI (in-app) — requires auth session
apiRouter.post('/ai/intune', postIntuneAi);

apiRouter.get('/refresh', async (req: Request, res: Response) => {
  try {
    const data = await getViewData((req as any).session.accessToken);
    const dashboard = buildDashboard(data);
    res.json({
      message: 'Refresh completed.',
      dashboard,
      counts: {
        devices: data.devices.length,
        apps: data.apps.length,
        users: data.users.length,
        incidents: data.incidents.length
      }
    });
  } catch (error) {
    if (error instanceof Error) {
      res.status(500).json({
        message: error.message,
        stack: error.stack,
        name: error.name,
        ...Object.getOwnPropertyNames(error).reduce((acc, key) => {
          (acc as any)[key] = (error as any)[key];
          return acc;
        }, {} as Record<string, any>)
      });
    } else {
      res.status(500).json({ message: 'Refresh failed.', error });
    }
  }
});

apiRouter.get('/view/:view', async (req: Request, res: Response) => {
  try {
    const view = String(req.params.view).toLowerCase() as ViewName;
    const data = await getViewData((req as any).session.accessToken);

    const intuneViews = ['dashboard', 'devices', 'apps', 'users', 'ocr', 'incidents'];
    const hasIntuneData = Boolean((data.apps?.length || data.devices?.length || (data.statuses as any[])?.length));
    if (intuneViews.includes(view) && !hasIntuneData) {
      return res.json({
        rows: [],
        message: 'Intune data is not available for this tenant. This view is hidden for unsupported tenants.'
      });
    }

    if (view === 'dashboard') return res.json({ rows: [buildDashboard(data)], message: 'Dashboard loaded.' });
    if (view === 'devices') return res.json({ rows: buildDevicesGrid(data), message: 'Devices loaded.' });
    if (view === 'apps') return res.json({ rows: buildAppsGrid(data), message: 'Apps loaded.' });

    if (view === 'users') {
      const rows = buildUsersGrid(data);
      const directUsers = new Set(
        (data.users ?? [])
          .filter((user) => !user.id.startsWith('device:') && !user.id.startsWith('status:'))
          .map((user) => user.userPrincipalName.toLowerCase())
      );

      const message = rows.length
        ? directUsers.size <= 1 && rows.length > 1
          ? 'Users loaded. Directory listing is limited; additional users were inferred from managed devices and app statuses.'
          : directUsers.size <= 1
            ? 'Users loaded, but directory scope appears limited. Add delegated permission User.ReadBasic.All (or Directory.Read.All) and grant admin consent to list all tenant users.'
            : 'Users loaded.'
        : 'No users returned by endpoint.';

      return res.json({ rows, message });
    }

    if (view === 'ocr') {
      const rows = buildOcrGrid(data);
      const message = (data.statuses as any[]).length
        ? 'OCR analysis loaded.'
        : data.devices.length
          ? 'OCR loaded from device compliance baseline because app install status telemetry is empty.'
          : 'OCR loaded with diagnostics only. No app status telemetry returned; check Graph delegated permissions and Intune app status availability.';
      return res.json({ rows, message });
    }

    if (view === 'incidents') {
      return res.json({
        rows: data.incidents,
        message: (data.incidents as any[])[0]?.isPlaceholder ? 'No active incidents in current window.' : 'Incidents loaded.'
      });
    }
    return res.status(400).json({ message: `Unsupported view: ${view}` });
  } catch (error) {
    const intuneViews = ['dashboard', 'devices', 'apps', 'users', 'ocr', 'incidents'];
    const view = String(req.params.view).toLowerCase();
    const isIntuneView = intuneViews.includes(view);

    const is403 = Boolean(
      error &&
        typeof error === 'object' &&
        (('status' in error && (error as any).status === 403) ||
          ('message' in error &&
            typeof (error as any).message === 'string' &&
            (((error as any).message.includes('403')) || ((error as any).message.toLowerCase().includes('access denied')))))
    );

    if (isIntuneView && is403) {
      return res.json({
        rows: [],
        message: 'Intune data is not available for this tenant or user. This view is hidden for unsupported tenants. (403: Access Denied)'
      });
    }

    if (error instanceof Error) {
      res.status(500).json({
        message: error.message,
        stack: error.stack,
        name: error.name,
        ...Object.getOwnPropertyNames(error).reduce((acc, key) => {
          (acc as any)[key] = (error as any)[key];
          return acc;
        }, {} as Record<string, any>)
      });
    } else {
      res.status(500).json({ message: 'Failed to load view.', error });
    }
  }
});

apiRouter.get('/app-statuses', async (req: Request, res: Response) => {
  try {
    const data = await getViewData((req as any).session.accessToken);
    res.json({ rows: buildStatusesGrid(data), message: 'App statuses loaded.' });
  } catch (error) {
    res.status(500).json({ message: error instanceof Error ? error.message : 'Failed to load app statuses.' });
  }
});

apiRouter.get('/incidents/recent', async (_req: Request, res: Response) => {
  try {
    const rows = await incidentRepo.listRecent(50);
    res.json({ rows, message: 'Recent incidents loaded.' });
  } catch {
    res.json({ rows: [], message: 'Recent incidents unavailable.' });
  }
});

apiRouter.post('/runbook', async (req: Request, res: Response) => {
  const row = req.body as { installState?: string; recommendedActions?: string[]; normalizedCategory?: string } | undefined;
  const actions = Array.isArray(row?.recommendedActions) ? row?.recommendedActions : [];

  if ((row?.installState ?? '').toLowerCase().includes('fail') && actions.length > 0) {
    const runbook = actions.map((action, index) => `${index + 1}. ${action}`).join('\n');
    return res.json({ runbook });
  }

  return res.json({
    runbook:
      '1. Validate user licensing and MDM scope.\n' +
      '2. Re-check network/proxy/TLS path.\n' +
      '3. Inspect Intune + Entra logs around the timestamp.'
  });
});

apiRouter.post('/ocr/explain', async (req: Request, res: Response) => {
  try {
    const input = typeof (req as any).body?.text === 'string' ? String((req as any).body.text).trim() : '';
    if (!input) return res.status(400).json({ message: 'Provide OCR/manual text before analysis.' });

    const syntheticRow = {
      id: 'manual-ocr-input',
      appId: 'manual',
      appName: 'Manual OCR Input',
      targetType: 'device' as const,
      targetId: 'manual',
      targetName: 'Manual',
      installState: 'failed',
      errorCode: input,
      errorDescription: input,
      lastReportedDateTime: new Date().toISOString(),
      normalizedCategory: 'Unknown',
      cause: 'Unknown',
      confidence: 0,
      recommendedActions: []
    };

    const explanation = await normalizeStatus(syntheticRow as any);
    return res.json({
      category: explanation.normalizedCategory,
      confidence: explanation.confidence,
      cause: explanation.cause,
      recommendedActions: explanation.recommendedActions,
      evidence: explanation.evidence
    });
  } catch (error) {
    return res.status(500).json({ message: error instanceof Error ? error.message : 'OCR explanation failed.' });
  }
});

apiRouter.get('/apps/:id/details', async (req: Request, res: Response) => {
  const appId = String(req.params.id ?? '').trim();
  const accessToken = (req as any).session?.accessToken as string | undefined;

  if (!appId) return res.status(400).json({ message: 'Missing app ID.' });

  try {
    const data = await getViewData(accessToken);
    const app = data.apps.find((candidate) => candidate.id === appId);
    const statusRows = (data.statuses as any[]).filter((status) => status.appId === appId);
    const failedCount = statusRows.filter((status) => String(status.installState ?? '').toLowerCase().includes('fail')).length;

    if (config.mockMode || !accessToken) {
      if (!app) return res.status(404).json({ message: 'App not found.' });
      return res.json({
        id: app.id,
        name: app.displayName,
        publisher: app.publisher,
        platform: app.platform,
        assignmentCount: statusRows.length,
        assignmentTargets: [],
        installIntentSummary: failedCount > 0 ? 'required' : 'available',
        ...inferAppMetadata(app, statusRows.length, failedCount),
        details: `App: ${app.displayName}\nPublisher: ${app.publisher}\nPlatform: ${app.platform}`
      });
    }

    const live = await getLiveAppDetails(accessToken, appId, app?.displayName ?? '');
    return res.json({
      ...inferAppMetadata(app ?? live, statusRows.length || live.assignmentCount, failedCount),
      ...live
    });
  } catch (error) {
    return res.status(500).json({ message: error instanceof Error ? error.message : 'Failed to load app details.' });
  }
});

apiRouter.get('/apps/:id/assignments', async (req: Request, res: Response) => {
  const appId = String(req.params.id ?? '').trim();
  const accessToken = (req as any).session?.accessToken as string | undefined;

  if (!appId) return res.status(400).json({ rows: [], message: 'Missing app ID.' });

  try {
    if (config.mockMode || !accessToken) {
      return res.json({
        rows: [
          { id: 'mock-required', intent: 'required', targetType: 'group', targetName: 'Pilot Devices', groupId: 'mock-pilot', filterInfo: '' },
          { id: 'mock-available', intent: 'available', targetType: 'group', targetName: 'IT Users', groupId: 'mock-it', filterInfo: '' }
        ],
        message: 'Assignments loaded in mock mode.'
      });
    }

    const rows = await getLiveAssignments(accessToken, appId);
    return res.json({ rows, message: rows.length ? 'Assignments loaded.' : 'No assignments found for this app.' });
  } catch (error) {
    return res.status(500).json({ rows: [], message: error instanceof Error ? error.message : 'Failed to load assignments.' });
  }
});

apiRouter.post('/apps/:id/uninstall', async (req: Request, res: Response) => {
  const appId = String(req.params.id ?? '').trim();
  const appName = String(req.body?.name ?? '').trim();
  const assignmentIds = Array.isArray(req.body?.assignmentIds) ? req.body.assignmentIds.map((x: unknown) => String(x ?? '').trim()).filter(Boolean) : [];
  const accessToken = (req as any).session?.accessToken as string | undefined;

  if (!appId) {
    return res.status(400).json({ ok: false, message: 'Missing app ID.' });
  }

  if (assignmentIds.length === 0) {
    return res.status(400).json({ ok: false, message: 'Choose at least one existing assignment before uninstall.' });
  }

  if (config.mockMode) {
    return res.json({
      ok: true,
      mode: 'mock',
      appId,
      message: `Mock uninstall queued for ${assignmentIds.length} assignment(s) on ${appName || appId}.`,
      note: 'No live tenant change was made. This is a mock-mode simulation.'
    });
  }

  if (!accessToken) {
    return res.status(401).json({ ok: false, message: 'Not connected. Sign in before requesting uninstall.' });
  }

  try {
    const assignments = await graphList(accessToken, `/v1.0/deviceAppManagement/mobileApps/${appId}/assignments`);
    const selectedAssignments = assignments.filter((assignment) => assignmentIds.includes(String(assignment.id ?? '').trim()));

    if (selectedAssignments.length === 0) {
      return res.status(400).json({ ok: false, mode: 'live', message: 'The selected assignments were not found on the app.' });
    }

    for (const assignment of selectedAssignments) {
      const assignmentId = String(assignment.id ?? '').trim();
      await graphRequest<Record<string, unknown>>(
        accessToken,
        `/v1.0/deviceAppManagement/mobileApps/${appId}/assignments/${assignmentId}`,
        { method: 'PATCH', body: sanitizeAssignmentPayload(assignment, 'uninstall') }
      );
    }

    return res.json({
      ok: true,
      mode: 'live',
      appId,
      updatedAssignments: selectedAssignments.length,
      message: `Uninstall intent was applied to ${selectedAssignments.length} assignment(s) for ${appName || appId}.`
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Live uninstall failed.';
    return res.status(500).json({
      ok: false,
      mode: 'live',
      message
    });
  }
});


apiRouter.get('/platform/readiness', async (req: Request, res: Response) => {
  const accessToken = (req as any).session?.accessToken as string | undefined;
  try {
    const readiness = await buildPlatformReadiness(accessToken);
    return res.json(readiness);
  } catch (error) {
    return res.status(500).json({
      connected: Boolean(accessToken),
      mockMode: config.mockMode,
      diagnostics: getTokenDiagnostics(accessToken),
      checks: [],
      groupLookupHint: 'Unable to build readiness status.',
      uninstallHint: 'Unable to build readiness status.',
      message: error instanceof Error ? error.message : 'Readiness check failed.'
    });
  }
});

apiRouter.get('/groups/search', async (req: Request, res: Response) => {
  const query = String(req.query.q ?? '').trim();
  const accessToken = (req as any).session?.accessToken as string | undefined;

  if (!query) return res.json({ rows: [], message: 'Enter at least one character.' });

  try {
    if (config.mockMode || !accessToken) {
      return res.json({
        rows: [
          { id: 'group-pilot', displayName: 'Pilot Devices', description: 'Mock devices group' },
          { id: 'group-users', displayName: 'IT Users', description: 'Mock users group' }
        ].filter((row) => row.displayName.toLowerCase().includes(query.toLowerCase())),
        message: 'Mock group results loaded.'
      });
    }

    const rows = await searchLiveGroups(accessToken, query);
    const readiness = await buildPlatformReadiness(accessToken);
    const message = rows.length
      ? 'Groups loaded.'
      : readiness.checks.find((item) => item.id === 'groups-read')?.ok
        ? 'No matching groups found. Paste a group object ID if needed.'
        : 'Group search is blocked. Add Group.Read.All or Directory.Read.All, grant admin consent, and sign in again.';
    return res.json({ rows, message, readiness });
  } catch (error) {
    return res.status(500).json({ rows: [], message: error instanceof Error ? error.message : 'Group search failed.' });
  }
});

apiRouter.get('/winget/search', async (req: Request, res: Response) => {
  const query = String(req.query.q ?? '').trim();
  if (!query) return res.json({ rows: [], message: 'Enter a package name or package ID.' });

  try {
    const rows = await searchWingetCatalog(query);
    return res.json({ rows, message: rows.length ? 'WinGet catalog loaded.' : 'No WinGet packages matched your query.' });
  } catch (error) {
    return res.status(500).json({ rows: [], message: error instanceof Error ? error.message : 'WinGet search failed.' });
  }
});

apiRouter.post('/winget/deploy', async (req: Request, res: Response) => {
  const accessToken = (req as any).session?.accessToken as string | undefined;
  const packageIdentifier = String(req.body?.packageIdentifier ?? '').trim();
  const displayName = String(req.body?.displayName ?? packageIdentifier).trim();
  const publisher = String(req.body?.publisher ?? packageIdentifier.split('.')[0] ?? 'Unknown').trim();
  const installIntent = String(req.body?.installIntent ?? 'required').trim() === 'available' ? 'available' : 'required';
  const runAsAccount = String(req.body?.runAsAccount ?? 'system').trim() === 'user' ? 'user' : 'system';
  const updateMode = String(req.body?.updateMode ?? 'manual').trim() === 'auto' ? 'auto' : 'manual';
  const assignNow = req.body?.assignNow !== false;
  const targets = normalizeWingetTargets(Array.isArray(req.body?.targets) ? req.body.targets : []);
  const icon = normalizeWingetIcon(req.body?.icon);

  if (!packageIdentifier) return res.status(400).json({ ok: false, message: 'Package identifier is required.' });

  if (config.mockMode) {
    return res.json({
      ok: true,
      appId: 'mock-winget-app',
      createdAssignments: assignNow ? targets.length : 0,
      publishingState: 'published',
      message: assignNow && targets.length
        ? `Mock WinGet deployment prepared for ${packageIdentifier} with ${targets.length} assignment(s).`
        : `Mock WinGet app prepared for ${packageIdentifier} without assignments.`
    });
  }

  if (!accessToken) return res.status(401).json({ ok: false, message: 'Not connected. Sign in before creating WinGet apps.' });

  try {
    const app = await createWinGetApp(accessToken, { packageIdentifier, displayName, publisher, runAsAccount, updateMode, icon });
    const appId = String(app.id ?? '').trim();
    if (!appId) return res.status(500).json({ ok: false, message: 'WinGet app creation returned no app ID.' });

    if (!assignNow || !targets.length) {
      const publishResult = await waitForMobileAppPublished(accessToken, appId, { timeoutMs: 45000, intervalMs: 4000 });
      return res.status(publishResult.timedOut ? 202 : 200).json({
        ok: true,
        appId,
        createdAssignments: 0,
        publishingState: publishResult.publishingState,
        message: publishResult.timedOut
          ? `WinGet app ${displayName} was created. Intune is still publishing it, and no assignments were applied yet.`
          : `WinGet app ${displayName} was created${publishResult.publishingState.toLowerCase() === 'published' ? ' and is published' : ''}. No assignments were applied.`
      });
    }

    const assignmentResult = await assignTargetsToPublishedApp(accessToken, appId, targets, installIntent);
    if (assignmentResult.pending) {
      return res.status(202).json({
        ok: true,
        appId,
        createdAssignments: 0,
        publishingState: assignmentResult.publishingState,
        message: `WinGet app ${displayName} was created, but Intune has not finished publishing it yet. Assignments were not applied yet.`
      });
    }

    return res.json({
      ok: true,
      appId,
      createdAssignments: assignmentResult.createdAssignments,
      publishingState: assignmentResult.publishingState,
      message: `WinGet app ${displayName} was created and assigned to ${assignmentResult.createdAssignments} group(s).`
    });
  } catch (error) {
    logger.error({ err: error, packageIdentifier }, 'WinGet deployment failed.');
    return res.status(500).json({ ok: false, message: error instanceof Error ? error.message : 'WinGet deployment failed.' });
  }
});

apiRouter.post('/apps/:id/winget-link', async (req: Request, res: Response) => {
  const sourceAppId = String(req.params.id ?? '').trim();
  const accessToken = (req as any).session?.accessToken as string | undefined;
  const packageIdentifier = String(req.body?.packageIdentifier ?? '').trim();
  const displayName = String(req.body?.displayName ?? packageIdentifier).trim();
  const publisher = String(req.body?.publisher ?? packageIdentifier.split('.')[0] ?? 'Unknown').trim();
  const installIntent = String(req.body?.installIntent ?? 'required').trim() === 'available' ? 'available' : 'required';
  const runAsAccount = String(req.body?.runAsAccount ?? 'system').trim() === 'user' ? 'user' : 'system';
  const updateMode = String(req.body?.updateMode ?? 'manual').trim() === 'auto' ? 'auto' : 'manual';
  const reuseAssignments = Boolean(req.body?.reuseAssignments ?? true);
  const assignNow = req.body?.assignNow !== false;
  const explicitTargets = normalizeWingetTargets(Array.isArray(req.body?.targets) ? req.body.targets : []);
  const icon = normalizeWingetIcon(req.body?.icon);

  if (!sourceAppId || !packageIdentifier) return res.status(400).json({ ok: false, message: 'Source app and package identifier are required.' });

  if (config.mockMode) {
    return res.json({
      ok: true,
      appId: 'mock-winget-linked',
      createdAssignments: assignNow ? (explicitTargets.length || 2) : 0,
      publishingState: 'published',
      message: `Mock replacement WinGet app prepared for ${packageIdentifier}.`
    });
  }

  if (!accessToken) return res.status(401).json({ ok: false, message: 'Not connected. Sign in before creating WinGet replacement apps.' });

  try {
    const app = await createWinGetApp(accessToken, {
      packageIdentifier,
      displayName,
      publisher,
      runAsAccount,
      updateMode,
      notes: `Managed by Modern Endpoint · Replacement candidate for app ${sourceAppId} · Update mode: ${updateMode}`,
      icon
    });

    const appId = String(app.id ?? '').trim();
    if (!appId) return res.status(500).json({ ok: false, message: 'Replacement WinGet app creation returned no app ID.' });

    let targets = explicitTargets;
    if (!targets.length && reuseAssignments) {
      const existingAssignments = await graphList(accessToken, `/v1.0/deviceAppManagement/mobileApps/${sourceAppId}/assignments`);
      targets = normalizeWingetTargets(existingAssignments.map((assignment) => ({
        groupId: String(((assignment.target ?? {}) as Record<string, unknown>).groupId ?? '').trim()
      })));
    }

    if (!assignNow || !targets.length) {
      const publishResult = await waitForMobileAppPublished(accessToken, appId, { timeoutMs: 45000, intervalMs: 4000 });
      return res.status(publishResult.timedOut ? 202 : 200).json({
        ok: true,
        appId,
        createdAssignments: 0,
        publishingState: publishResult.publishingState,
        message: publishResult.timedOut
          ? `WinGet replacement app ${displayName} was created. Intune is still publishing it, and no assignments were applied yet.`
          : `WinGet replacement app ${displayName} was created. No assignments were applied.`
      });
    }

    const assignmentResult = await assignTargetsToPublishedApp(accessToken, appId, targets, installIntent);
    if (assignmentResult.pending) {
      return res.status(202).json({
        ok: true,
        appId,
        createdAssignments: 0,
        publishingState: assignmentResult.publishingState,
        message: `WinGet replacement app ${displayName} was created, but Intune has not finished publishing it yet. Assignments were not applied yet.`
      });
    }

    return res.json({
      ok: true,
      appId,
      createdAssignments: assignmentResult.createdAssignments,
      publishingState: assignmentResult.publishingState,
      message: `WinGet replacement app ${displayName} was created${assignmentResult.createdAssignments ? ` and assigned to ${assignmentResult.createdAssignments} group(s).` : '.'}`
    });
  } catch (error) {
    logger.error({ err: error, sourceAppId, packageIdentifier }, 'WinGet replacement failed.');
    return res.status(500).json({ ok: false, message: error instanceof Error ? error.message : 'WinGet replacement failed.' });
  }
});

apiRouter.post('/apps/:id/winget-update', async (req: Request, res: Response) => {
  const appId = String(req.params.id ?? '').trim();
  const accessToken = (req as any).session?.accessToken as string | undefined;
  const displayName = String(req.body?.displayName ?? '').trim();
  const publisher = String(req.body?.publisher ?? '').trim();
  const updateMode = String(req.body?.updateMode ?? 'manual').trim() === 'auto' ? 'auto' : 'manual';
  const icon = normalizeWingetIcon(req.body?.icon);

  if (!appId) return res.status(400).json({ ok: false, message: 'App ID is required.' });
  if (config.mockMode) {
    return res.json({
      ok: true,
      appId,
      publishingState: 'published',
      operationStatus: 'published' as WingetOperationStatus,
      message: 'Mock published WinGet app updated.'
    });
  }
  if (!accessToken) return res.status(401).json({ ok: false, message: 'Not connected. Sign in before updating WinGet apps.' });

  try {
    const publishResult = await getMobileAppPublishingState(accessToken, appId);
    if (publishResult.publishingState.toLowerCase() !== 'published') {
      return res.status(409).json({
        ok: false,
        publishingState: publishResult.publishingState,
        message: 'This WinGet app is still publishing in Intune. Wait until it reaches Published before updating it.'
      });
    }

    const updated = await updateWinGetApp(accessToken, appId, {
      displayName: displayName || undefined,
      publisher: publisher || undefined,
      notes: `Managed by Modern Endpoint · Update mode: ${updateMode}`,
      updateMode,
      icon
    });

    return res.json({
      ok: true,
      appId,
      publishingState: 'published',
      operationStatus: 'published' as WingetOperationStatus,
      updated,
      message: 'Published WinGet app updated successfully.'
    });
  } catch (error) {
    logger.error({ err: error, appId }, 'WinGet update failed.');
    return res.status(500).json({ ok: false, message: error instanceof Error ? error.message : 'WinGet update failed.' });
  }
});

apiRouter.get('/winget/published', async (req: Request, res: Response) => {
  const accessToken = (req as any).session?.accessToken as string | undefined;

  if (config.mockMode) {
    return res.json({ published: [], pending: [], message: 'Mock mode: no published WinGet apps.' });
  }

  if (!accessToken) {
    return res.status(401).json({ published: [], pending: [], message: 'Not connected. Sign in first.' });
  }

  try {
    const apps = await graphList(accessToken, "/beta/deviceAppManagement/mobileApps?$filter=isof('microsoft.graph.winGetApp')&$select=id,displayName,publisher,publishingState,lastModifiedDateTime,isAssigned");
    const detailed = await Promise.all(
      apps.map(async (app) => {
        const id = String(app.id ?? '');
        let packageIdentifier = '';
        if (id) {
          try {
            const detail = await graphRequest<Record<string, unknown>>(accessToken, `/beta/deviceAppManagement/mobileApps/${id}?$select=id,packageIdentifier`);
            packageIdentifier = String(detail.packageIdentifier ?? '');
          } catch {
            packageIdentifier = '';
          }
        }
        return {
          id,
          displayName: String(app.displayName ?? ''),
          publisher: String(app.publisher ?? ''),
          packageIdentifier,
          publishingState: String(app.publishingState ?? 'unknown'),
          isAssigned: Boolean(app.isAssigned ?? false),
          lastModifiedDateTime: String(app.lastModifiedDateTime ?? '')
        };
      })
    );

    const published = detailed.filter((app) => app.publishingState.toLowerCase() === 'published');
    const pending = detailed.filter((app) => app.publishingState.toLowerCase() !== 'published');
    return res.json({ published, pending, rows: published, message: detailed.length ? 'Published WinGet apps loaded.' : 'No WinGet apps found in Intune.' });
  } catch (error) {
    return res.status(500).json({ published: [], pending: [], rows: [], message: error instanceof Error ? error.message : 'Failed to load published WinGet apps.' });
  }
});

apiRouter.get('/winget/migration-candidates', async (req: Request, res: Response) => {
  try {
    const data = await getViewData((req as any).session.accessToken);
    const rows = buildWinGetMigrationCandidates(data);
    return res.json({
      rows,
      message: rows.length
        ? 'WinGet migration candidates loaded.'
        : 'No WinGet migration candidates identified yet.'
    });
  } catch (error) {
    return res.status(500).json({
      rows: [],
      message: error instanceof Error
        ? error.message
        : 'Failed to load WinGet migration candidates.'
    });
  }
});

apiRouter.get('/win32/search', async (req: Request, res: Response) => {
  try {
    const query = String(req.query.q ?? '').trim();
    const mode: Win32SearchMode =
      String(req.query.mode ?? 'quick').toLowerCase() === 'deep' ? 'deep' : 'quick';

    if (!query) {
      return res.status(400).json({
        ok: false,
        query: '',
        mode,
        bestMatch: null,
        candidates: [],
        alternatives: [],
        checkedSources: ['WinGet', 'Silent Install HQ', 'Vendor search'],
        message: 'Query is required.'
      });
    }

    const payload = await resolveWin32Search(query, mode);
    return res.json(payload);
  } catch (error) {
    logger.error({ err: error }, 'Failed to resolve live win32 package');
    return res.status(500).json({
      ok: false,
      query: String(req.query.q ?? ''),
      mode: String(req.query.mode ?? 'quick').toLowerCase() === 'deep' ? 'deep' : 'quick',
      bestMatch: null,
      candidates: [],
      alternatives: [],
      checkedSources: ['WinGet', 'Silent Install HQ', 'Vendor search'],
      message: error instanceof Error
        ? error.message
        : 'Failed to resolve live package search.'
    });
  }
});


apiRouter.get('/logs', async (_req: Request, res: Response) => {
  try {
    const raw = await fs.readFile(config.logFile, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    res.json({ rows: lines.slice(-200).map((line, index) => ({ id: String(index), line })), message: 'Log tail loaded.' });
  } catch {
    res.json({ rows: [{ id: '0', line: 'No logs found yet.' }], message: 'Logs unavailable.' });
  }
});

apiRouter.get('/logs/download', async (_req: Request, res: Response) => {
  try {
    const raw = await fs.readFile(config.logFile, 'utf8');
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', 'attachment; filename=app.log');
    res.send(raw);
  } catch {
    res.status(404).send('No logs available.');
  }
});


apiRouter.post('/win32/bundle', async (req: Request, res: Response) => {
  try {
    const {
      appName,
      publisher,
      installCommand,
      uninstallCommand,
      detectScript,
      source,
      sourceUrl,
      notes
    } = req.body ?? {};

    const normalizedAppName = String(appName ?? '').trim();
    const normalizedInstallCommand = String(installCommand ?? '').trim();
    const normalizedSource = String(source ?? '').trim().toLowerCase();

    if (!normalizedAppName || !normalizedInstallCommand) {
      return res.status(400).json({ error: 'A real app name and install command are required before building a package bundle.' });
    }

    if (['template', 'fallback'].includes(normalizedSource)) {
      return res.status(400).json({ error: 'Package bundle creation is blocked for template or fallback results. Select a source-backed package first.' });
    }

    const safeName = normalizedAppName
      .replace(/[^\w.-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'win32-package';

    const root = `${safeName}/Intune-Package`;

    const installScript = [
      '$ErrorActionPreference = "Stop"',
      normalizedInstallCommand
    ].join('\n');

    const uninstallScript = [
      '$ErrorActionPreference = "Stop"',
      uninstallCommand ? String(uninstallCommand) : 'Write-Output "No uninstall command provided."'
    ].join('\n');

    const detectContent = detectScript
      ? String(detectScript)
      : [
          'Write-Output "Detection script missing"',
          'exit 1'
        ].join('\n');

    const normalizedNotes = Array.isArray(notes) && notes.length
      ? notes.map((note: unknown) => String(note))
      : ['Validate in a packaging VM before production rollout.'];

    const intuneGuide = [
      `App Name: ${normalizedAppName}`,
      `Publisher: ${publisher || 'Unknown'}`,
      '',
      'Install command:',
      'powershell.exe -ExecutionPolicy Bypass -File .\\install.ps1',
      '',
      'Uninstall command:',
      'powershell.exe -ExecutionPolicy Bypass -File .\\uninstall.ps1',
      '',
      'Detection:',
      'Use custom detection script and upload .\\detect.ps1',
      '',
      `Source: ${source || 'Unknown'}`,
      `Source URL: ${sourceUrl || 'N/A'}`,
      '',
      'Notes:',
      ...normalizedNotes
    ].join('\n');

    const installText = `Install command\n\n${installCommand}\n`;
    const uninstallText = `Uninstall command\n\n${uninstallCommand || 'Not provided'}\n`;
    const detectionText = 'Detection rule\n\nUse custom detection script: .\\detect.ps1\n';

    const readmeText = [
      `${appName} package bundle`,
      '',
      'Files included:',
      '- install.ps1',
      '- uninstall.ps1',
      '- detect.ps1',
      '- Intune-Import-Guide.txt',
      '- Install-Command.txt',
      '- Uninstall-Command.txt',
      '- Detection-Rule.txt',
      '- README.txt',
      '',
      'Put the original installer in the files folder before packaging.'
    ].join('\n');

    const zip = buildZip([
      { name: `${root}/install.ps1`, content: installScript },
      { name: `${root}/uninstall.ps1`, content: uninstallScript },
      { name: `${root}/detect.ps1`, content: detectContent },
      { name: `${root}/Intune-Import-Guide.txt`, content: intuneGuide },
      { name: `${root}/Install-Command.txt`, content: installText },
      { name: `${root}/Uninstall-Command.txt`, content: uninstallText },
      { name: `${root}/Detection-Rule.txt`, content: detectionText },
      { name: `${root}/README.txt`, content: readmeText },
      { name: `${root}/files/put-installer-here.txt`, content: 'Place the original installer file in this folder.' }
    ]);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}-intune-package.zip"`);
    return res.send(Buffer.from(zip));
  } catch (error) {
    logger.error({ err: error }, 'Failed to build win32 bundle');
    return res.status(500).json({ error: 'Failed to build package bundle' });
  }
});
