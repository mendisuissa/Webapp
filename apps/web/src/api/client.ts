import axios from 'axios';

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');

export const api = axios.create({
  baseURL: apiBaseUrl,
  withCredentials: true
});

export interface ViewResponse {
  rows: Record<string, unknown>[];
  message: string;
}

export interface AssignmentRecord {
  id: string;
  intent: string;
  targetType: string;
  targetName: string;
  groupId?: string;
  filterInfo?: string;
}

export interface GroupSearchRecord {
  id: string;
  displayName: string;
  description?: string;
}

export interface PlatformReadinessCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface PlatformReadinessResponse {
  connected: boolean;
  mockMode: boolean;
  diagnostics: {
    scopes: string[];
    roles: string[];
    appId: string;
    audience: string;
    tenantId: string;
    expiresAt: string;
  };
  checks: PlatformReadinessCheck[];
  groupLookupHint: string;
  uninstallHint: string;
}

export interface AppAuditResponse {
  appId: string;
  appName: string;
  successRate: number;
  impactedUsers: number;
  impactedDevices: number;
  unresolvedRemainder: number;
  verificationConfidence: number;
  healthTrend: string;
  topFailureReasons: string[];
  clusters: Array<{
    id: string;
    appName: string;
    normalizedCategory: string;
    errorCode: string;
    occurrences: number;
    impactedTargets: number;
    targetTypes: string[];
    recommendedActions: string[];
    latest: string;
  }>;
  smartPlaybooks: string[];
  rolloutSafety: {
    riskLevel: string;
    pilotRecommendation: string;
    rollbackNote: string;
    affectedGroupsPreview: string[];
  };
  verification: {
    improvedDeviceCount: number;
    unresolvedRemainder: number;
    confidenceScore: number;
  };
  migration: {
    isCandidate: boolean;
    recommendation: string;
    mappingStatus: string;
  };
  managementNarrative: string;
}

export interface DashboardImpactResponse {
  impactSummary: string;
  remediationQueue: Array<{ action: string; count: number }>;
  appsNeedingAttention: Array<{ name: string; count: number; impacted: number }>;
  valueProof: { unresolvedRemainder?: number; improvedCountEstimate?: number; verificationConfidence?: number };
  smartSummary?: unknown;
  insights?: unknown[];
}

export interface WingetMigrationCandidateRecord {
  id: string;
  name: string;
  publisher: string;
  failed: number;
  statuses: number;
  readinessScore: number;
  migrationPriority: string;
  recommendation: string;
}

export interface WingetPackageRecord {
  packageIdentifier: string;
  name: string;
  publisher: string;
  latestVersion?: string;
  moniker?: string;
  sourceUrl?: string;
}

export interface PublishedWingetAppRecord {
  id: string;
  displayName: string;
  publisher: string;
  packageIdentifier: string;
  publishingState: string;
  isAssigned: boolean;
  lastModifiedDateTime?: string;
}

export interface PublishedWingetListResponse {
  published: PublishedWingetAppRecord[];
  pending: PublishedWingetAppRecord[];
  rows?: PublishedWingetAppRecord[];
  message: string;
}

export interface WingetIconInput {
  type: string;
  value: string;
}

export async function getAuthStatus() {
  const response = await api.get('/auth/status');
  return response.data as { connected: boolean; upn: string; tenantId: string; displayName: string; mockMode?: boolean; hasWritePermissions?: boolean; scopes?: string[] };
}

export async function getView(view: string): Promise<ViewResponse> {
  const response = await api.get(`/view/${view}`);
  return response.data as ViewResponse;
}

export async function refreshData() {
  const response = await api.get('/refresh');
  return response.data as { message: string };
}

export async function copyRunbook(row: Record<string, unknown> | null) {
  const response = await api.post('/runbook', row ?? {});
  return response.data as { runbook: string };
}

export async function getLogs() {
  const response = await api.get('/logs');
  return response.data as ViewResponse;
}

