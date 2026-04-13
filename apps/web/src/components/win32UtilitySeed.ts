export type Win32SourceKind = 'winget' | 'silentinstallhq' | 'template';
export type Win32Confidence = 'high' | 'medium' | 'low';
export type Win32DetectionKind = 'file' | 'registry' | 'msi' | 'script';

export type Win32AlternativeSource = {
  label: string;
  kind: Win32SourceKind;
  url?: string;
  note?: string;
};

export type Win32UtilityRecord = {
  id: string;
  name: string;
  publisher: string;
  version?: string;
  packageId?: string;
  source: Win32SourceKind;
  confidence: Win32Confidence;
  detectionKind: Win32DetectionKind;
  installCommand: string;
  uninstallCommand: string;
  detectionSummary: string;
  detectionScript: string;
  notes: string[];
  validationChecklist: string[];
  lastVerified: string;
  sourceUrl?: string;
  alternatives?: Win32AlternativeSource[];
};

export const win32UtilitySeed: Win32UtilityRecord[] = [
  {
    id: 'google-chrome',
    name: 'Google Chrome',
    publisher: 'Google',
    version: 'Stable',
    packageId: 'Google.Chrome',
    source: 'winget',
    confidence: 'high',
    detectionKind: 'file',
    installCommand:
      'winget install --id Google.Chrome --exact --silent --accept-package-agreements --accept-source-agreements',
    uninstallCommand:
      '"%ProgramFiles%\\Google\\Chrome\\Application\\Installer\\setup.exe" --uninstall --system-level --force-uninstall',
    detectionSummary: 'File detection on chrome.exe under Program Files.',
    detectionScript: `$path = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"\nif (Test-Path $path) {\n  Write-Output "Detected"\n  exit 0\n}\nexit 1`,
    notes: [
      'Install is sourced from WinGet package metadata.',
      'Uninstall should be validated on packaging VM before production rollout.',
      'Prefer file version checks if version-based compliance matters.'
    ],
    validationChecklist: [
      'Test install on clean Windows 11 VM',
      'Confirm uninstall path exists after install',
      'Verify detection passes under system context'
    ],
    lastVerified: '2026-03-17',
    sourceUrl: 'https://winget.run/pkg/Google/Chrome',
    alternatives: [
      {
        label: 'Silent Install HQ article',
        kind: 'silentinstallhq',
        url: 'https://silentinstallhq.com/',
        note: 'Use as secondary validation source for uninstall syntax.'
      }
    ]
  },
  {
    id: '7zip',
    name: '7-Zip',
    publisher: 'Igor Pavlov',
    version: '24.x',
    packageId: '7zip.7zip',
    source: 'winget',
    confidence: 'high',
    detectionKind: 'registry',
    installCommand:
      'winget install --id 7zip.7zip --exact --silent --accept-package-agreements --accept-source-agreements',
    uninstallCommand: 'msiexec /x {23170F69-40C1-2702-2400-000001000000} /quiet /norestart',
    detectionSummary: 'Registry detection against uninstall display name or MSI product code.',
    detectionScript: `$displayName = Get-ItemProperty 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like '7-Zip*' }\nif ($displayName) {\n  Write-Output "Detected"\n  exit 0\n}\nexit 1`,
    notes: [
      'Good candidate for a high-confidence package card.',
      'MSI uninstall can be normalized into Intune uninstall command field.'
    ],
    validationChecklist: [
      'Verify GUID on packaged build',
      'Check 32-bit and 64-bit uninstall registry hives',
      'Validate uninstall return code handling'
    ],
    lastVerified: '2026-03-17',
    sourceUrl: 'https://winget.run/pkg/7zip/7zip'
  },
  {
    id: 'vscode',
    name: 'Visual Studio Code',
    publisher: 'Microsoft',
    version: 'Stable',
    packageId: 'Microsoft.VisualStudioCode',
    source: 'winget',
    confidence: 'high',
    detectionKind: 'file',
    installCommand:
      'winget install --id Microsoft.VisualStudioCode --exact --silent --accept-package-agreements --accept-source-agreements',
    uninstallCommand: '"%LocalAppData%\\Programs\\Microsoft VS Code\\unins000.exe" /VERYSILENT /NORESTART',
    detectionSummary: 'File detection under LocalAppData for user-context installs.',
    detectionScript: `$userPath = Join-Path $env:LOCALAPPDATA 'Programs\\Microsoft VS Code\\Code.exe'\nif (Test-Path $userPath) {\n  Write-Output "Detected"\n  exit 0\n}\nexit 1`,
    notes: [
      'This is a good example of a per-user package where script detection is safer.',
      'Expose run-as account choice in the UI for user vs system packaging.'
    ],
    validationChecklist: [
      'Validate user-context install behavior',
      'Test detection under Intune management extension context',
      'Confirm uninstall path for packaged build'
    ],
    lastVerified: '2026-03-17',
    sourceUrl: 'https://winget.run/pkg/Microsoft/VisualStudioCode',
    alternatives: [
      {
        label: 'Fallback packaging template',
        kind: 'template',
        note: 'Use script detection template when install scope varies per user.'
      }
    ]
  },
  {
    id: 'notepadpp',
    name: 'Notepad++',
    publisher: 'Don Ho',
    version: 'Current',
    packageId: 'Notepad++.Notepad++',
    source: 'silentinstallhq',
    confidence: 'medium',
    detectionKind: 'file',
    installCommand: 'npp.<version>.Installer.x64.exe /S',
    uninstallCommand: '"%ProgramFiles%\\Notepad++\\uninstall.exe" /S',
    detectionSummary: 'File detection on notepad++.exe under Program Files.',
    detectionScript: `$path = "C:\\Program Files\\Notepad++\\notepad++.exe"\nif (Test-Path $path) {\n  Write-Output "Detected"\n  exit 0\n}\nexit 1`,
    notes: [
      'Community-source package card.',
      'Show medium confidence badge and require packaging validation.'
    ],
    validationChecklist: [
      'Reconfirm switch syntax against current installer',
      'Validate uninstall executable path',
      'Check x86 fallback path when needed'
    ],
    lastVerified: '2026-03-17',
    sourceUrl: 'https://silentinstallhq.com/',
    alternatives: [
      {
        label: 'WinGet package candidate',
        kind: 'winget',
        note: 'Prefer WinGet when package id is available in tenant tooling.'
      }
    ]
  },
  {
    id: 'zoom',
    name: 'Zoom Workplace',
    publisher: 'Zoom',
    version: 'Current',
    packageId: 'Zoom.Zoom',
    source: 'template',
    confidence: 'medium',
    detectionKind: 'script',
    installCommand: 'ZoomInstallerFull.msi /quiet /norestart',
    uninstallCommand: 'msiexec /x {ZOOM-PRODUCT-CODE} /quiet /norestart',
    detectionSummary: 'Script detection to handle version drift and multiple scopes.',
    detectionScript: `$candidates = @(\n  'C:\\Program Files\\Zoom\\bin\\Zoom.exe',\n  "$env:APPDATA\\Zoom\\bin\\Zoom.exe"\n)\nif ($candidates | Where-Object { Test-Path $_ }) {\n  Write-Output "Detected"\n  exit 0\n}\nexit 1`,
    notes: [
      'Template-based fallback card for mixed-scope installers.',
      'Encourage validation before promoting to production.'
    ],
    validationChecklist: [
      'Confirm MSI or EXE media used by packaging team',
      'Capture actual product code from test install',
      'Verify user-scope install detection'
    ],
    lastVerified: '2026-03-17',
    alternatives: [
      {
        label: 'Silent Install HQ search',
        kind: 'silentinstallhq',
        url: 'https://silentinstallhq.com/',
        note: 'Use for extra uninstall and PSADT examples.'
      },
      {
        label: 'WinGet package',
        kind: 'winget',
        url: 'https://winget.run/',
        note: 'Use if tenant allows WinGet packaging flow.'
      }
    ]
  },
  {
    id: 'custom-line-of-business',
    name: 'Custom LOB App',
    publisher: 'Internal ISV',
    version: 'Unknown',
    source: 'template',
    confidence: 'low',
    detectionKind: 'script',
    installCommand: 'setup.exe /quiet /norestart',
    uninstallCommand: 'setup.exe /uninstall /quiet /norestart',
    detectionSummary: 'Low-confidence template with custom script detection.',
    detectionScript: `$display = Get-ItemProperty 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like '*Custom LOB App*' }\nif ($display) {\n  Write-Output "Detected"\n  exit 0\n}\nexit 1`,
    notes: [
      'Use this record to demonstrate unknown packages or private apps.',
      'UI should clearly show manual validation required.'
    ],
    validationChecklist: [
      'Capture vendor silent install switches',
      'Record uninstall string from test device',
      'Replace generic detection with app-specific signal'
    ],
    lastVerified: '2026-03-17'
  }
];
