import { useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent } from 'react';
import { ViewName } from '@efm/shared';
import {
  api,
  deployWingetApp,
  getAppAssignments,
  getAppAudit,
  getAppDetails,
  getAuthStatus,
  getDashboardImpact,
  getPlatformReadiness,
  getView,
  getWingetMigrationCandidates,
  linkWingetToExistingApp,
  refreshData,
  searchGroups,
  searchWingetPackages,
  uninstallApp,
  type AppAuditResponse,
  type AssignmentRecord,
  type DashboardImpactResponse,
  type GroupSearchRecord,
  type PlatformReadinessResponse,
  type WingetMigrationCandidateRecord,
  type WingetPackageRecord
} from './api/client.js';
import { recognize } from 'tesseract.js';
import { IntuneAIDrawer } from './components/IntuneAIDrawer.js';
import Phase1AuditPanels from './components/Phase1AuditPanels.js';
import Win32UtilityWorkspace from './components/Win32UtilityWorkspace.js';

type Row = Record<string, unknown>;
type AuthState = { connected: boolean; upn: string; tenantId: string; displayName: string; mockMode?: boolean; hasWritePermissions?: boolean; scopes?: string[] };
type PlatformFilter = 'all' | 'windows' | 'mobile' | 'mac';
type VisibleColumnsState = Partial<Record<ViewName, string[]>>;
type AppActionState = { open: boolean; row: Row | null };
type ContextMenuState = { open: boolean; x: number; y: number; row: Row | null };
type AssignmentManagerState = {
  open: boolean;
  loading: boolean;
  busy: boolean;
  error: string;
  row: Row | null;
  assignments: AssignmentRecord[];
  selectedIds: string[];
};

type WingetTarget = { groupId: string; displayName: string; targetType: 'users' | 'devices' };

type WingetStudioState = {
  open: boolean;
  mode: 'deploy' | 'update';
  loading: boolean;
  busy: boolean;
  error: string;
  message: string;
  query: string;
  results: WingetPackageRecord[];
  selected: WingetPackageRecord | null;
  installIntent: 'required' | 'available';
  runAsAccount: 'system' | 'user';
  updateMode: 'auto' | 'manual';
  groupQuery: string;
  groupResults: GroupSearchRecord[];
  targets: WingetTarget[];
  reuseAssignments: boolean;
  readiness: PlatformReadinessResponse | null;
};

type ToastMessage = { id: number; tone: 'info' | 'success' | 'warn' | 'error'; text: string };

const views: Array<{ id: ViewName; label: string; icon: string; short: string }> = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊', short: 'Overview' },
  { id: 'devices', label: 'Devices', icon: '💻', short: 'Managed endpoints' },
  { id: 'apps', label: 'Apps', icon: '📦', short: 'Deployments' },
  { id: 'winget', label: 'Win32 Utility', icon: '🛠️', short: 'Packaging assistant' },
  { id: 'users', label: 'Users', icon: '👤', short: 'Assignments' },
  { id: 'ocr', label: 'OCR', icon: '🧠', short: 'Error assistant' },
  { id: 'incidents', label: 'Incidents', icon: '🚨', short: 'Risk signals' },
];

const defaultColumns: Partial<Record<ViewName, string[]>> = {
  dashboard: ['totalDevices', 'totalApps', 'totalUsers', 'failedStatuses', 'lastRefresh'],
  devices: ['deviceName', 'operatingSystem', 'osVersion', 'complianceState', 'lastSyncDateTime', 'userPrincipalName'],
  apps: ['name', 'platform', 'publisher', 'statuses', 'failed', 'lastModifiedDateTime'],
  users: ['displayName', 'userPrincipalName', 'mail', 'managedDevices'],
  incidents: ['appName', 'normalizedCategory', 'errorCode', 'installState', 'targetName', 'lastReportedDateTime'],
  ocr: []
};


type Win32UtilityPreset = {
  key: string;
  name: string;
  publisher: string;
  packageId: string;
  source: 'WinGet' | 'Silent Install HQ' | 'Template';
  confidence: 'High' | 'Medium';
  installCommand: string;
  uninstallCommand: string;
  detectionType: string;
  detectionSummary: string;
  detectScript: string;
  notes: string[];
};

const win32UtilityPresets: Win32UtilityPreset[] = [
  {
    key: 'chrome',
    name: 'Google Chrome',
    publisher: 'Google',
    packageId: 'Google.Chrome',
    source: 'WinGet',
    confidence: 'High',
    installCommand: 'winget install --id Google.Chrome --exact --silent --accept-source-agreements --accept-package-agreements',
    uninstallCommand: String.raw`"%ProgramFiles%\Google\Chrome\Application\<version>\Installer\setup.exe" --uninstall --system-level --force-uninstall`,
    detectionType: 'File + version',
    detectionSummary: String.raw`Detect C:\Program Files\Google\Chrome\Application\chrome.exe and optionally validate version.`,
    detectScript: String.raw`$path = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (Test-Path $path) { Write-Output "Detected"; exit 0 }
exit 1`,
    notes: ['Best candidate for direct WinGet deployment.', 'Validate uninstall path in a packaging VM before production rollout.']
  },
  {
    key: '7zip',
    name: '7-Zip',
    publisher: 'Igor Pavlov',
    packageId: '7zip.7zip',
    source: 'WinGet',
    confidence: 'High',
    installCommand: 'winget install --id 7zip.7zip --exact --silent --accept-source-agreements --accept-package-agreements',
    uninstallCommand: String.raw`"%ProgramFiles%\7-Zip\Uninstall.exe" /S`,
    detectionType: 'File exists',
    detectionSummary: String.raw`Detect C:\Program Files\7-Zip\7zFM.exe for classic device-context packaging.`,
    detectScript: String.raw`$path = "C:\Program Files\7-Zip\7zFM.exe"
if (Test-Path $path) { Write-Output "Detected"; exit 0 }
exit 1`,
    notes: ['Strong Win32 packaging candidate for Intune.', 'File-based detection is usually enough unless you need version control.']
  },
  {
    key: 'notepad',
    name: 'Notepad++',
    publisher: 'Notepad++ Team',
    packageId: 'Notepad++.Notepad++',
    source: 'Silent Install HQ',
    confidence: 'Medium',
    installCommand: 'npp.8.x.Installer.x64.exe /S',
    uninstallCommand: String.raw`"%ProgramFiles%\Notepad++\uninstall.exe" /S`,
    detectionType: 'Registry or file',
    detectionSummary: String.raw`Use HKLM uninstall key when available, otherwise detect notepad++.exe in Program Files.`,
    detectScript: String.raw`$paths = @(
  "C:\Program Files\Notepad++\notepad++.exe",
  "C:\Program Files (x86)\Notepad++\notepad++.exe"
)
if ($paths | Where-Object { Test-Path $_ }) { Write-Output "Detected"; exit 0 }
exit 1`,
    notes: ['Treat as medium confidence until validated in your packaging workflow.', 'Prefer registry detection if your packaged installer writes stable uninstall keys.']
  }
];

function toText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