export async function uninstallApp(app: { id: string; name?: string; assignmentIds: string[] }) {
  const response = await api.post(`/apps/${encodeURIComponent(app.id)}/uninstall`, {
    name: app.name ?? '',
    assignmentIds: app.assignmentIds
  });
  return response.data as { ok: boolean; message: string; mode?: string; note?: string };
}

export async function getAppDetails(appId: string) {
  const response = await api.get(`/apps/${encodeURIComponent(appId)}/details`);
  return response.data as Record<string, unknown>;
}

export async function getAppAssignments(appId: string) {
  const response = await api.get(`/apps/${encodeURIComponent(appId)}/assignments`);
  return response.data as { rows: AssignmentRecord[]; message: string };
}

export async function searchGroups(query: string) {
  const response = await api.get('/groups/search', { params: { q: query } });
  return response.data as { rows: GroupSearchRecord[]; message: string; readiness?: PlatformReadinessResponse };
}

export async function searchWingetPackages(query: string) {
  const response = await api.get('/winget/search', { params: { q: query } });
  return response.data as { rows: WingetPackageRecord[]; message: string };
}

export async function getPublishedWingetApps() {
  const response = await api.get('/winget/published');
  return response.data as PublishedWingetListResponse;
}

export async function deployWingetApp(payload: {
  packageIdentifier: string;
  displayName?: string;
  publisher?: string;
  installIntent: 'required' | 'available';
  runAsAccount: 'system' | 'user';
  updateMode: 'auto' | 'manual';
  assignNow?: boolean;
  icon?: WingetIconInput;
  targets: Array<{ groupId: string; targetType: 'users' | 'devices'; displayName?: string }>;
}) {
  const response = await api.post('/winget/deploy', payload);
  return response.data as { ok: boolean; message: string; appId?: string; createdAssignments?: number; publishingState?: string; operationStatus?: string };
}

export async function linkWingetToExistingApp(appId: string, payload: {
  packageIdentifier: string;
  displayName?: string;
  publisher?: string;
  installIntent: 'required' | 'available';
  runAsAccount: 'system' | 'user';
  updateMode: 'auto' | 'manual';
  reuseAssignments: boolean;
  assignNow?: boolean;
  icon?: WingetIconInput;
  targets: Array<{ groupId: string; targetType: 'users' | 'devices'; displayName?: string }>;
}) {
  const response = await api.post(`/apps/${encodeURIComponent(appId)}/winget-link`, payload);
  return response.data as { ok: boolean; message: string; appId?: string; createdAssignments?: number; publishingState?: string; operationStatus?: string };
}

export async function updateExistingWingetApp(appId: string, payload: {
  displayName?: string;
  publisher?: string;
  updateMode?: 'auto' | 'manual';
  icon?: WingetIconInput;
}) {
  const response = await api.post(`/apps/${encodeURIComponent(appId)}/winget-update`, payload);
  return response.data as { ok: boolean; message: string; appId?: string; createdAssignments?: number; publishingState?: string; operationStatus?: string };
}

export async function getAppAudit(appId: string) {
  const response = await api.get(`/apps/${encodeURIComponent(appId)}/audit`);
  return response.data as AppAuditResponse;
}

export async function getDashboardImpact() {
  const response = await api.get('/dashboard/impact');
  return response.data as DashboardImpactResponse;
}

export async function getWingetMigrationCandidates() {
  const response = await api.get('/winget/migration-candidates');
  return response.data as { rows: WingetMigrationCandidateRecord[]; message: string };
}

export async function getPlatformReadiness() {
  const response = await api.get('/platform/readiness');
  return response.data as PlatformReadinessResponse;
}


export interface Win32SearchResultRecord {
  id: string;
  name: string;
  publisher: string;
  packageId?: string;
  sourceType: 'winget' | 'silentinstallhq';
  sourceLabel: string;
  sourceUrl: string;
  sourceTitle: string;
  resolutionType: 'source_backed' | 'generated_detection';
  confidence: 'high' | 'medium';
  installCommand: string;
  uninstallCommand: string;
  detectionScript: string;
  detectionSummary: string;
  notes: string[];
  evidence?: string[];
}

