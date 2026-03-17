export type Win32SearchMode = 'quick' | 'deep' | 'catalog';
export type Win32SourceKind = 'vendor' | 'silentinstallhq' | 'winget' | 'heuristic';
export type Win32Confidence = 'high' | 'medium' | 'low';

export type Win32ResolvedRecord = {
  packageKey: string;
  name: string;
  publisher: string;
  packageId: string;
  source: Win32SourceKind;
  confidence: Win32Confidence;
  installCommand: string;
  uninstallCommand: string;
  detectionType: string;
  detectionSummary: string;
  detectScript: string;
  notes: string[];
  validationChecklist: string[];
  sourceUrl?: string;
  alternativeSources?: Array<{ label: string; source: Win32SourceKind; url?: string }>;
  installerFileName?: string;
};

export type Win32CatalogEntry = {
  packageKey: string;
  name: string;
  publisher: string;
  aliases: string[];
  packageId: string;
};

const curatedRecords: Win32ResolvedRecord[] = [
  {
    packageKey: 'google-chrome',
    name: 'Google Chrome',
    publisher: 'Google',
    packageId: 'Google.Chrome',
    source: 'winget',
    confidence: 'high',
    installCommand: 'winget install --id Google.Chrome --exact --silent --accept-source-agreements --accept-package-agreements',
    uninstallCommand: String.raw`"%ProgramFiles%\Google\Chrome\Application\<version>\Installer\setup.exe" --uninstall --system-level --force-uninstall`,
    detectionType: 'File + version',
    detectionSummary: String.raw`Detect C:\Program Files\Google\Chrome\Application\chrome.exe and optionally validate version.`,
    detectScript: String.raw`$path = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (Test-Path $path) { Write-Output "Detected"; exit 0 }
exit 1`,
    notes: ['Direct WinGet deployment candidate.', 'Validate uninstall path in a test VM before production rollout.'],
    validationChecklist: ['Confirm install context is system.', 'Validate uninstall path on a packaged device.', 'Optionally enforce version in detection rule.'],
    sourceUrl: 'https://github.com/microsoft/winget-pkgs',
    alternativeSources: [{ label: 'WinGet manifest', source: 'winget', url: 'https://github.com/microsoft/winget-pkgs' }],
    installerFileName: 'GoogleChromeStandaloneEnterprise64.msi'
  },
  {
    packageKey: '7zip',
    name: '7-Zip',
    publisher: 'Igor Pavlov',
    packageId: '7zip.7zip',
    source: 'winget',
    confidence: 'high',
    installCommand: 'winget install --id 7zip.7zip --exact --silent --accept-source-agreements --accept-package-agreements',
    uninstallCommand: String.raw`"%ProgramFiles%\7-Zip\Uninstall.exe" /S`,
    detectionType: 'File exists',
    detectionSummary: String.raw`Detect C:\Program Files\7-Zip\7zFM.exe for classic device-context packaging.`,
    detectScript: String.raw`$path = "C:\Program Files\7-Zip\7zFM.exe"
if (Test-Path $path) { Write-Output "Detected"; exit 0 }
exit 1`,
    notes: ['Strong Win32 packaging candidate for Intune.', 'File-based detection is usually enough unless you need version control.'],
    validationChecklist: ['Validate x64 versus x86 path.', 'Confirm uninstall switch against your packaged binary.'],
    sourceUrl: 'https://github.com/microsoft/winget-pkgs',
    installerFileName: '7z2409-x64.exe'
  },
  {
    packageKey: 'notepad-plus-plus',
    name: 'Notepad++',
    publisher: 'Notepad++ Team',
    packageId: 'Notepad++.Notepad++',
    source: 'silentinstallhq',
    confidence: 'medium',
    installCommand: 'npp.8.x.Installer.x64.exe /S',
    uninstallCommand: String.raw`"%ProgramFiles%\Notepad++\uninstall.exe" /S`,
    detectionType: 'Registry or file',
    detectionSummary: 'Use HKLM uninstall key when available, otherwise detect notepad++.exe in Program Files.',
    detectScript: String.raw`$paths = @(
  "C:\Program Files\Notepad++\notepad++.exe",
  "C:\Program Files (x86)\Notepad++\notepad++.exe"
)
if ($paths | Where-Object { Test-Path $_ }) { Write-Output "Detected"; exit 0 }
exit 1`,
    notes: ['Treat as medium confidence until validated in your packaging workflow.', 'Prefer registry detection if your packaged installer writes stable uninstall keys.'],
    validationChecklist: ['Verify architecture path.', 'Prefer registry-based detection if product code exists.'],
    sourceUrl: 'https://silentinstallhq.com/',
    alternativeSources: [{ label: 'Silent Install HQ', source: 'silentinstallhq', url: 'https://silentinstallhq.com/' }],
    installerFileName: 'npp.8.x.Installer.x64.exe'
  },
  {
    packageKey: 'beyond-compare',
    name: 'Beyond Compare',
    publisher: 'Scooter Software',
    packageId: 'ScooterSoftware.BeyondCompare4',
    source: 'vendor',
    confidence: 'high',
    installCommand: 'msiexec /i "BeyondCompare-4.x.x.msi" /qn /norestart',
    uninstallCommand: String.raw`msiexec /x "{PRODUCT-CODE}" /qn /norestart`,
    detectionType: 'File + uninstall registry',
    detectionSummary: 'Detect BCompare.exe in Program Files and use uninstall registry as a fallback.',
    detectScript: String.raw`$paths = @(
  "C:\Program Files\Beyond Compare 4\BCompare.exe",
  "C:\Program Files (x86)\Beyond Compare 4\BCompare.exe"
)
foreach ($path in $paths) {
  if (Test-Path $path) { Write-Output "Detected"; exit 0 }
}
$uninstall = Get-ChildItem "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall","HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall" -ErrorAction SilentlyContinue |
  Get-ItemProperty |
  Where-Object { $_.DisplayName -like "*Beyond Compare*" }
if ($uninstall) { Write-Output "Detected"; exit 0 }
exit 1`,
    notes: ['If license file is required, add BC4Key.txt post-install.', 'Prefer MSI package when available over EXE automation.'],
    validationChecklist: ['Replace PRODUCT-CODE with actual MSI product code.', 'Confirm post-install license file handling.', 'Validate x86 versus x64 detection path.'],
    sourceUrl: 'https://www.scootersoftware.com/',
    alternativeSources: [
      { label: 'Vendor docs', source: 'vendor', url: 'https://www.scootersoftware.com/' },
      { label: 'Silent Install HQ guide', source: 'silentinstallhq', url: 'https://silentinstallhq.com/' }
    ],
    installerFileName: 'BeyondCompare-4.x.x.msi'
  },
  {
    packageKey: 'visual-studio-code',
    name: 'Visual Studio Code',
    publisher: 'Microsoft',
    packageId: 'Microsoft.VisualStudioCode',
    source: 'winget',
    confidence: 'high',
    installCommand: 'winget install --id Microsoft.VisualStudioCode --exact --silent --accept-source-agreements --accept-package-agreements',
    uninstallCommand: String.raw`"%LocalAppData%\Programs\Microsoft VS Code\unins000.exe" /VERYSILENT /NORESTART`,
    detectionType: 'File exists',
    detectionSummary: 'Use file detection for Code.exe and validate per-user versus system install context.',
    detectScript: String.raw`$paths = @(
  "$env:ProgramFiles\Microsoft VS Code\Code.exe",
  "$env:LocalAppData\Programs\Microsoft VS Code\Code.exe"
)
if ($paths | Where-Object { Test-Path $_ }) { Write-Output "Detected"; exit 0 }
exit 1`,
    notes: ['Decide whether you package system installer or rely on user context.', 'Per-user installs need careful uninstall handling.'],
    validationChecklist: ['Select the right install context.', 'Confirm update behavior for your package strategy.'],
    sourceUrl: 'https://github.com/microsoft/winget-pkgs',
    installerFileName: 'VSCodeSetup-x64.exe'
  },
  {
    packageKey: 'zoom',
    name: 'Zoom',
    publisher: 'Zoom Video Communications',
    packageId: 'Zoom.Zoom',
    source: 'winget',
    confidence: 'medium',
    installCommand: 'ZoomInstallerFull.msi /qn /norestart',
    uninstallCommand: String.raw`msiexec /x "{PRODUCT-CODE}" /qn /norestart`,
    detectionType: 'MSI product code or file',
    detectionSummary: 'Prefer MSI product code detection for stable lifecycle control.',
    detectScript: String.raw`$uninstall = Get-ChildItem "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall","HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall" -ErrorAction SilentlyContinue |
  Get-ItemProperty |
  Where-Object { $_.DisplayName -like "Zoom*" }
if ($uninstall) { Write-Output "Detected"; exit 0 }
$path = "C:\Program Files\Zoom\bin\Zoom.exe"
if (Test-Path $path) { Write-Output "Detected"; exit 0 }
exit 1`,
    notes: ['MSI package is preferred for enterprise deployments.', 'Replace PRODUCT-CODE after validation.'],
    validationChecklist: ['Confirm MSI product code.', 'Validate automatic updates behavior.'],
    installerFileName: 'ZoomInstallerFull.msi'
  },
  {
    packageKey: 'advanced-ip-scanner',
    name: 'Advanced IP Scanner',
    publisher: 'Famatech',
    packageId: 'Famatech.AdvancedIPScanner',
    source: 'silentinstallhq',
    confidence: 'medium',
    installCommand: 'advanced_ip_scanner.exe /VERYSILENT /NORESTART',
    uninstallCommand: String.raw`"%ProgramFiles%\Advanced IP Scanner\unins000.exe" /VERYSILENT /NORESTART`,
    detectionType: 'File exists',
    detectionSummary: 'File detection is usually enough for standard packaging.',
    detectScript: String.raw`$paths = @(
  "C:\Program Files\Advanced IP Scanner\advanced_ip_scanner.exe",
  "C:\Program Files (x86)\Advanced IP Scanner\advanced_ip_scanner.exe"
)
if ($paths | Where-Object { Test-Path $_ }) { Write-Output "Detected"; exit 0 }
exit 1`,
    notes: ['Validate path in a sandbox before rollout.', 'Registry detection can be added if product metadata is stable.'],
    validationChecklist: ['Confirm silent switch against the packaged version.', 'Confirm install path.'],
    installerFileName: 'advanced_ip_scanner.exe'
  }
];

