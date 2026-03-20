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
export async function deployWingetApp(payload: {
  packageIdentifier: string;
  displayName: string;
  publisher: string;
  installIntent?: 'required' | 'available';
  runAsAccount?: 'system' | 'user';
  updateMode?: 'auto' | 'manual';
  targets?: Array<{ groupId: string; displayName?: string; targetType?: 'users' | 'devices' }>;
  reuseAssignments?: boolean;
  assignNow?: boolean;
  icon?: WingetIconInput;
}) {
  const response = await api.post('/winget/deploy', payload);
  return response.data as { ok: boolean; message: string; appId?: string; createdAssignments?: number; publishingState?: string; operationStatus?: string; displayName?: string; appName?: string };
}
export interface Win32PackageBundleRequest {
  name?: string;
  appName?: string;
  publisher?: string;
  packageId?: string;
  installCommand?: string;
  uninstallCommand?: string;
  detectScript?: string;
  detectionType?: string;
  detectionSummary?: string;
  source?: string;
  sourceUrl?: string;
  confidence?: string | number;
  notes?: string[];
}

export async function downloadWin32PackageBundle(
  payload: Win32PackageBundleRequest
): Promise<Blob> {
  const response = await fetch('/api/win32/bundle', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Failed to build package bundle: ${response.status}`);
  }

  const blob = await response.blob();
  return blob;
}
export async function linkWingetToExistingApp(appId: string, payload: {
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


export type Win32InstallerType = 'exe' | 'msi' | 'msix' | 'zip';
export type Win32ExportReadiness = 'ready' | 'partial' | 'research-needed';

export interface Win32OfficialDocsRecord {
  url: string;
  title: string;
  installNotes: string[];
  uninstallNotes: string[];
  silentSwitches: string[];
  detectionHints: string[];
}

export interface Win32GithubAssetRecord {
  name: string;
  url: string;
  type?: Win32InstallerType;
  architecture?: 'x64' | 'x86' | 'arm64' | 'unknown';
}

export interface Win32GithubReleaseRecord {
  repoUrl: string;
  tag?: string;
  version?: string;
  releaseUrl?: string;
  publishedAt?: string;
  assets: Win32GithubAssetRecord[];
}

export interface Win32ResolvedMatch {
  id?: string;
  name: string;
  publisher: string;
  packageId?: string;
  source: 'winget' | 'silentinstallhq' | 'vendor' | 'chocolatey' | 'github' | 'officialdocs' | 'fallback';
  sourceUrl?: string;
  confidence: 'high' | 'medium' | 'low';
  confidenceScore?: number;
  confidenceReasons?: string[];
  installCommand: string;
  uninstallCommand: string;
  detectScript: string;
  notes: string[];
  evidence: string[];
  whySelected: string;
  installerUrl?: string;
  installerType?: Win32InstallerType;
  downloadPageUrl?: string;
  isDirectDownload?: boolean;
  version?: string;
  exportReadiness?: Win32ExportReadiness;
  officialDocs?: Win32OfficialDocsRecord;
  githubRelease?: Win32GithubReleaseRecord;
}

export interface Win32AlternativeRecord {
  title: string;
  source: 'winget' | 'silentinstallhq' | 'vendor' | 'chocolatey' | 'github' | 'officialdocs' | 'fallback';
  url: string;
  note: string;
}

export type Win32CandidateRecord =
  | ({
      packageId?: string;
      url?: string;
      sourceUrl?: string;
      name: string;
      publisher?: string;
      source?: string;
    })
  | Win32ResolvedMatch;

export interface Win32ResolveResponse {
  ok: boolean;
  query: string;
  message: string;
  bestMatch: Win32ResolvedMatch | null;
  candidates: Win32ResolvedMatch[];
  alternatives: Win32AlternativeRecord[];
  checkedSources: string[];
}

export async function resolveWin32Package(query: string, mode: 'quick' | 'deep' = 'quick') {
  const response = await api.get('/win32/search', { params: { q: query, mode } });
  return response.data as Win32ResolveResponse;
}

