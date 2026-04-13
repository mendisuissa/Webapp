export type ViewName = 'dashboard' | 'devices' | 'apps' | 'users' | 'winget' | 'ocr' | 'incidents';

export interface AuthStatus {
  connected: boolean;
  upn: string;
  tenantId: string;
  displayName: string;
  mockMode?: boolean;
}

export interface FailureExplanation {
  normalizedCategory: string;
  cause: string;
  confidence: number;
  recommendedActions: string[];
  /** Optional: derived from errorCode prefix (e.g. 0x87D, 0x80073) */
  errorFamily?: string;
  /** Optional: stable grouping key for incidents */
  signatureKey?: string;
  /** Optional: short hash of signatureKey for UI grouping */
  signatureHash?: string;
  evidence: {
    lastReportedDateTime: string;
    errorCode: string;
    errorDescription: string;
  };
}

export interface ErrorSignature {
  key: string;
  hash: string;
}

export interface SmartSummary {
  title: string;
  severity: 'info' | 'warn' | 'critical';
  bullets: string[];
  recommendedNextActions: string[];
  confidence: number;
  topErrorCode?: string;
  impactedCount?: number;
}

export interface InsightCard {
  id: string;
  title: string;
  metric: string;
  delta?: string;
  severity: 'info' | 'warn' | 'critical';
  deepLink?: string;
}

export interface PlaybookStep {
  title: string;
  details?: string[];
}

export interface Playbook {
  id: string;
  title: string;
  whenToUse: string;
  steps: PlaybookStep[];
  tags: string[];
}

export interface ManagedDevice {
  id: string;
  deviceName: string;
  operatingSystem: string;
  osVersion: string;
  complianceState: string;
  lastSyncDateTime: string;
  userDisplayName: string;
  userPrincipalName: string;
}

export interface UserRow {
  id: string;
  displayName: string;
  userPrincipalName: string;
  mail: string;
}

export interface MobileApp {
  id: string;
  displayName: string;
  publisher: string;
  platform: string;
  lastModifiedDateTime: string;
}

export interface AppStatusRow {
  id: string;
  appId: string;
  appName: string;
  targetType: 'device' | 'user';
  targetId: string;
  targetName: string;
  installState: string;
  errorCode: string;
  errorDescription: string;
  lastReportedDateTime: string;
  normalizedCategory: string;
  cause: string;
  confidence: number;
  recommendedActions: string[];
  errorFamily?: string;
  signatureKey?: string;
  signatureHash?: string;
}

export type IncidentSeverity = 'Low' | 'Medium' | 'High';

export interface IncidentRow {
  id: string;
  signature: string;
  appId: string;
  appName: string;
  normalizedCategory: string;
  errorCode: string;
  impactedCount: number;
  firstSeen: string;
  lastSeen: string;
  severity: IncidentSeverity;
  isPlaceholder?: boolean;
  summary: string;
}

export interface DashboardData {
  totalDevices: number;
  totalApps: number;
  totalUsers: number;
  failedStatuses: number;
  topFailingApps: Array<{ name: string; count: number }>;
  topCategories: Array<{ category: string; count: number }>;
  lastRefresh: string;
  smartSummary?: SmartSummary;
  insights?: InsightCard[];
}

export interface SettingsData {
  incidentWindowMinutes: number;
  incidentThresholdCount: number;
  severityThresholds: Record<IncidentSeverity, number>;
  refreshIntervalSeconds: number;
  mockMode: boolean;
}

export interface GridPayload<T = Record<string, unknown>> {
  rows: T[];
  message: string;
}

export interface NormalizationRule {
  id: string;
  enabled: boolean;
  failureCategory: string;
  confidence: number;
  cause: string;
  anyMatches: string[];
  recommendedActions: string[];
}

export interface SeverityThresholds {
  Low: number;
  Medium: number;
  High: number;
}

export function getSeverity(count: number, thresholds: SeverityThresholds): IncidentSeverity {
  if (count >= thresholds.High) return 'High';
  if (count >= thresholds.Medium) return 'Medium';
  return 'Low';
}