const catalogBase: Array<{ name: string; publisher: string; packageId?: string; aliases?: string[] }> = [
  { name: 'Google Chrome', publisher: 'Google', packageId: 'Google.Chrome', aliases: ['chrome', 'google chrome browser'] },
  { name: 'Google Chrome Enterprise', publisher: 'Google', packageId: 'Google.Chrome.EXE', aliases: ['chrome enterprise'] },
  { name: 'Microsoft Edge', publisher: 'Microsoft', packageId: 'Microsoft.Edge', aliases: ['edge', 'ms edge'] },
  { name: 'Mozilla Firefox', publisher: 'Mozilla', packageId: 'Mozilla.Firefox', aliases: ['firefox'] },
  { name: '7-Zip', publisher: 'Igor Pavlov', packageId: '7zip.7zip', aliases: ['7zip'] },
  { name: 'WinRAR', publisher: 'RARLAB', aliases: ['rar', 'winrar'] },
  { name: 'Notepad++', publisher: 'Notepad++ Team', packageId: 'Notepad++.Notepad++', aliases: ['notepad plus plus'] },
  { name: 'Visual Studio Code', publisher: 'Microsoft', packageId: 'Microsoft.VisualStudioCode', aliases: ['vscode', 'vs code', 'code'] },
  { name: 'Sublime Text', publisher: 'Sublime HQ', aliases: ['sublime'] },
  { name: 'JetBrains IntelliJ IDEA', publisher: 'JetBrains' },
  { name: 'JetBrains PyCharm', publisher: 'JetBrains' },
  { name: 'JetBrains WebStorm', publisher: 'JetBrains' },
  { name: 'JetBrains Rider', publisher: 'JetBrains' },
  { name: 'Git', publisher: 'Git SCM', packageId: 'Git.Git', aliases: ['git scm'] },
  { name: 'GitHub Desktop', publisher: 'GitHub' },
  { name: 'Node.js', publisher: 'OpenJS Foundation', packageId: 'OpenJS.NodeJS' },
  { name: 'Python', publisher: 'Python Software Foundation', packageId: 'Python.Python.3.12' },
  { name: 'PuTTY', publisher: 'Simon Tatham' },
  { name: 'WinSCP', publisher: 'WinSCP' },
  { name: 'FileZilla', publisher: 'FileZilla Project' },
  { name: 'Beyond Compare', publisher: 'Scooter Software', packageId: 'ScooterSoftware.BeyondCompare4', aliases: ['bcompare'] },
  { name: 'TreeSize Free', publisher: 'JAM Software' },
  { name: 'Advanced IP Scanner', publisher: 'Famatech' },
  { name: 'Wireshark', publisher: 'Wireshark Foundation' },
  { name: 'Nmap', publisher: 'Insecure.Org' },
  { name: 'Zoom', publisher: 'Zoom Video Communications' },
  { name: 'Microsoft Teams', publisher: 'Microsoft' },
  { name: 'Slack', publisher: 'Slack Technologies' },
  { name: 'Discord', publisher: 'Discord' },
  { name: 'Webex', publisher: 'Cisco' },
  { name: 'Cisco AnyConnect', publisher: 'Cisco' },
  { name: 'Cisco Secure Client', publisher: 'Cisco' },
  { name: 'VMware Horizon Client', publisher: 'VMware' },
  { name: 'Citrix Workspace', publisher: 'Citrix' },
  { name: 'Remote Desktop Manager', publisher: 'Devolutions' },
  { name: 'Royal TS', publisher: 'Royal Apps' },
  { name: 'TeamViewer', publisher: 'TeamViewer' },
  { name: 'AnyDesk', publisher: 'AnyDesk' },
  { name: 'Adobe Acrobat Reader', publisher: 'Adobe' },
  { name: 'Adobe Acrobat Pro', publisher: 'Adobe' },
  { name: 'Adobe Creative Cloud', publisher: 'Adobe' },
  { name: 'Adobe Photoshop', publisher: 'Adobe' },
  { name: 'Adobe Illustrator', publisher: 'Adobe' },
  { name: 'Adobe InDesign', publisher: 'Adobe' },
  { name: 'Adobe After Effects', publisher: 'Adobe' },
  { name: 'Adobe Premiere Pro', publisher: 'Adobe' },
  { name: 'VLC media player', publisher: 'VideoLAN' },
  { name: 'MPC-HC', publisher: 'MPC-HC' },
  { name: 'HandBrake', publisher: 'HandBrake' },
  { name: 'OBS Studio', publisher: 'OBS Project' },
  { name: 'Audacity', publisher: 'Audacity' },
  { name: 'Spotify', publisher: 'Spotify' },
  { name: 'iTunes', publisher: 'Apple' },
  { name: 'QuickTime', publisher: 'Apple' },
  { name: 'Bonjour', publisher: 'Apple' },
  { name: 'Safari', publisher: 'Apple' },
  { name: 'Microsoft Office 365 Apps', publisher: 'Microsoft' },
  { name: 'Microsoft Outlook', publisher: 'Microsoft' },
  { name: 'Microsoft OneDrive', publisher: 'Microsoft' },
  { name: 'Microsoft OneNote', publisher: 'Microsoft' },
  { name: 'Microsoft Visio', publisher: 'Microsoft' },
  { name: 'Microsoft Project', publisher: 'Microsoft' },
  { name: 'SQL Server Management Studio', publisher: 'Microsoft' },
  { name: 'Azure Data Studio', publisher: 'Microsoft' },
  { name: 'Power BI Desktop', publisher: 'Microsoft' },
  { name: 'PowerShell 7', publisher: 'Microsoft' },
  { name: 'Windows Terminal', publisher: 'Microsoft' },
  { name: 'Sysinternals Suite', publisher: 'Microsoft' },
  { name: 'Process Explorer', publisher: 'Microsoft' },
  { name: 'ProcMon', publisher: 'Microsoft' },
  { name: 'Paint.NET', publisher: 'dotPDN LLC' },
  { name: 'Greenshot', publisher: 'Greenshot' },
  { name: 'ShareX', publisher: 'ShareX Team' },
  { name: 'Snagit', publisher: 'TechSmith' },
  { name: 'Camtasia', publisher: 'TechSmith' },
  { name: 'Postman', publisher: 'Postman' },
  { name: 'Insomnia', publisher: 'Kong' },
  { name: 'Fiddler Classic', publisher: 'Progress' },
  { name: 'Docker Desktop', publisher: 'Docker' },
  { name: 'Kubernetes CLI', publisher: 'Kubernetes' },
  { name: 'Terraform', publisher: 'HashiCorp' },
  { name: 'Vault', publisher: 'HashiCorp' },
  { name: 'Azure CLI', publisher: 'Microsoft' },
  { name: 'AWS CLI', publisher: 'Amazon' },
  { name: 'Google Cloud CLI', publisher: 'Google' },
  { name: 'MongoDB Compass', publisher: 'MongoDB' },
  { name: 'DBeaver', publisher: 'DBeaver Corp' },
  { name: 'MySQL Workbench', publisher: 'Oracle' },
  { name: 'Oracle SQL Developer', publisher: 'Oracle' },
  { name: 'pgAdmin', publisher: 'PostgreSQL' },
  { name: 'Tableau Desktop', publisher: 'Tableau' },
  { name: 'MobaXterm', publisher: 'Mobatek' },
  { name: 'OpenVPN Connect', publisher: 'OpenVPN' },
  { name: 'FortiClient', publisher: 'Fortinet' },
  { name: 'GlobalProtect', publisher: 'Palo Alto Networks' },
  { name: 'Pulse Secure', publisher: 'Ivanti' },
  { name: 'Ivanti Secure Access Client', publisher: 'Ivanti' },
  { name: 'CrowdStrike Falcon Sensor', publisher: 'CrowdStrike' },
  { name: 'SentinelOne Agent', publisher: 'SentinelOne' },
  { name: 'Trend Micro Apex One', publisher: 'Trend Micro' },
  { name: 'Trellix Agent', publisher: 'Trellix' },
  { name: 'Nessus Agent', publisher: 'Tenable' },
  { name: 'Qualys Cloud Agent', publisher: 'Qualys' },
  { name: 'BeyondTrust Privilege Management', publisher: 'BeyondTrust' },
  { name: 'CyberArk EPM', publisher: 'CyberArk' },
  { name: 'Okta Verify', publisher: 'Okta' },
  { name: 'Duo Device Health', publisher: 'Cisco' },
  { name: 'Java Runtime Environment', publisher: 'Oracle' },
  { name: 'Java SE Development Kit', publisher: 'Oracle' },
  { name: 'OpenJDK', publisher: 'Adoptium' },
  { name: 'LibreOffice', publisher: 'The Document Foundation' },
  { name: 'SumatraPDF', publisher: 'Krzysztof Kowalczyk' },
  { name: 'Foxit PDF Reader', publisher: 'Foxit' },
  { name: 'Bluebeam Revu', publisher: 'Bluebeam' },
  { name: 'CutePDF Writer', publisher: 'Acro Software' },
  { name: 'KeePass', publisher: 'Dominik Reichl' },
  { name: '1Password', publisher: 'AgileBits' },
  { name: 'LastPass', publisher: 'LastPass' },
  { name: 'Bitwarden', publisher: 'Bitwarden' },
  { name: 'Zoom Outlook Plugin', publisher: 'Zoom Video Communications' },
  { name: 'WebView2 Runtime', publisher: 'Microsoft' },
  { name: 'Company Portal', publisher: 'Microsoft' },
  { name: 'Remote Help', publisher: 'Microsoft' },
  { name: 'FSLogix Apps', publisher: 'Microsoft' },
  { name: 'AVD Remote Desktop', publisher: 'Microsoft' },
  { name: 'Azure VPN Client', publisher: 'Microsoft' },
  { name: 'Visual C++ Redistributable 2015-2022', publisher: 'Microsoft' },
  { name: '.NET Desktop Runtime 8', publisher: 'Microsoft' },
  { name: '.NET Hosting Bundle 8', publisher: 'Microsoft' },
  { name: 'GitKraken', publisher: 'GitKraken' },
  { name: 'Atlassian Confluence', publisher: 'Atlassian' },
  { name: 'Atlassian Jira', publisher: 'Atlassian' },
  { name: 'Zoom VDI Client', publisher: 'Zoom Video Communications' },
  { name: 'Citrix Workspace for Windows', publisher: 'Citrix' },
  { name: 'Microsoft Remote Desktop', publisher: 'Microsoft' },
  { name: 'RDCMan', publisher: 'Microsoft' },
  { name: 'ServiceNow Agent Client Collector', publisher: 'ServiceNow' }
];

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function makeAliases(name: string, publisher: string, aliases: string[] = []) {
  const base = name.toLowerCase();
  const compact = base.replace(/[^a-z0-9]/g, '');
  const vendorAlias = `${publisher} ${name}`.toLowerCase();
  const minimal = name.replace(/(for windows|desktop|apps|client|runtime)/gi, '').replace(/\s+/g, ' ').trim().toLowerCase();
  return Array.from(new Set([base, compact, vendorAlias, minimal, ...aliases.map((item) => item.toLowerCase())].filter(Boolean)));
}