function toLabel(input: string): string {
  return input
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

function isScalar(value: unknown): boolean {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function getStoredColumns(): VisibleColumnsState {
  try {
    const raw = window.localStorage.getItem('efm.visibleColumnsByView');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function getStoredPlatformFilter(): PlatformFilter {
  try {
    const raw = window.localStorage.getItem('efm.appsPlatformFilter');
    return raw === 'windows' || raw === 'mobile' || raw === 'mac' ? raw : 'all';
  } catch {
    return 'all';
  }
}

function normalizePlatform(value: unknown): PlatformFilter | 'unknown' {
  const text = String(value ?? '').toLowerCase();
  if (!text) return 'unknown';
  if (text.includes('mac')) return 'mac';
  if (text.includes('ios') || text.includes('android') || text.includes('mobile')) return 'mobile';
  if (text.includes('windows') || text.includes('win32') || text.includes('msi')) return 'windows';
  return 'unknown';
}

function rowPlatform(row: Row): PlatformFilter | 'unknown' {
  return normalizePlatform(row.platform ?? row.operatingSystem ?? row.type ?? row.appType);
}

export default function App() {
  const [currentView, setCurrentView] = useState<ViewName>('dashboard');
  const [rows, setRows] = useState<Row[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [statusMessage, setStatusMessage] = useState('Ready');
  const [detailsSummary, setDetailsSummary] = useState('Select a row to view details.');
  const [detailsText, setDetailsText] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [columnSearch, setColumnSearch] = useState('');
  const [visibleColumnsByView, setVisibleColumnsByView] = useState<VisibleColumnsState>(() =>
    typeof window !== 'undefined' ? getStoredColumns() : {}
  );
  const [appsPlatformFilter, setAppsPlatformFilter] = useState<PlatformFilter>(() =>
    typeof window !== 'undefined' ? getStoredPlatformFilter() : 'all'
  );

  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches
  );

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const [auth, setAuth] = useState<AuthState>({ connected: false, upn: '', tenantId: '', displayName: '', mockMode: false, hasWritePermissions: false, scopes: [] });
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  const [upgradeAction, setUpgradeAction] = useState('');
  const [permissionCheck, setPermissionCheck] = useState<PlatformReadinessResponse | null>(null);
  const [permissionCheckLoading, setPermissionCheckLoading] = useState(false);
  const [permissionCheckOpen, setPermissionCheckOpen] = useState(false);

  const [aiPanel, setAiPanel] = useState<{
    open: boolean;
    action: 'explain' | 'runbook' | 'execSummary';
    row: Row | null;
  }>({ open: false, action: 'explain', row: null });

  const [appDetails, setAppDetails] = useState<AppActionState>({ open: false, row: null });
  const [appContextMenu, setAppContextMenu] = useState<ContextMenuState>({ open: false, x: 0, y: 0, row: null });
  const [uninstallState, setUninstallState] = useState<{ open: boolean; row: Row | null; busy: boolean; error: string }>({
    open: false,
    row: null,
    busy: false,
    error: ''
  });

  const [assignmentManager, setAssignmentManager] = useState<AssignmentManagerState>({
    open: false,
    loading: false,
    busy: false,
    error: '',
    row: null,
    assignments: [],
    selectedIds: []
  });

  const [wingetStudio, setWingetStudio] = useState<WingetStudioState>({
    open: false,
    mode: 'deploy',
    loading: false,
    busy: false,
    error: '',
    message: '',
    query: '',
    results: [],
    selected: null,
    installIntent: 'required',
    runAsAccount: 'system',
    updateMode: 'manual',
    groupQuery: '',
    groupResults: [],
    targets: [],
    reuseAssignments: true,
    readiness: null
  });
  const [dashboardImpact, setDashboardImpact] = useState<DashboardImpactResponse | null>(null);
  const [appAudit, setAppAudit] = useState<AppAuditResponse | null>(null);
  const [migrationCandidates, setMigrationCandidates] = useState<WingetMigrationCandidateRecord[]>([]);
  const [win32UtilityQuery, setWin32UtilityQuery] = useState('Google Chrome');
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const selectedRow = useMemo<Row | null>(() => {
    if (selectedIndex === null) return null;
    return rows[selectedIndex] ?? null;
  }, [selectedIndex, rows]);

  const currentViewMeta = useMemo(() => views.find((v) => v.id === currentView) ?? views[0], [currentView]);

  const selectedAppRow = useMemo<Row | null>(() => {
    if (currentView !== 'apps') return null;
    if (appDetails.row) return appDetails.row;
    return selectedRow;
  }, [appDetails.row, currentView, selectedRow]);

  const appReliabilityHighlights = useMemo(() => {
    if (!appAudit) return [] as Array<{ label: string; value: string; tone?: string }>;
    return [
      { label: 'Success rate', value: `${appAudit.successRate}%`, tone: appAudit.successRate >= 85 ? 'accent' : 'warn' },
      { label: 'Impacted devices', value: String(appAudit.impactedDevices), tone: appAudit.impactedDevices > 0 ? 'warn' : undefined },
      { label: 'Impacted users', value: String(appAudit.impactedUsers), tone: appAudit.impactedUsers > 0 ? 'warn' : undefined },
      { label: 'Verification confidence', value: `${appAudit.verificationConfidence}%`, tone: appAudit.verificationConfidence >= 75 ? 'accent' : 'warn' }
    ];
  }, [appAudit]);

  const wingetPackageIdentifier = wingetStudio.selected?.packageIdentifier ?? wingetStudio.query.trim();
  const wingetPackageName = (wingetStudio.selected?.name ?? wingetPackageIdentifier) || 'No package selected';
  const wingetPublisher = wingetStudio.selected?.publisher ?? (wingetPackageIdentifier ? wingetPackageIdentifier.split('.')[0] ?? 'Unknown' : 'Unknown');
  const wingetDeviceTargets = wingetStudio.targets.filter((target) => target.targetType === 'devices');
  const wingetUserTargets = wingetStudio.targets.filter((target) => target.targetType === 'users');
  const wingetReadyChecks = [
    { label: 'Package selected', ok: Boolean(wingetPackageIdentifier) },
    { label: 'Deployment profile set', ok: Boolean(wingetStudio.installIntent && wingetStudio.runAsAccount) },
    { label: 'At least one target group', ok: wingetStudio.targets.length > 0 || (wingetStudio.mode === 'update' && wingetStudio.reuseAssignments) }
  ];
  const wingetCanSubmit = wingetReadyChecks.every((item) => item.ok);
  const wingetGroupSearchHasNoResults = Boolean(wingetStudio.groupQuery.trim()) && !wingetStudio.loading && wingetStudio.groupResults.length === 0;
  const wingetSelectedSourceName = String(selectedAppRow?.name ?? selectedAppRow?.appName ?? 'Selected app');
  const readinessChecks = wingetStudio.readiness?.checks ?? [];
  const readinessBlocking = readinessChecks.filter((item) => !item.ok);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [ocrUploadBusy, setOcrUploadBusy] = useState(false);
  const [ocrUploadError, setOcrUploadError] = useState<string>('');
  const [ocrStatus, setOcrStatus] = useState<'Not started' | 'Image selected' | 'Running' | 'Done' | 'Failed'>('Not started');
  const [ocrManualText, setOcrManualText] = useState<string>('');
  const [ocrAnswer, setOcrAnswer] = useState<string>('');
  const [ocrSelectedFile, setOcrSelectedFile] = useState<File | null>(null);

  const allHeaders = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((row) => {
      Object.keys(row).forEach((key) => {
        if (key !== 'details') set.add(key);
      });
    });
    return Array.from(set);
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (currentView !== 'apps' || appsPlatformFilter === 'all') return rows;
    return rows.filter((row) => rowPlatform(row) === appsPlatformFilter);
  }, [appsPlatformFilter, currentView, rows]);

  const visibleHeaders = useMemo(() => {
    const preferred = visibleColumnsByView[currentView] ?? [];
    if (!allHeaders.length) return [] as string[];
    const validPreferred = preferred.filter((header) => allHeaders.includes(header));
    return validPreferred.length > 0 ? validPreferred : allHeaders;
  }, [allHeaders, currentView, visibleColumnsByView]);

  const dashboardStats = useMemo(() => {
    if (currentView !== 'dashboard' || rows.length === 0) return [] as Array<{ label: string; value: string; tone?: string }>;
    const first = rows[0];
    return Object.entries(first)
      .filter(([key, value]) => key !== 'details' && (isScalar(value) || Array.isArray(value)))
      .slice(0, 6)
      .map(([key, value], index) => {
        const normalized = Array.isArray(value) ? value.length : value;
        const tone = index === 3 ? 'warn' : index === 4 ? 'accent' : undefined;
        return { label: toLabel(key), value: String(normalized ?? '—'), tone };
      });
  }, [currentView, rows]);

  const detailEntries = useMemo(() => {
    if (!selectedRow) return [] as Array<{ key: string; value: string }>;
    return Object.entries(selectedRow)
      .filter(([key]) => key !== 'details')
      .map(([key, value]) => ({ key: toLabel(key), value: isScalar(value) ? String(value ?? '') : toText(value) }))
      .slice(0, 12);
  }, [selectedRow]);

  const appDetailCards = useMemo(() => {
    if (!selectedAppRow) return [] as Array<{ label: string; value: string }>;
    const preferredKeys = [
      'deploymentType',
      'platform',
      'installContext',
      'assignmentScope',
      'architecture',
      'targetCount',
      'healthState',
      'wingetId',
      'packageIdentifier'
    ];

    return preferredKeys
      .filter((key) => selectedAppRow[key] !== undefined && selectedAppRow[key] !== '')
      .map((key) => ({ label: toLabel(key), value: toText(selectedAppRow[key]) }));
  }, [selectedAppRow]);

  const filteredColumnOptions = useMemo(() => {
    const needle = columnSearch.trim().toLowerCase();
    if (!needle) return allHeaders;
    return allHeaders.filter((header) => toLabel(header).toLowerCase().includes(needle) || header.toLowerCase().includes(needle));
  }, [allHeaders, columnSearch]);


  const activeWin32Preset = useMemo(() => {
    const query = win32UtilityQuery.trim().toLowerCase();
    if (!query) return win32UtilityPresets[0];
    return (
      win32UtilityPresets.find((item) =>
        item.name.toLowerCase().includes(query) ||
        item.packageId.toLowerCase().includes(query) ||
        item.publisher.toLowerCase().includes(query) ||
        item.key.includes(query.replace(/\s+/g, ''))
      ) ?? {
        key: 'custom',
        name: win32UtilityQuery.trim(),
        publisher: 'Needs validation',
        packageId: 'custom.lookup',
        source: 'Template',
        confidence: 'Medium',
        installCommand: `winget search --name "${win32UtilityQuery.trim()}"`,
        uninstallCommand: 'Review vendor uninstall string or MSI product code before rollout.',
        detectionType: 'Custom PowerShell',
        detectionSummary: 'Fallback mode: validate registry, file path, or MSI product code before packaging.',
        detectScript: String.raw`$candidate = Get-ChildItem HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall -ErrorAction SilentlyContinue
# Replace with app-specific detection before production use.
exit 1`,
        notes: ['No preset match yet. Use this as a packaging starting point only.', 'Confidence increases once WinGet or vendor metadata is confirmed.']
      }
    );
  }, [win32UtilityQuery]);

  useEffect(() => {
    try {
      window.localStorage.setItem('efm.visibleColumnsByView', JSON.stringify(visibleColumnsByView));
    } catch {
      // ignore persistence errors
    }
  }, [visibleColumnsByView]);

  useEffect(() => {
    try {
      window.localStorage.setItem('efm.appsPlatformFilter', appsPlatformFilter);
    } catch {
      // ignore persistence errors
    }
  }, [appsPlatformFilter]);

  useEffect(() => {
    if (!allHeaders.length || currentView === 'ocr') return;
    setVisibleColumnsByView((prev) => {
      const current = prev[currentView] ?? [];
      const validCurrent = current.filter((header) => allHeaders.includes(header));
      if (validCurrent.length > 0) {
        if (validCurrent.length === current.length) return prev;
        return { ...prev, [currentView]: validCurrent };
      }

      const defaults = (defaultColumns[currentView] ?? []).filter((header) => allHeaders.includes(header));
      const next = defaults.length > 0 ? defaults : allHeaders;
      return { ...prev, [currentView]: next };
    });
  }, [allHeaders, currentView]);

  useEffect(() => {
    setColumnsOpen(false);
    setColumnSearch('');
  }, [currentView]);

  useEffect(() => {
    if (!appContextMenu.open) return;

    const close = () => setAppContextMenu((prev) => ({ ...prev, open: false }));
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [appContextMenu.open]);

  function pushToast(tone: ToastMessage['tone'], text: string) {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev, { id, tone, text }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, 4200);
  }

  async function loadDashboardImpact() {
    try {
      const result = await getDashboardImpact();
      setDashboardImpact(result);
    } catch {
      setDashboardImpact(null);
    }
  }

  async function loadAppAudit(appId: string) {
    try {
      const result = await getAppAudit(appId);
      setAppAudit(result);
    } catch {
      setAppAudit(null);
    }
  }

  async function loadMigrationCandidates() {
    try {
      const result = await getWingetMigrationCandidates();
      setMigrationCandidates(result.rows ?? []);
    } catch {
      setMigrationCandidates([]);
    }
  }

  async function loadAuth() {
    try {
      const result = await getAuthStatus();
      setAuth(result);
    } catch {
      setAuth({ connected: false, upn: '', tenantId: '', displayName: '', mockMode: false, hasWritePermissions: false, scopes: [] });
    }
  }

  async function loadView(view: ViewName) {
    try {
      const result = await getView(view);
      const safeRows = Array.isArray(result.rows) ? result.rows : [];

      setRows(safeRows);
      const nextIndex = safeRows.length > 0 ? 0 : null;
      setSelectedIndex(nextIndex);
      setStatusMessage(result.message || `${view} loaded.`);

      if (safeRows.length === 0) {
        setDetailsSummary('No data returned for this view.');
        setDetailsText('The endpoint returned an empty dataset.');
      } else {
        const first = safeRows[0];
        setDetailsSummary(toText(first['name'] ?? first['deviceName'] ?? first['displayName'] ?? first['appName'] ?? 'Row selected'));
        setDetailsText(toText(first['details'] ?? first));
      }
    } catch (error) {
      setRows([]);
      setSelectedIndex(null);
      setStatusMessage(error instanceof Error ? error.message : 'Failed to load view.');
    }
  }

  useEffect(() => {
    void loadAuth();
  }, []);

  useEffect(() => {
    if (!auth.connected && !auth.mockMode) return;
    if (currentView === 'winget') {
      setRows([]);
      setSelectedIndex(null);
      setDetailsSummary('WinGet migration workspace');
      setDetailsText('Review migration candidates, standardize packaging, and drive safer rollout decisions from one workspace.');
      void loadMigrationCandidates();
      return;
    }
    void loadView(currentView);
    if (currentView === 'dashboard') void loadDashboardImpact();
  }, [auth.connected, auth.mockMode, currentView]);

  useEffect(() => {
    if (selectedIndex === null) return;
    const row = rows[selectedIndex];
    if (!row) return;

    setDetailsSummary(toText(row['name'] ?? row['deviceName'] ?? row['displayName'] ?? row['appName'] ?? 'Row selected'));
    setDetailsText(toText(row['details'] ?? row));
  }, [selectedIndex, rows]);

  useEffect(() => {
    const appId = String(selectedAppRow?.id ?? '').trim();
    if (!appId) {
      setAppAudit(null);
      return;
    }
    void loadAppAudit(appId);
  }, [selectedAppRow?.id]);

  async function onRefresh() {
    setStatusMessage('Refreshing workspace...');
    await refreshData();
    if (currentView === 'winget') {
      await loadMigrationCandidates();
      setStatusMessage('WinGet workspace refreshed.');
      pushToast('success', 'WinGet workspace refreshed.');
      return;
    }
    await loadView(currentView);
    if (currentView === 'dashboard') await loadDashboardImpact();
    pushToast('success', 'Workspace refreshed.');
  }

  async function onDisconnect() {
    await api.post('/auth/logout');
    setAuth({ connected: false, upn: '', tenantId: '', displayName: '', mockMode: false, hasWritePermissions: false, scopes: [] });
  }

  async function runPermissionCheck() {
    if (!auth.connected) return;
    try {
      setPermissionCheckLoading(true);
      setStatusMessage('Checking permissions...');
      pushToast('info', 'Checking permissions in the background...');
      const readiness = await getPlatformReadiness();
      setPermissionCheck(readiness);
      setPermissionCheckOpen(true);
      setStatusMessage('Permission check completed.');
      pushToast('success', 'Permission check completed.');
    } catch (error) {
      const message = (error as Error)?.message || 'Permission check failed.';
      setStatusMessage(message);
      pushToast('error', message);
    } finally {
      setPermissionCheckLoading(false);
    }
  }

  function openUpgradeModal(action: string) {
    setUpgradeAction(action);
    setUpgradeModalOpen(true);
    if (auth.connected) void runPermissionCheck();
  }

  function requestWritePermissions() {
    window.location.href = '/api/auth/login?elevated=true';
  }

  function onExport(format: 'json' | 'csv') {
    window.open(`/api/export?view=${currentView}&format=${format}`, '_blank');
  }

  function onPickImageClick() {
    fileInputRef.current?.click();
  }

  function onOcrFilePicked(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setOcrSelectedFile(file);
    setOcrStatus('Image selected');
    setOcrAnswer('');
    setOcrUploadError('');
    e.target.value = '';
  }

  async function onRunOcr() {
    if (!ocrSelectedFile) {
      setOcrUploadError('Pick an image first.');
      return;
    }

    try {
      setOcrUploadError('');
      setOcrUploadBusy(true);
      setOcrStatus('Running');
      const result = await recognize(ocrSelectedFile, 'eng');
      const text = (result?.data?.text ?? '').trim();

      if (!text) {
        setOcrStatus('Failed');
        setOcrUploadError('No text was detected in the screenshot.');
        return;
      }

      setOcrManualText(text);
      setOcrStatus('Done');
    } catch (e) {
      console.error('Run OCR failed:', e);
      setOcrStatus('Failed');
      setOcrUploadError((e as any)?.message ?? 'Run OCR failed.');
    } finally {
      setOcrUploadBusy(false);
    }
  }

  async function onGetExplanation() {
    const text = (ocrManualText ?? '').trim();
    if (!text) {
      setOcrUploadError('Paste text or run OCR first.');
      return;
    }

    try {
      setOcrUploadError('');
      setOcrUploadBusy(true);
      const explain = await api.post('/ocr/explain', { text });
      const payload = explain?.data ?? {};

      const answer =
        `Category: ${payload.category ?? 'Unknown'}\n` +
        `Confidence: ${payload.confidence ?? 0}\n\n` +
        `Cause:\n${payload.cause ?? ''}\n\n` +
        `Recommended actions:\n${
          Array.isArray(payload.recommendedActions)
            ? payload.recommendedActions.map((x: string, i: number) => `${i + 1}. ${x}`).join('\n')
            : ''
        }\n\n` +
        `Evidence:\n${payload.evidence ? JSON.stringify(payload.evidence, null, 2) : ''}`;

      setOcrAnswer(answer);
      setStatusMessage('OCR explanation generated.');
    } catch (e) {
      console.error('Get explanation failed:', e);
      const msg = (e as any)?.response?.data?.message || (e as any)?.message || 'Get explanation failed.';
      setOcrUploadError(msg);
    } finally {
      setOcrUploadBusy(false);
    }
  }

  function updateVisibleColumns(next: string[]) {
    setVisibleColumnsByView((prev) => ({ ...prev, [currentView]: next }));
  }

  function onToggleColumn(header: string) {
    const current = visibleHeaders;
    if (current.includes(header)) {
      const next = current.filter((item) => item !== header);
      if (next.length === 0) return;
      updateVisibleColumns(next);
      return;
    }
    const next = allHeaders.filter((item) => current.includes(item) || item === header);
    updateVisibleColumns(next);
  }

  function resetColumnsToDefault() {
    const defaults = (defaultColumns[currentView] ?? []).filter((header) => allHeaders.includes(header));
    updateVisibleColumns(defaults.length > 0 ? defaults : allHeaders);
  }

  function selectAllColumns() {
    updateVisibleColumns(allHeaders);
  }

  async function openAppDetails(row: Row | null) {
    if (!row) return;
    const appId = String(row.id ?? '').trim();
    setAppContextMenu({ open: false, x: 0, y: 0, row: null });
    setAppDetails({ open: true, row });

    if (!appId) return;

    try {
      const [liveDetails, audit] = await Promise.all([getAppDetails(appId), getAppAudit(appId)]);
      setAppAudit(audit);
      setAppDetails({ open: true, row: { ...row, ...liveDetails } });
    } catch (error) {
      const message = (error as any)?.response?.data?.message || (error as Error)?.message || 'Failed to load app details.';
      setStatusMessage(message);
      pushToast('error', message);
    }
  }

  async function openAssignmentManager(row: Row | null) {
    if (!row) return;
    if (!auth.hasWritePermissions) {
      openUpgradeModal('assignment');
      return;
    }
    const appId = String(row.id ?? '').trim();
    const appName = String(row.name ?? row.appName ?? appId);
    setAppContextMenu({ open: false, x: 0, y: 0, row: null });
    setAssignmentManager({ open: true, loading: true, busy: false, error: '', row, assignments: [], selectedIds: [] });

    try {
      const result = await getAppAssignments(appId);
      const rows = Array.isArray(result.rows) ? result.rows : [];
      setAssignmentManager({
        open: true,
        loading: false,
        busy: false,
        error: rows.length ? '' : result.message || `No assignments found for ${appName}.`,
        row,
        assignments: rows,
        selectedIds: rows.filter((assignment) => assignment.intent !== 'uninstall').map((assignment) => assignment.id)
      });
    } catch (error) {
      const message = (error as any)?.response?.data?.message || (error as Error)?.message || 'Failed to load assignments.';
      setAssignmentManager({ open: true, loading: false, busy: false, error: message, row, assignments: [], selectedIds: [] });
    }
  }

  function openUninstallDialog(row: Row | null) {
    void openAssignmentManager(row);
  }

  function toggleAssignmentSelection(id: string) {
    setAssignmentManager((prev) => ({
      ...prev,
      selectedIds: prev.selectedIds.includes(id) ? prev.selectedIds.filter((item) => item !== id) : [...prev.selectedIds, id]
    }));
  }

  async function onConfirmUninstall() {
    if (!assignmentManager.row) return;
    const row = assignmentManager.row;
    const appId = String(row.id ?? '').trim();
    const appName = String(row.name ?? row.appName ?? appId);

    if (!appId) {
      setAssignmentManager((prev) => ({ ...prev, error: 'Missing app ID.' }));
      return;
    }

    try {
      setAssignmentManager((prev) => ({ ...prev, busy: true, error: '' }));
      const result = await uninstallApp({ id: appId, name: appName, assignmentIds: assignmentManager.selectedIds });
      setStatusMessage(result.message || `Uninstall requested for ${appName}.`);
      setDetailsSummary(`${appName} uninstall`);
      setDetailsText(result.note ? `${result.message}

${result.note}` : result.message);
      setAssignmentManager({ open: false, loading: false, busy: false, error: '', row: null, assignments: [], selectedIds: [] });
      setUninstallState({ open: false, row: null, busy: false, error: '' });
    } catch (error) {
      const message = (error as any)?.response?.data?.message || (error as Error)?.message || 'Uninstall request failed.';
      setAssignmentManager((prev) => ({ ...prev, busy: false, error: message }));
    }
  }

  function openWingetStudio(mode: 'deploy' | 'update', row?: Row | null) {
    const selected = row && String(row.wingetId ?? '').trim()
      ? {
          packageIdentifier: String(row.wingetId),
          name: String(row.name ?? row.appName ?? row.wingetId),
          publisher: String(row.publisher ?? String(row.wingetId).split('.')[0] ?? ''),
          sourceUrl: 'https://winget.run'
        }
      : null;

    setWingetStudio({
      open: true,
      mode,
      loading: false,
      busy: false,
      error: '',
      message: '',
      query: selected?.packageIdentifier ?? '',
      results: selected ? [selected] : [],
      selected,
      installIntent: 'required',
      runAsAccount: 'system',
      updateMode: 'manual',
      groupQuery: '',
      groupResults: [],
      targets: [],
      reuseAssignments: true,
      readiness: null
    });
    void loadPlatformReadiness();
  }

  async function loadPlatformReadiness() {
    try {
      const readiness = await getPlatformReadiness();
      setWingetStudio((prev) => ({ ...prev, readiness }));
    } catch (error) {
      const message = (error as any)?.response?.data?.message || (error as Error)?.message || 'Readiness check failed.';
      setWingetStudio((prev) => ({ ...prev, readiness: null, error: prev.error || message }));
    }
  }

  async function onSearchWingetCatalog() {
    if (!wingetStudio.query.trim()) return;
    setWingetStudio((prev) => ({ ...prev, loading: true, error: '', message: 'Searching WinGet catalog…' }));
    try {
      const result = await searchWingetPackages(wingetStudio.query.trim());
      setWingetStudio((prev) => ({
        ...prev,
        loading: false,
        results: result.rows ?? [],
        selected: (result.rows ?? [])[0] ?? prev.selected,
        message: result.message || 'Search completed.'
      }));
    } catch (error) {
      const message = (error as any)?.response?.data?.message || (error as Error)?.message || 'WinGet search failed.';
      setWingetStudio((prev) => ({ ...prev, loading: false, groupResults: [], error: message, message }));
    }
  }

  async function onSearchGroups() {
    if (!wingetStudio.groupQuery.trim()) return;
    setWingetStudio((prev) => ({ ...prev, loading: true, error: '', message: 'Searching Entra groups…' }));
    try {
      const result = await searchGroups(wingetStudio.groupQuery.trim());
      setWingetStudio((prev) => ({
        ...prev,
        loading: false,
        error: '',
        groupResults: result.rows ?? [],
        message: result.message || 'Groups loaded.',
        readiness: (result as any).readiness ?? prev.readiness
      }));
    } catch (error) {
      const message = (error as any)?.response?.data?.message || (error as Error)?.message || 'Group search failed.';
      setWingetStudio((prev) => ({ ...prev, loading: false, error: message, message }));
    }
  }

  function addWingetTarget(group: GroupSearchRecord, targetType: 'users' | 'devices') {
    setWingetStudio((prev) => {
      if (prev.targets.some((target) => target.groupId === group.id && target.targetType === targetType)) return prev;
      return { ...prev, targets: [...prev.targets, { groupId: group.id, displayName: group.displayName, targetType }] };
    });
  }

  function addManualWingetTarget(targetType: 'users' | 'devices') {
    const raw = wingetStudio.groupQuery.trim();
    if (!raw) return;
    setWingetStudio((prev) => {
      if (prev.targets.some((target) => target.groupId === raw && target.targetType === targetType)) return prev;
      return { ...prev, targets: [...prev.targets, { groupId: raw, displayName: raw, targetType }] };
    });
  }

  function removeWingetTarget(groupId: string) {
    setWingetStudio((prev) => ({ ...prev, targets: prev.targets.filter((target) => target.groupId !== groupId) }));
  }

  async function onSubmitWinget() {
    if (!wingetStudio.selected?.packageIdentifier && !wingetStudio.query.trim()) {
      setWingetStudio((prev) => ({ ...prev, error: 'Choose a WinGet package or paste a package ID.' }));
      return;
    }

    const packageIdentifier = wingetStudio.selected?.packageIdentifier ?? wingetStudio.query.trim();
    const displayName = wingetStudio.selected?.name ?? packageIdentifier;
    const publisher = wingetStudio.selected?.publisher ?? packageIdentifier.split('.')[0] ?? 'Unknown';

    const appsRwCheck = wingetStudio.readiness?.checks.find((item) => item.id === 'apps-rw');
    if (wingetStudio.readiness && !wingetStudio.readiness.mockMode && appsRwCheck && !appsRwCheck.ok) {
      setWingetStudio((prev) => ({ ...prev, error: appsRwCheck.detail }));
      return;
    }

    try {
      setWingetStudio((prev) => ({
        ...prev,
        busy: true,
        error: '',
        message: prev.mode === 'deploy' ? 'Creating WinGet app in Intune…' : 'Creating WinGet replacement app…'
      }));

      const payload = {
        packageIdentifier,
        displayName,
        publisher,
        installIntent: wingetStudio.installIntent,
        runAsAccount: wingetStudio.runAsAccount,
        updateMode: wingetStudio.updateMode,
        targets: wingetStudio.targets,
        reuseAssignments: wingetStudio.reuseAssignments
      };

      const result = wingetStudio.mode === 'deploy'
        ? await deployWingetApp(payload)
        : await linkWingetToExistingApp(String(selectedAppRow?.id ?? ''), payload);

      const createdLabel =
        (result as any)?.displayName ||
        (result as any)?.appName ||
        displayName ||
        packageIdentifier;

      const successMessage =
        (result as any)?.message ||
        (wingetStudio.mode === 'deploy'
          ? `WinGet app "${createdLabel}" was created successfully.`
          : `WinGet replacement app "${createdLabel}" was created successfully.`);

      setWingetStudio((prev) => ({
        ...prev,
        busy: false,
        error: '',
        message: successMessage
      }));

      setStatusMessage(successMessage);
      pushToast('success', successMessage);

      await loadView('apps');
      await loadMigrationCandidates();
    } catch (error) {
      const message = (error as any)?.response?.data?.message || (error as Error)?.message || 'WinGet action failed.';
      setWingetStudio((prev) => ({ ...prev, busy: false, error: message, message }));
      pushToast('error', message);
    }
  }

  async function onCopyValue(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setStatusMessage('Copied to clipboard.');
    } catch {
      setStatusMessage('Clipboard copy failed.');
    }
  }

  function onAppRowContextMenu(event: MouseEvent<HTMLTableRowElement>, row: Row) {
    if (currentView !== 'apps') return;
    event.preventDefault();
    const actualIndex = rows.findIndex((candidate) => candidate === row);
    setSelectedIndex(actualIndex >= 0 ? actualIndex : 0);
    setAppContextMenu({ open: true, x: event.clientX, y: event.clientY, row });
  }

  const canUseApp = auth.connected || auth.mockMode;

  return (
    <div className="app-shell">
      <div className="hero-shell">
        <div className="hero-grid">
          <div className="brand-mark">
            <img src="/logo.png" alt="Modern Endpoint logo" className="brand-logo" />
            <div>
              <div className="brand-title">Modern Endpoint</div>
              <div className="brand-subtitle">Enterprise Architecture Journal</div>
            </div>
          </div>

          <div className="hero-copy">
            <div className="eyebrow">Enterprise SaaS Console</div>
            <h1 className="hero-title">Intune Install Status & Remediation</h1>
            <div className="hero-meta">
              <span className="hero-chip">{currentViewMeta.icon} {currentViewMeta.label}</span>
              <span className="hero-chip subtle">{currentViewMeta.short}</span>
              {auth.mockMode ? <span className="hero-chip warning">Mock mode</span> : null}
            </div>
          </div>

          <div className="hero-actions">
            <div className="account-card">
              <div className="account-label">Session</div>
              <div className="account-value">{canUseApp ? (auth.displayName || auth.upn || 'Connected') : 'Not connected'}</div>
              <div className="account-subvalue">{canUseApp ? (auth.upn || 'Ready to inspect Intune app data') : 'Sign in to use live tenant data'}</div>
              {canUseApp ? (
                auth.hasWritePermissions ? (
                  <span className="status-connected-pill perm-write"><span className="status-dot-pulse" />Write Permissions</span>
                ) : (
                  <button className="perm-readonly-pill" type="button" onClick={() => openUpgradeModal('write')} title="Upgrade to Write Permissions">
                    🔒 Read Only
                  </button>
                )
              ) : null}
            </div>
            <div className="hero-buttons">
              {isMobile ? <button className="btn btn-ghost icon-only" onClick={() => setSidebarOpen(true)}>☰</button> : null}
              {!canUseApp ? (
                <button className="btn btn-primary" onClick={() => { window.location.href = '/api/auth/login'; }}>
                  Sign in
                </button>
              ) : (
                <>
                  <button className="btn btn-secondary" onClick={() => void runPermissionCheck()} disabled={permissionCheckLoading}>
                    {permissionCheckLoading ? 'Checking...' : 'Check permissions'}
                  </button>
                  <button className="btn btn-secondary" onClick={onRefresh}>Refresh</button>
                  <button className="btn btn-ghost" onClick={onDisconnect}>Disconnect</button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {isMobile && (
        <div className="mobile-subbar">
          <span className="mobile-subbar-title">{currentViewMeta.label}</span>
          <span className="mobile-subbar-status">{canUseApp ? (auth.mockMode ? 'Mock mode active' : auth.upn) : 'Not connected'}</span>
        </div>
      )}

      {isMobile && sidebarOpen && (
        <div className="sidebar-drawer-overlay" onClick={() => setSidebarOpen(false)}>
          <div className="sidebar-drawer" onClick={(e) => e.stopPropagation()}>
            <button className="drawer-close-btn" onClick={() => setSidebarOpen(false)}>✕</button>
            <div className="nav-list">
              {views.map((view) => (
                <button
                  key={view.id}
                  className={`nav-btn ${currentView === view.id ? 'active' : ''}`}
                  onClick={() => { setCurrentView(view.id); setSidebarOpen(false); }}
                >
                  <span className="nav-icon">{view.icon}</span>
                  <span className="nav-copy">
                    <span className="nav-label">{view.label}</span>
                    <span className="nav-short">{view.short}</span>
                  </span>
                </button>
              ))}
              <div className="section-divider" />
              {canUseApp ? (
                <>
                  <button className="btn btn-secondary block" onClick={() => void runPermissionCheck()}>Check permissions</button>
                  <button className="btn btn-secondary block" onClick={onRefresh}>Refresh</button>
                  <button className="btn btn-ghost block" onClick={onDisconnect}>Disconnect</button>
                </>
              ) : null}
              <button className="btn btn-export" onClick={() => { onExport('csv'); setSidebarOpen(false); }} disabled={!canUseApp}>Export CSV</button>
              <button className="btn btn-export" onClick={() => { onExport('json'); setSidebarOpen(false); }} disabled={!canUseApp}>Export JSON</button>
            </div>
          </div>
        </div>
      )}

      <div className="content-grid">
        <aside className="panel sidebar">
          <div className="sidebar-header">
            <div className="sidebar-title">Workspace</div>
            <div className="sidebar-subtitle">Operational views</div>
          </div>
          <div className="nav-list">
            {views.map((view) => (
              <button key={view.id} className={`nav-btn ${currentView === view.id ? 'active' : ''}`} onClick={() => setCurrentView(view.id)}>
                <span className="nav-icon">{view.icon}</span>
                <span className="nav-copy">
                  <span className="nav-label">{view.label}</span>
                  <span className="nav-short">{view.short}</span>
                </span>
              </button>
            ))}

            <div className="section-divider" />
            <button className="btn btn-export" onClick={() => onExport('csv')} disabled={!canUseApp}>Export CSV</button>
            <button className="btn btn-export" onClick={() => onExport('json')} disabled={!canUseApp}>Export JSON</button>
          </div>
        </aside>

        <main className="main-stage">
          {dashboardStats.length > 0 ? (
            <div className="stats-grid">
              {dashboardStats.map((stat) => (
                <div key={stat.label} className={`stat-card ${stat.tone ?? ''}`}>
                  <div className="stat-label">{stat.label}</div>
                  <div className="stat-value">{stat.value}</div>
                </div>
              ))}
            </div>
          ) : null}

          {currentView === 'dashboard' && dashboardImpact ? (
            <div className="dashboard-impact-grid">
              <div className="info-card impact-card accent">
                <div className="section-title">Impact summary</div>
                <div className="summary-text">{dashboardImpact.impactSummary}</div>
                <div className="summary-text muted">Focus the team on the highest-impact app failures first, not isolated events.</div>
              </div>

              <div className="info-card impact-card">
                <div className="section-title">Recommended remediation queue</div>
                {(dashboardImpact.remediationQueue ?? []).length > 0 ? (
                  <div className="detail-list">
                    {(dashboardImpact.remediationQueue ?? []).slice(0, 4).map((item) => (
                      <div key={item.action} className="detail-row">
                        <div className="detail-key">{item.action}</div>
                        <div className="detail-value">{item.count} clusters</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="summary-text muted">
                    No remediation actions are currently queued. Queue items appear when repeated app failures cross impact thresholds.
                  </div>
                )}
              </div>

              <div className="info-card impact-card">
                <div className="section-title">Apps with highest impact</div>
                {(dashboardImpact.appsNeedingAttention ?? []).length > 0 ? (
                  <div className="detail-list">
                    {(dashboardImpact.appsNeedingAttention ?? []).slice(0, 4).map((item) => (
                      <div key={item.name} className="detail-row">
                        <div className="detail-key">{item.name}</div>
                        <div className="detail-value">{item.impacted} endpoints · {item.count} failures</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="summary-text muted">
                    No apps are currently crossing the high-impact threshold in this reporting window.
                  </div>
                )}
              </div>

              <div className="info-card impact-card">
                <div className="section-title">Proof layer</div>
                <div className="detail-list">
                  <div className="detail-row"><div className="detail-key">Improved endpoints</div><div className="detail-value">{String(dashboardImpact.valueProof?.improvedCountEstimate ?? '—')}</div></div>
                  <div className="detail-row"><div className="detail-key">Unresolved remainder</div><div className="detail-value">{String(dashboardImpact.valueProof?.unresolvedRemainder ?? '—')}</div></div>
                  <div className="detail-row"><div className="detail-key">Verification confidence</div><div className="detail-value">{dashboardImpact.valueProof?.verificationConfidence ? `${dashboardImpact.valueProof.verificationConfidence}%` : '—'}</div></div>
                </div>
                <div className="summary-text muted">
                  Based on post-remediation status improvement trend across the current data window.
                </div>
              </div>
            </div>
          ) : null}

          <section className="panel main">
            <div className="panel-toolbar panel-toolbar-top">
              <div>
                <div className="panel-eyebrow">Data explorer</div>
                <div className="panel-title">{currentViewMeta.label}</div>
              </div>
              <div className="toolbar-right">
                <div className="panel-caption">{statusMessage}</div>
                {currentView !== 'ocr' && rows.length > 0 ? (
                  <button className="btn btn-secondary toolbar-btn" onClick={() => setColumnsOpen((s) => !s)}>
                    Columns · {visibleHeaders.length}/{allHeaders.length}
                  </button>
                ) : null}
              </div>
            </div>

            {currentView === 'apps' && rows.length > 0 ? (
              <div className="panel-subtoolbar">
                <div className="segmented-control" role="tablist" aria-label="Apps platform filter">
                  {[
                    { id: 'all', label: 'All' },
                    { id: 'windows', label: 'Windows' },
                    { id: 'mobile', label: 'Mobile' },
                    { id: 'mac', label: 'macOS' }
                  ].map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={`segment-btn ${appsPlatformFilter === option.id ? 'active' : ''}`}
                      onClick={() => setAppsPlatformFilter(option.id as PlatformFilter)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <div className="panel-caption">{filteredRows.length} apps shown</div>
                <button className="btn btn-secondary toolbar-btn" type="button" onClick={() => openWingetStudio('deploy')}>Deploy from WinGet</button>
              </div>
            ) : null}

            {columnsOpen && currentView !== 'ocr' && rows.length > 0 ? (
              <div className="columns-popover">
                <div className="columns-popover-header">
                  <div>
                    <div className="section-title">Visible fields</div>
                    <div className="panel-caption">Choose the fields that matter for this view.</div>
                  </div>
                  <button className="btn btn-ghost icon-only" onClick={() => setColumnsOpen(false)} type="button">✕</button>
                </div>
                <input
                  className="column-search"
                  value={columnSearch}
                  onChange={(e) => setColumnSearch(e.target.value)}
                  placeholder="Search fields..."
                />
                <div className="columns-actions">
                  <button className="text-btn" type="button" onClick={selectAllColumns}>Select all</button>
                  <button className="text-btn" type="button" onClick={resetColumnsToDefault}>Reset default</button>
                </div>
                <div className="columns-list">
                  {filteredColumnOptions.map((header) => {
                    const checked = visibleHeaders.includes(header);
                    return (
                      <label key={header} className="column-option">
                        <input type="checkbox" checked={checked} onChange={() => onToggleColumn(header)} />
                        <span>{toLabel(header)}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {currentView === 'winget' ? (
              <Win32UtilityWorkspace />
            ) : currentView === 'ocr' ? (

              <div className="ocr-assistant">
                <div className="ocr-assistant-header">
                  <div>
                    <div className="ocr-assistant-title">OCR & Error Assistant</div>
                    <div className="ocr-assistant-subtitle">Upload a screenshot or paste an error, then get actionable remediation guidance.</div>
                  </div>
                  <div className={`ocr-status-pill ${ocrStatus === 'Failed' ? 'bad' : ''}`}>OCR: {ocrStatus}</div>
                </div>

                <div className="ocr-assistant-actions">
                  <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/jpg" onChange={onOcrFilePicked} style={{ display: 'none' }} />
                  <button className="btn btn-secondary" onClick={onPickImageClick} disabled={!canUseApp || ocrUploadBusy}>Pick Image</button>
                  <button className="btn btn-secondary" onClick={onRunOcr} disabled={!canUseApp || ocrUploadBusy}>Run OCR</button>
                  <button className="btn btn-primary" onClick={onGetExplanation} disabled={!canUseApp || ocrUploadBusy}>Get Explanation</button>
                  {ocrUploadError ? <span className="ocr-error">{ocrUploadError}</span> : null}
                </div>

                <div className="ocr-assistant-grid">
                  <div className="ocr-box">
                    <div className="ocr-box-title">OCR / Manual Input</div>
                    <textarea className="ocr-textarea" value={ocrManualText} onChange={(e) => setOcrManualText(e.target.value)} placeholder="Paste error text manually or run OCR from image..." />
                  </div>
                  <div className="ocr-box">
                    <div className="ocr-box-title">Assistant Answer</div>
                    <textarea className="ocr-textarea" value={ocrAnswer} onChange={(e) => setOcrAnswer(e.target.value)} placeholder="No explanation yet. Pick image or paste text, then click Get Explanation." />
                  </div>
                </div>
              </div>
            ) : filteredRows.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-title">No rows returned</div>
                <div>{currentView === 'apps' && appsPlatformFilter !== 'all' ? `No ${appsPlatformFilter} apps matched the current filter.` : statusMessage}</div>
              </div>
            ) : (
              <div className="table-shell">
                <table className="data-table">
                  <thead>
                    <tr>
                      {visibleHeaders.map((header) => <th key={header}>{toLabel(header)}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row, index) => (
                      <tr
                        key={String(row['id'] ?? `${currentView}-${index}`)}
                        className={`table-row ${selectedIndex === index ? 'active' : ''} ${currentView === 'apps' ? 'table-row-app' : ''}`}
                        onClick={() => {
                          const actualIndex = rows.findIndex((candidate) => candidate === row);
                          setSelectedIndex(actualIndex >= 0 ? actualIndex : index);
                          setDetailsSummary(toText(row['name'] ?? row['deviceName'] ?? row['displayName'] ?? row['appName'] ?? 'Row selected'));
                          setDetailsText(toText(row['details'] ?? row));
                        }}
                        onDoubleClick={() => {
                          if (currentView === 'apps') openAppDetails(row);
                        }}
                        onContextMenu={(event) => onAppRowContextMenu(event, row)}
                      >
                        {visibleHeaders.map((header) => <td key={`${String(row['id'] ?? index)}-${header}`}>{toText(row[header])}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {currentView === 'apps' && selectedAppRow && appAudit ? (
            <section className="panel main phase1-audit-section">
              <div className="panel-toolbar panel-toolbar-top">
                <div>
                  <div className="panel-eyebrow">Operational audit</div>
                  <div className="panel-title">Failure clustering, remediation, and verification</div>
                </div>
                <div className="panel-caption">
                  {toText(selectedAppRow.name ?? selectedAppRow.appName ?? 'Selected app')}
                </div>
              </div>

              <Phase1AuditPanels audit={appAudit} />
            </section>
          ) : null}
        </main>

        <aside className="panel right">
          <div className="right-top">
            <div>
              <div className="panel-eyebrow">AI copilot</div>
              <div className="panel-title small">Investigation workspace</div>
            </div>
            {auth.mockMode ? <span className="hero-chip warning compact">Mock</span> : null}
          </div>

          <div className="right-actions">
            <button className="btn btn-ai" onClick={() => setAiPanel({ open: true, action: 'explain', row: selectedRow })} disabled={!canUseApp || selectedIndex === null} type="button">
              Ask Intune Architect AI
            </button>
            <button className="btn btn-runbook" onClick={() => setAiPanel({ open: true, action: 'runbook', row: selectedRow })} disabled={!canUseApp || selectedIndex === null} type="button">
              Runbook
            </button>
          </div>

          {currentView === 'apps' ? (
            <div className="right-actions tertiary">
              <button className="btn btn-secondary" onClick={() => openAppDetails(selectedRow)} disabled={!selectedRow} type="button">
                App details
              </button>
              <button className="btn btn-secondary" onClick={() => openAssignmentManager(selectedRow)} disabled={!selectedRow} type="button">
                Assignments
              </button>
              <button className="btn btn-ghost" onClick={() => openWingetStudio('update', selectedRow)} disabled={!selectedRow} type="button">
                WinGet studio
              </button>
            </div>
          ) : null}

          <div className="info-card summary-card">
            <div className="section-title">Summary</div>
            <div className="summary-text">{detailsSummary}</div>
          </div>

          {currentView === 'dashboard' && dashboardImpact ? (
            <div className="info-card">
              <div className="section-title">Management reporting</div>
              <div className="summary-text muted">{dashboardImpact.impactSummary}</div>
            </div>
          ) : null}

          {currentView === 'apps' && appAudit ? (
            <div className="info-card">
              <div className="section-title">App reliability</div>
              <div className="detail-list">
                {appReliabilityHighlights.map((item) => (
                  <div key={item.label} className="detail-row"><div className="detail-key">{item.label}</div><div className="detail-value">{item.value}</div></div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="info-card">
            <div className="section-title">Field highlights</div>
            <div className="detail-list">
              {detailEntries.length > 0 ? detailEntries.map((entry) => (
                <div key={entry.key} className="detail-row">
                  <div className="detail-key">{entry.key}</div>
                  <div className="detail-value">{entry.value}</div>
                </div>
              )) : <div className="summary-text muted">Select a row to inspect structured details.</div>}
            </div>
          </div>

          <div className="info-card roadmap-card">
            <div className="section-title">Next phase</div>
            <div className="summary-text muted">
              Manage assignments before uninstall, deploy directly from WinGet, and prepare replacement WinGet apps for legacy packages from one workspace.
            </div>
          </div>

          <div className="info-card">
            <div className="section-title">Raw details</div>
            <pre className="details-block">{detailsText}</pre>
          </div>
        </aside>
      </div>

      {appContextMenu.open && appContextMenu.row ? (
        <div
          className="context-menu"
          style={{ top: appContextMenu.y, left: appContextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button className="context-menu-item" type="button" onClick={() => openAppDetails(appContextMenu.row)}>Open app details</button>
          <button className="context-menu-item" type="button" onClick={() => openAssignmentManager(appContextMenu.row)}>Manage assignments</button>
          <button className="context-menu-item" type="button" onClick={() => openWingetStudio('update', appContextMenu.row)}>Create WinGet replacement</button>
          <button className="context-menu-item" type="button" onClick={() => void onCopyValue(String(appContextMenu.row?.id ?? ''))}>Copy app ID</button>
          {String(appContextMenu.row?.wingetId ?? '').trim() ? (
            <button className="context-menu-item" type="button" onClick={() => void onCopyValue(String(appContextMenu.row?.wingetId ?? ''))}>Copy Winget ID</button>
          ) : null}
        </div>
      ) : null}

      {appDetails.open && selectedAppRow ? (
        <div className="modal-overlay" onClick={() => setAppDetails({ open: false, row: null })}>
          <div className="app-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="app-drawer-header">
              <div>
                <div className="panel-eyebrow">Application details</div>
                <div className="panel-title">{toText(selectedAppRow.name ?? selectedAppRow.appName ?? 'Selected app')}</div>
                <div className="panel-caption">{toText(selectedAppRow.publisher ?? '')}</div>
              </div>
              <button className="btn btn-ghost icon-only" type="button" onClick={() => setAppDetails({ open: false, row: null })}>✕</button>
            </div>

            <div className="app-drawer-grid">
              {appDetailCards.map((card) => (
                <div key={card.label} className="mini-stat-card">
                  <div className="mini-stat-label">{card.label}</div>
                  <div className="mini-stat-value">{card.value}</div>
                </div>
              ))}
              {appReliabilityHighlights.map((card) => (
                <div key={card.label} className="mini-stat-card">
                  <div className="mini-stat-label">{card.label}</div>
                  <div className="mini-stat-value">{card.value}</div>
                </div>
              ))}
            </div>

            <div className="info-card drawer-card">
              <div className="section-title">Win32 / MSI style metadata</div>
              <div className="detail-list">
                <div className="detail-row"><div className="detail-key">Package identifier</div><div className="detail-value">{toText(selectedAppRow.packageIdentifier ?? 'N/A')}</div></div>
                <div className="detail-row"><div className="detail-key">Install context</div><div className="detail-value">{toText(selectedAppRow.installContext ?? 'N/A')}</div></div>
                <div className="detail-row"><div className="detail-key">Assignment scope</div><div className="detail-value">{toText(selectedAppRow.assignmentScope ?? 'N/A')}</div></div>
                <div className="detail-row"><div className="detail-key">Uninstall command</div><div className="detail-value code">{toText(selectedAppRow.uninstallCommand ?? 'N/A')}</div></div>
                <div className="detail-row"><div className="detail-key">Winget ID</div><div className="detail-value code">{toText(selectedAppRow.wingetId ?? 'Not mapped yet')}</div></div>
              </div>
            </div>

            {appAudit ? (
              <>
                <div className="info-card drawer-card accent">
                  <div className="section-title">Management narrative</div>
                  <div className="summary-text muted">{appAudit.managementNarrative}</div>
                </div>

                <div className="winget-review-grid">
                  <div className="info-card drawer-card">
                    <div className="section-title">Failure clustering</div>
                    <div className="detail-list">
                      {appAudit.clusters.slice(0, 4).map((cluster) => (
                        <div key={cluster.id} className="detail-row stack">
                          <div className="detail-key">{cluster.normalizedCategory} · {cluster.errorCode}</div>
                          <div className="detail-value">{cluster.occurrences} failures · {cluster.impactedTargets} impacted targets</div>
                        </div>
                      ))}
                      {appAudit.clusters.length === 0 ? <div className="summary-text muted">No recurring failure clusters detected for this app.</div> : null}
                    </div>
                  </div>

                  <div className="info-card drawer-card">
                    <div className="section-title">Smart remediation playbooks</div>
                    <div className="detail-list">
                      {appAudit.smartPlaybooks.map((playbook) => (
                        <div key={playbook} className="detail-row stack"><div className="detail-value">{playbook}</div></div>
                      ))}
                      {appAudit.smartPlaybooks.length === 0 ? <div className="summary-text muted">No smart playbooks were suggested yet.</div> : null}
                    </div>
                  </div>

                  <div className="info-card drawer-card">
                    <div className="section-title">Rollout safety</div>
                    <div className="detail-list">
                      <div className="detail-row"><div className="detail-key">Risk level</div><div className="detail-value">{appAudit.rolloutSafety.riskLevel}</div></div>
                      <div className="detail-row stack"><div className="detail-key">Pilot recommendation</div><div className="detail-value">{appAudit.rolloutSafety.pilotRecommendation}</div></div>
                      <div className="detail-row stack"><div className="detail-key">Rollback note</div><div className="detail-value">{appAudit.rolloutSafety.rollbackNote}</div></div>
                    </div>
                  </div>

                  <div className="info-card drawer-card">
                    <div className="section-title">Success verification</div>
                    <div className="detail-list">
                      <div className="detail-row"><div className="detail-key">Improved devices</div><div className="detail-value">{appAudit.verification.improvedDeviceCount}</div></div>
                      <div className="detail-row"><div className="detail-key">Unresolved remainder</div><div className="detail-value">{appAudit.verification.unresolvedRemainder}</div></div>
                      <div className="detail-row"><div className="detail-key">Confidence score</div><div className="detail-value">{appAudit.verification.confidenceScore}%</div></div>
                    </div>
                  </div>
                </div>
              </>
            ) : null}

            <div className="drawer-actions">
              <button className="btn btn-secondary" type="button" onClick={() => void onCopyValue(toText(selectedAppRow.packageIdentifier ?? ''))}>Copy package ID</button>
              <button className="btn btn-secondary" type="button" onClick={() => openAssignmentManager(selectedAppRow)}>Manage assignments</button>
              <button className="btn btn-ghost" type="button" onClick={() => openWingetStudio('update', selectedAppRow)}>Create WinGet replacement</button>
            </div>

            <div className="info-card drawer-card accent">
              <div className="section-title">Next up</div>
              <div className="summary-text muted">Use this app as a source object for assignment-aware uninstall or create a WinGet-managed replacement using the stored Winget ID.</div>
            </div>
          </div>
        </div>
      ) : null}

      {assignmentManager.open ? (
        <div className="modal-overlay" onClick={() => !assignmentManager.busy && setAssignmentManager({ open: false, loading: false, busy: false, error: '', row: null, assignments: [], selectedIds: [] })}>
          <div className="assignment-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="app-drawer-header">
              <div>
                <div className="panel-eyebrow">Assignment-aware uninstall</div>
                <div className="panel-title">{toText(assignmentManager.row?.name ?? assignmentManager.row?.appName ?? 'Selected app')}</div>
                <div className="panel-caption">Select the current user/device group assignments that should switch to uninstall.</div>
              </div>
              <button className="btn btn-ghost icon-only" type="button" onClick={() => setAssignmentManager({ open: false, loading: false, busy: false, error: '', row: null, assignments: [], selectedIds: [] })}>✕</button>
            </div>

            <div className="info-card drawer-card accent">
              <div className="section-title">What changes</div>
              <div className="summary-text muted">Existing Intune assignments are preserved, but their intent is switched to <strong>uninstall</strong> only for the groups you choose.</div>
            </div>

            {assignmentManager.error ? <div className="modal-error">{assignmentManager.error}</div> : null}

            <div className="assignment-list">
              {assignmentManager.loading ? <div className="summary-text muted">Loading assignments…</div> : null}
              {!assignmentManager.loading && assignmentManager.assignments.length === 0 ? <div className="summary-text muted">No assignments were returned for this app.</div> : null}
              {assignmentManager.assignments.map((assignment) => (
                <label key={assignment.id} className="assignment-option">
                  <input
                    type="checkbox"
                    checked={assignmentManager.selectedIds.includes(assignment.id)}
                    onChange={() => toggleAssignmentSelection(assignment.id)}
                    disabled={assignment.intent === 'uninstall'}
                  />
                  <div className="assignment-copy">
                    <div className="assignment-title">{assignment.targetName}</div>
                    <div className="assignment-meta">{assignment.targetType} · {assignment.intent}{assignment.filterInfo ? ` · ${assignment.filterInfo}` : ''}</div>
                  </div>
                  {assignment.intent === 'uninstall' ? <span className="hero-chip warning compact">Already uninstall</span> : null}
                </label>
              ))}
            </div>

            <div className="drawer-actions">
              <button className="btn btn-secondary" type="button" onClick={() => setAssignmentManager((prev) => ({ ...prev, selectedIds: prev.assignments.filter((assignment) => assignment.intent !== 'uninstall').map((assignment) => assignment.id) }))}>Select all active</button>
              <button className="btn btn-danger" type="button" onClick={() => void onConfirmUninstall()} disabled={assignmentManager.busy || assignmentManager.selectedIds.length === 0}>
                {assignmentManager.busy ? 'Applying…' : `Apply uninstall to ${assignmentManager.selectedIds.length} assignment(s)`}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {wingetStudio.open ? (
        <div className="modal-overlay" onClick={() => !wingetStudio.busy && setWingetStudio((prev) => ({ ...prev, open: false }))}>
          <div className="winget-studio" onClick={(e) => e.stopPropagation()}>
            <div className="app-drawer-header">
              <div>
                <div className="panel-eyebrow">App lifecycle · WinGet studio</div>
                <div className="panel-title">{wingetStudio.mode === 'deploy' ? 'Deploy from WinGet' : 'Create WinGet replacement'}</div>
                <div className="panel-caption">{wingetStudio.message}</div>
              </div>
              <button className="btn btn-ghost icon-only" type="button" onClick={() => setWingetStudio((prev) => ({ ...prev, open: false }))}>✕</button>
            </div>

            <div className="winget-steps">
              <div className={`winget-step ${wingetPackageIdentifier ? 'done' : 'active'}`}>1. Package</div>
              <div className={`winget-step ${wingetStudio.installIntent ? 'done' : ''}`}>2. Settings</div>
              <div className={`winget-step ${wingetStudio.targets.length > 0 ? 'done' : wingetGroupSearchHasNoResults ? 'active' : ''}`}>3. Groups</div>
              <div className={`winget-step ${wingetCanSubmit ? 'done' : ''}`}>4. Review</div>
            </div>

            <div className="winget-layout">
              <div className="info-card drawer-card">
                <div className="section-title">1. Package search</div>
                <div className="form-row">
                  <input className="column-search" value={wingetStudio.query} onChange={(e) => setWingetStudio((prev) => ({ ...prev, query: e.target.value }))} placeholder="Search by name or paste Winget package ID" />
                  <button className="btn btn-secondary" type="button" onClick={() => void onSearchWingetCatalog()} disabled={wingetStudio.loading}>Search</button>
                </div>
                <div className="summary-text muted">Paste a package ID directly if catalog search is limited.</div>
                <div className="winget-results">
                  {wingetStudio.results.map((pkg) => (
                    <button
                      key={pkg.packageIdentifier}
                      type="button"
                      className={`winget-result ${wingetStudio.selected?.packageIdentifier === pkg.packageIdentifier ? 'active' : ''}`}
                      onClick={() => setWingetStudio((prev) => ({ ...prev, selected: pkg, query: pkg.packageIdentifier, message: `Selected ${pkg.name}. Review deployment settings and target groups.` }))}
                    >
                      <div className="winget-result-title">{pkg.name}</div>
                      <div className="winget-result-meta">{pkg.publisher} · {pkg.packageIdentifier}</div>
                      <div className="winget-result-submeta">{pkg.latestVersion ? `Latest ${pkg.latestVersion}` : 'WinGet package'}{pkg.moniker ? ` · ${pkg.moniker}` : ''}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="info-card drawer-card">
                <div className="section-title">2. Deployment settings</div>
                <div className="settings-grid">
                  <label className="setting-field"><span>Install intent</span><select value={wingetStudio.installIntent} onChange={(e) => setWingetStudio((prev) => ({ ...prev, installIntent: e.target.value as 'required' | 'available' }))}><option value="required">Required</option><option value="available">Available</option></select></label>
                  <label className="setting-field"><span>Install context</span><select value={wingetStudio.runAsAccount} onChange={(e) => setWingetStudio((prev) => ({ ...prev, runAsAccount: e.target.value as 'system' | 'user' }))}><option value="system">System</option><option value="user">User</option></select></label>
                  <label className="setting-field"><span>Update mode</span><select value={wingetStudio.updateMode} onChange={(e) => setWingetStudio((prev) => ({ ...prev, updateMode: e.target.value as 'auto' | 'manual' }))}><option value="manual">Manual lifecycle</option><option value="auto">Managed updates</option></select></label>
                  {wingetStudio.mode === 'update' ? <label className="setting-toggle"><input type="checkbox" checked={wingetStudio.reuseAssignments} onChange={(e) => setWingetStudio((prev) => ({ ...prev, reuseAssignments: e.target.checked }))} />Reuse assignments from the selected app</label> : null}
                </div>
                <div className="setting-hints">
                  <span className="info-badge">Intent: {wingetStudio.installIntent}</span>
                  <span className="info-badge">Context: {wingetStudio.runAsAccount}</span>
                  <span className="info-badge">Lifecycle: {wingetStudio.updateMode === 'auto' ? 'Managed updates' : 'Manual lifecycle'}</span>
                </div>
              </div>

              <div className="info-card drawer-card">
                <div className="section-title">3. Groups</div>
                <div className="form-row">
                  <input className="column-search" value={wingetStudio.groupQuery} onChange={(e) => setWingetStudio((prev) => ({ ...prev, groupQuery: e.target.value }))} placeholder="Search group name or paste group ID" />
                  <button className="btn btn-secondary" type="button" onClick={() => void onSearchGroups()} disabled={wingetStudio.loading}>Find</button>
                </div>
                <div className="drawer-actions compact">
                  <button className="btn btn-ghost" type="button" onClick={() => addManualWingetTarget('devices')}>Add as device group</button>
                  <button className="btn btn-ghost" type="button" onClick={() => addManualWingetTarget('users')}>Add as user group</button>
                </div>
                {wingetGroupSearchHasNoResults ? (
                  <div className="winget-empty-state">
                    <div className="winget-empty-title">No group matches returned.</div>
                    <div className="summary-text muted">You can still paste a group object ID and add it manually. If this keeps happening in live mode, validate Microsoft Graph group read permission and admin consent. The readiness panel on the right shows exactly what is missing.</div>
                    <ul className="winget-checklist">
                      <li>Check delegated directory/group read access.</li>
                      <li>Reconnect after granting admin consent.</li>
                      <li>Use a direct Entra group ID as a fallback.</li>
                    </ul>
                  </div>
                ) : null}
                <div className="winget-results small">
                  {wingetStudio.groupResults.map((group) => (
                    <div key={group.id} className="winget-result row">
                      <div>
                        <div className="winget-result-title">{group.displayName}</div>
                        <div className="winget-result-meta">{group.id}</div>
                        {group.description ? <div className="winget-result-submeta">{group.description}</div> : null}
                      </div>
                      <div className="drawer-actions compact">
                        <button className="btn btn-secondary" type="button" onClick={() => addWingetTarget(group, 'devices')}>Device</button>
                        <button className="btn btn-ghost" type="button" onClick={() => addWingetTarget(group, 'users')}>User</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="winget-review-grid">
              <div className="info-card drawer-card">
                <div className="section-title">4. Review deployment</div>
                <div className="review-grid compact-two">
                  <div className="review-item"><span>Package</span><strong>{wingetPackageName}</strong><em>{wingetPackageIdentifier || 'Paste a package ID or choose from search results.'}</em></div>
                  <div className="review-item"><span>Publisher</span><strong>{wingetPublisher}</strong><em>{wingetStudio.mode === 'update' ? `Replacement for ${wingetSelectedSourceName}` : 'New Intune WinGet app'}</em></div>
                  <div className="review-item"><span>Assignments</span><strong>{wingetStudio.targets.length}</strong><em>{wingetDeviceTargets.length} device groups · {wingetUserTargets.length} user groups</em></div>
                  <div className="review-item"><span>Update path</span><strong>{wingetStudio.updateMode === 'auto' ? 'Managed updates' : 'Manual lifecycle'}</strong><em>{wingetStudio.mode === 'update' && wingetStudio.reuseAssignments ? 'Will reuse source app assignments when available.' : 'New assignments only.'}</em></div>
                </div>
                <div className="readiness-list">
                  {wingetReadyChecks.map((item) => (
                    <div key={item.label} className={`readiness-item ${item.ok ? 'ok' : ''}`}>
                      <span>{item.ok ? '✓' : '•'}</span>
                      <span>{item.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="info-card drawer-card">
                <div className="section-title">Environment readiness</div>
                <div className="readiness-list detailed">
                  {wingetStudio.readiness ? readinessChecks.map((item) => (
                    <div key={item.id} className={`readiness-item ${item.ok ? 'ok' : 'warn'}`}>
                      <div className="readiness-copy">
                        <strong>{item.label}</strong>
                        <span>{item.detail}</span>
                      </div>
                      <em>{item.ok ? 'Ready' : 'Action needed'}</em>
                    </div>
                  )) : <div className="summary-text muted">Checking permissions and Graph readiness…</div>}
                </div>
                {wingetStudio.readiness ? (
                  <>
                    <div className="summary-text muted">{wingetStudio.readiness.groupLookupHint}</div>
                    <div className="token-scope-list">
                      {(wingetStudio.readiness.diagnostics.scopes ?? []).slice(0, 8).map((scope) => <span key={scope} className="info-badge">{scope}</span>)}
                    </div>
                  </>
                ) : null}
              </div>

              <div className="info-card drawer-card">
                <div className="section-title">Selected targets</div>
                <div className="target-summary-row">
                  <span className="target-summary-card"><strong>{wingetDeviceTargets.length}</strong><em>Device groups</em></span>
                  <span className="target-summary-card"><strong>{wingetUserTargets.length}</strong><em>User groups</em></span>
                  <span className="target-summary-card"><strong>{wingetStudio.targets.length}</strong><em>Total targets</em></span>
                </div>
                <div className="target-pill-list enhanced">
                  {wingetStudio.targets.length ? wingetStudio.targets.map((target) => (
                    <span key={`${target.groupId}-${target.targetType}`} className="target-pill">
                      <span>{target.displayName}</span>
                      <em>{target.targetType}</em>
                      <button type="button" onClick={() => removeWingetTarget(target.groupId)}>✕</button>
                    </span>
                  )) : <div className="summary-text muted">No targets selected yet. Add at least one group or enable reuse assignments for a replacement workflow.</div>}
                </div>
              </div>
            </div>

            {wingetStudio.error ? <div className="modal-error">{wingetStudio.error}</div> : null}

            {!wingetStudio.error && !wingetStudio.busy && wingetStudio.message ? (
              <div className="info-card drawer-card accent modal-success">
                <div className="section-title">Deployment result</div>
                <div className="summary-text">{wingetStudio.message}</div>
                <div className="summary-text muted">
                  The workspace was refreshed so the new or replacement WinGet application can be reviewed from the Apps view.
                </div>
              </div>
            ) : null}

            <div className="drawer-actions">
              <button className="btn btn-secondary" type="button" onClick={() => setWingetStudio((prev) => ({ ...prev, open: false }))}>Close</button>
              <button className="btn btn-primary" type="button" onClick={() => void onSubmitWinget()} disabled={wingetStudio.busy || !wingetCanSubmit || Boolean(wingetStudio.readiness && !wingetStudio.readiness.mockMode && readinessBlocking.some((item) => item.id === 'apps-rw'))}>
                {wingetStudio.busy ? 'Submitting…' : wingetStudio.mode === 'deploy' ? 'Create WinGet app' : 'Create replacement app'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {permissionCheckOpen && permissionCheck ? (
        <div className="modal-overlay" onClick={() => setPermissionCheckOpen(false)}>
          <div className="assignment-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="app-drawer-header">
              <div>
                <div className="panel-eyebrow">Access validation</div>
                <div className="panel-title">Permission check</div>
                <div className="panel-caption">
                  Review current access level and what is still required for operational actions.
                </div>
              </div>
              <button
                className="btn btn-ghost icon-only"
                type="button"
                onClick={() => setPermissionCheckOpen(false)}
              >
                ✕
              </button>
            </div>

            <div className="info-card drawer-card accent">
              <div className="section-title">Current access state</div>
              <div className="summary-text muted">
                {auth.hasWritePermissions
                  ? 'Write permissions are enabled for operational app actions.'
                  : 'Read Only access is active. Monitoring and reporting are available, but write actions still require elevated permissions.'}
              </div>
            </div>

            <div className="readiness-list detailed">
              {permissionCheck.checks?.map((check) => (
                <div key={check.id} className={`readiness-item ${check.ok ? 'ok' : 'warn'}`}>
                  <div className="readiness-copy">
                    <strong>{check.label}</strong>
                    <span>{check.detail}</span>
                  </div>
                  <em>{check.ok ? 'Ready' : 'Action needed'}</em>
                </div>
              ))}
            </div>

            <div className="info-card drawer-card">
              <div className="section-title">Granted scopes</div>
              <div className="token-scope-list">
                {(permissionCheck.diagnostics?.scopes ?? []).map((scope) => (
                  <span key={scope} className="info-badge">{scope}</span>
                ))}
              </div>
            </div>

            <div className="info-card drawer-card">
              <div className="section-title">What Read Only enables in this app</div>
              <div className="summary-text muted">
                Dashboard visibility, app inventory, app details, OCR analysis, incident visibility, and reporting.
              </div>
            </div>

            <div className="info-card drawer-card">
              <div className="section-title">What Write permissions enable in this app</div>
              <div className="summary-text muted">
                WinGet deploy, replacement flows, assignment changes, uninstall assignment updates, and group-targeted operational app actions.
              </div>
            </div>

            {!auth.hasWritePermissions ? (
              <div className="drawer-actions">
                <button className="btn btn-secondary" type="button" onClick={() => setPermissionCheckOpen(false)}>
                  Close
                </button>
                <button className="btn btn-primary" type="button" onClick={requestWritePermissions}>
                  Request write permissions
                </button>
              </div>
            ) : (
              <div className="drawer-actions">
                <button className="btn btn-secondary" type="button" onClick={() => setPermissionCheckOpen(false)}>
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {toasts.length ? (
        <div className="toast-stack">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast-item ${toast.tone}`}>
              {toast.text}
            </div>
          ))}
        </div>
      ) : null}

      <div className="surface footer">
        <div className="status-left">
          <span className="status-dot" />
          <span className="status-text">{statusMessage}</span>
        </div>
        <div className="footer-text">modernendpoint.tech · by Menahem Suissa</div>
      </div>

      <IntuneAIDrawer open={aiPanel.open} onClose={() => setAiPanel((s) => ({ ...s, open: false }))} action={aiPanel.action} row={aiPanel.row} view={currentView} auth={auth} />
    </div>
  );
}