export interface Win32SearchResponse {
  query: string;
  mode: 'quick' | 'deep';
  bestMatch: Win32SearchResultRecord | null;
  alternatives: Win32SearchResultRecord[];
  sourcesChecked: string[];
  message: string;
}

export async function searchWin32Packages(query: string, mode: 'quick' | 'deep' = 'quick') {
  const response = await api.get('/win32/search', { params: { q: query, mode } });
  return response.data as Win32SearchResponse;
}

// Compatibility shim for older imports used by some components
export type Win32SearchMode = 'quick' | 'deep' | 'catalog';

export interface Win32CatalogMatch {
  packageKey: string;
  name: string;
  publisher?: string;
  sourceUrl?: string;
}

export interface Win32ResolvedRecord {
  packageKey: string;
  id: string;
  name: string;
  publisher?: string;
  packageId?: string;
  detectionType?: string;
  detectionSummary: string;
  installCommand: string;
  uninstallCommand: string;
  detectScript: string;
  sourceUrl?: string;
  source: 'vendor' | 'silentinstallhq' | 'winget' | 'heuristic' | string;
  confidence: string | number;
  notes: string[];
  validationChecklist: string[];
}

export async function getWin32Catalog(prefix: string) {
  const response = await api.get('/winget/search', { params: { q: prefix } });
  const rows = Array.isArray(response.data?.rows) ? response.data.rows : [];
  const mapped = rows.map((r: any) => ({
    packageKey: r.packageIdentifier ?? r.packageKey ?? '',
    name: r.name ?? '',
    publisher: r.publisher ?? '',
    sourceUrl: r.sourceUrl ?? ''
  })) as Win32CatalogMatch[];
  return { count: mapped.length, rows: mapped };
}

export async function searchWin32Resolver(query: string, mode: Win32SearchMode) {
  const qMode = mode === 'catalog' ? 'quick' : (mode === 'deep' ? 'deep' : 'quick');
  const response = await api.get('/win32/search', { params: { q: query, mode: qMode } });
  const data = response.data as any;
  const mapResolved = (item: any): Win32ResolvedRecord | null => {
    if (!item) return null;
    return {
      packageKey: item.id ?? item.packageId ?? item.packageIdentifier ?? '',
      id: item.id ?? '',
      name: item.name ?? '',
      publisher: item.publisher ?? '',
      packageId: item.packageId ?? item.packageIdentifier ?? '',
      detectionType: item.resolutionType ?? '',
      detectionSummary: item.detectionSummary ?? '',
      installCommand: item.installCommand ?? '',
      uninstallCommand: item.uninstallCommand ?? '',
      detectScript: item.detectionScript ?? '',
      sourceUrl: item.sourceUrl ?? '',
      source: (item.sourceType ?? item.source ?? 'winget') as any,
      confidence: item.confidence ?? '',
      notes: Array.isArray(item.notes) ? item.notes : [],
      validationChecklist: Array.isArray(item.validationChecklist) ? item.validationChecklist : []
    };
  };

  const alternatives = Array.isArray(data?.alternatives)
    ? data.alternatives.map((item: any) => ({
        packageKey: item.id ?? item.packageId ?? item.packageIdentifier ?? '',
        name: item.name ?? '',
        publisher: item.publisher ?? '',
        sourceUrl: item.sourceUrl ?? ''
      })) as Win32CatalogMatch[]
    : [];

  return {
    resolved: mapResolved(data?.bestMatch ?? null),
    alternatives,
    catalogCount: data?.catalogCount ?? 0,
    message: data?.message ?? ''
  };
}

export async function downloadWin32Bundle(packageKey: string, name?: string) {
  const url = `/win32/bundle/${encodeURIComponent(packageKey)}`;
  const response = await api.get(url, { responseType: 'blob' as const });
  return response.data as Blob;
}