export const win32Catalog: Win32CatalogEntry[] = (() => {
  const results: Win32CatalogEntry[] = [];
  for (const item of catalogBase) {
    const key = slugify(item.name);
    const aliases = makeAliases(item.name, item.publisher, item.aliases);
    for (const alias of aliases) {
      results.push({
        packageKey: key,
        name: item.name,
        publisher: item.publisher,
        aliases: [alias],
        packageId: item.packageId ?? `${item.publisher.replace(/[^A-Za-z0-9]+/g, '')}.${item.name.replace(/[^A-Za-z0-9]+/g, '')}`
      });
    }
    // Expand search records with common packaging phrases so the catalog is large and forgiving.
    const expansions = [
      `${item.name} installer`,
      `${item.name} silent install`,
      `${item.name} uninstall`,
      `${item.name} detection script`,
      `${item.name} intune`,
      `${item.publisher} ${item.name} installer`,
      `${item.publisher} ${item.name} intune`,
      `${item.name} win32 app`
    ];
    for (const expansion of expansions) {
      results.push({
        packageKey: key,
        name: item.name,
        publisher: item.publisher,
        aliases: [expansion.toLowerCase()],
        packageId: item.packageId ?? `${item.publisher.replace(/[^A-Za-z0-9]+/g, '')}.${item.name.replace(/[^A-Za-z0-9]+/g, '')}`
      });
    }
  }
  return results;
})();

function tokenize(value: string) {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function scoreCatalogEntry(query: string, entry: Win32CatalogEntry) {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const alias = entry.aliases.join(' ');
  if (alias === q) return 120;
  let score = 0;
  if (entry.name.toLowerCase() === q) score += 110;
  if (entry.name.toLowerCase().includes(q)) score += 70;
  if (entry.publisher.toLowerCase().includes(q)) score += 20;
  if (alias.includes(q)) score += 45;
  const qTokens = tokenize(q);
  const haystack = tokenize(`${entry.name} ${entry.publisher} ${alias} ${entry.packageId}`);
  for (const token of qTokens) {
    if (haystack.includes(token)) score += 12;
  }
  return score;
}

export function searchWin32Catalog(query: string, mode: Win32SearchMode) {
  const trimmed = query.trim();
  const aggregated = new Map<string, { entry: Win32CatalogEntry; score: number }>();
  for (const entry of win32Catalog) {
    const score = scoreCatalogEntry(trimmed, entry);
    if (score <= 0) continue;
    const current = aggregated.get(entry.packageKey);
    if (!current || score > current.score) aggregated.set(entry.packageKey, { entry, score });
  }

  const ranked = Array.from(aggregated.values())
    .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
    .map((item) => item.entry);

  const limit = mode === 'deep' ? 8 : mode === 'catalog' ? 24 : 5;
  const results = ranked.slice(0, limit);

  const best = results[0] ?? null;
  const alternatives = results.slice(1, mode === 'deep' ? 4 : 3);
  return {
    query: trimmed,
    catalogCount: win32Catalog.length,
    results,
    bestMatch: best,
    alternatives
  };
}

function titleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function buildHeuristicRecord(name: string, packageKey?: string): Win32ResolvedRecord {
  const appName = titleCase(name.trim());
  const key = packageKey || slugify(appName || 'custom-app');
  const installerStem = appName.replace(/[^A-Za-z0-9]+/g, '') || 'Installer';
  return {
    packageKey: key,
    name: appName || 'Custom App',
    publisher: 'Needs validation',
    packageId: `custom.${installerStem}`,
    source: 'heuristic',
    confidence: 'low',
    installCommand: `${installerStem}.exe /quiet /norestart`,
    uninstallCommand: 'Review vendor uninstall string or MSI product code before rollout.',
    detectionType: 'Custom PowerShell',
    detectionSummary: 'Fallback mode: validate registry, file path, or MSI product code before packaging.',
    detectScript: String.raw`$display = "${appName}"
$keys = @(
  "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall",
  "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
)
$found = $keys | ForEach-Object {
  Get-ChildItem $_ -ErrorAction SilentlyContinue | Get-ItemProperty -ErrorAction SilentlyContinue
} | Where-Object { $_.DisplayName -like "*$display*" }
if ($found) { Write-Output "Detected"; exit 0 }
exit 1`,
    notes: ['No curated source match yet.', 'Use the generated commands as a starting point only.'],
    validationChecklist: ['Confirm vendor silent switches.', 'Replace uninstall command with real product code or vendor string.', 'Validate detection logic in a sandbox.'],
    installerFileName: `${installerStem}.exe`
  };
}

export function resolveWin32Package(query: string, packageKey?: string) {
  const normalizedKey = packageKey?.trim().toLowerCase();
  if (normalizedKey) {
    const direct = curatedRecords.find((item) => item.packageKey === normalizedKey);
    if (direct) return direct;
  }

  const trimmed = query.trim();
  if (!trimmed) return curatedRecords[0];

  const curatedHit = curatedRecords.find((item) => {
    const q = trimmed.toLowerCase();
    return item.name.toLowerCase().includes(q) || item.publisher.toLowerCase().includes(q) || item.packageId.toLowerCase().includes(q) || item.packageKey.includes(slugify(q));
  });
  if (curatedHit) return curatedHit;

  const catalogHit = searchWin32Catalog(trimmed, 'quick').bestMatch;
  if (catalogHit) return buildHeuristicRecord(catalogHit.name, catalogHit.packageKey);

  return buildHeuristicRecord(trimmed);
}

export function buildBundleFiles(record: Win32ResolvedRecord) {
  const slug = record.packageKey || slugify(record.name);
  const installScript = [
    '$ErrorActionPreference = "Stop"',
    `$Installer = Join-Path $PSScriptRoot "files\\${record.installerFileName ?? 'installer.exe'}"`,
    'if (-not (Test-Path $Installer)) { throw "Installer file is missing from package bundle." }',
    '',
    '# Replace the next line if you need vendor-specific transforms or configuration files.',
    `Start-Process -FilePath "cmd.exe" -ArgumentList '/c', '${record.installCommand.replace(/'/g, "''")}' -Wait -NoNewWindow`
  ].join('\n');

  const uninstallScript = [
    '$ErrorActionPreference = "Stop"',
    '# Replace placeholders such as PRODUCT-CODE before production use.',
    `Start-Process -FilePath "cmd.exe" -ArgumentList '/c', '${record.uninstallCommand.replace(/'/g, "''")}' -Wait -NoNewWindow`
  ].join('\n');

  const readme = [
    `# ${record.name} Win32 package source`,
    '',
    `Publisher: ${record.publisher}`,
    `Source: ${record.source}`,
    `Confidence: ${record.confidence}`,
    '',
    '## Files',
    '- install.ps1',
    '- uninstall.ps1',
    '- detect.ps1',
    '- app-manifest.json',
    '- package-notes.md',
    '- import-checklist.md',
    '- files/ (place installer and any license/config files here)',
    '',
    '## Next steps',
    '1. Place the installer in the files folder and rename it if needed.',
    '2. Validate install, detect, and uninstall on a clean test VM.',
    '3. Package the folder with Microsoft Win32 Content Prep Tool.',
    '4. Upload the resulting .intunewin to Intune and use the included scripts.',
    '5. Review requirement rules and return codes before production rollout.'
  ].join('\n');

  const notes = [
    `# ${record.name}`,
    '',
    `Publisher: ${record.publisher}`,
    `Resolved source: ${record.source}`,
    `Confidence: ${record.confidence}`,
    record.sourceUrl ? `Source URL: ${record.sourceUrl}` : '',
    '',
    '## Install command',
    record.installCommand,
    '',
    '## Uninstall command',
    record.uninstallCommand,
    '',
    '## Detection summary',
    record.detectionSummary,
    '',
    '## Notes',
    ...record.notes.map((item) => `- ${item}`),
    '',
    '## Validation checklist',
    ...record.validationChecklist.map((item) => `- ${item}`)
  ].filter(Boolean).join('\n');

  const checklist = [
    '# Intune import checklist',
    '',
    '- Confirm the installer file exists in files/.',
    '- Validate the install command in system context.',
    '- Validate the uninstall command with the packaged version.',
    '- Test the detect script on clean and installed devices.',
    '- Decide whether vendor auto-update should stay enabled.',
    '- Add requirement rules such as OS architecture and minimum version.',
    '- Capture return codes if the installer uses custom reboot semantics.'
  ].join('\n');

  const manifest = JSON.stringify({
    name: record.name,
    publisher: record.publisher,
    packageId: record.packageId,
    source: record.source,
    confidence: record.confidence,
    detectionType: record.detectionType,
    installCommand: record.installCommand,
    uninstallCommand: record.uninstallCommand,
    notes: record.notes,
    validationChecklist: record.validationChecklist,
    installerFileName: record.installerFileName ?? 'installer.exe'
  }, null, 2);

  return {
    packageName: slug,
    files: [
      { name: `${slug}/README.txt`, content: readme },
      { name: `${slug}/install.ps1`, content: installScript },
      { name: `${slug}/uninstall.ps1`, content: uninstallScript },
      { name: `${slug}/detect.ps1`, content: record.detectScript },
      { name: `${slug}/package-notes.md`, content: notes },
      { name: `${slug}/import-checklist.md`, content: checklist },
      { name: `${slug}/app-manifest.json`, content: manifest },
      { name: `${slug}/files/.keep`, content: 'Place installer binaries, transforms, config, or license files here.' }
    ]
  };
}
