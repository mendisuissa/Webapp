export type Win32SourceKind = 'catalog' | 'vendor' | 'silentinstallhq' | 'winget' | 'heuristic';
export type Win32SearchMode = 'quick' | 'deep' | 'catalog';
export type Win32Confidence = 'high' | 'medium' | 'low';

export type Win32Alternative = {
  id: string;
  name: string;
  publisher: string;
  source: Win32SourceKind;
  confidence: Win32Confidence;
  score: number;
  packageId?: string;
  sourceUrl?: string;
  note?: string;
};

export type Win32ResolvedRecord = {
  id: string;
  name: string;
  publisher: string;
  source: Win32SourceKind;
  confidence: Win32Confidence;
  packageId?: string;
  sourceUrl?: string;
  installCommand: string;
  uninstallCommand: string;
  detectionKind: 'file' | 'registry' | 'msi' | 'script';
  detectionSummary: string;
  detectionScript: string;
  notes: string[];
  validationChecklist: string[];
  score: number;
  matchedOn?: string[];
};

export type Win32SearchResponse = {
  query: string;
  mode: Win32SearchMode;
  catalogSize: number;
  aliasCount: number;
  bestMatch: Win32ResolvedRecord | null;
  alternatives: Win32Alternative[];
  message: string;
};

type CatalogRecord = {
  id: string;
  name: string;
  publisher: string;
  aliases: string[];
  packageId?: string;
  sourceUrl?: string;
  installCommand?: string;
  uninstallCommand?: string;
  detectionKind?: 'file' | 'registry' | 'msi' | 'script';
  detectionSummary?: string;
  detectionScript?: string;
  notes?: string[];
  validationChecklist?: string[];
  source?: Extract<Win32SourceKind, 'catalog' | 'vendor' | 'silentinstallhq' | 'winget'>;
};

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (m) => m.toUpperCase());
}

const DETAILED_CATALOG: CatalogRecord[] = [
  {
    id: 'beyond-compare',
    name: 'Beyond Compare',
    publisher: 'Scooter Software',
    aliases: ['bcompare', 'beyond compare 4', 'scooter software beyond compare'],
    source: 'vendor',
    sourceUrl: 'https://www.scootersoftware.com/',
    installCommand: 'msiexec /i "BeyondCompare.msi" /qn /norestart',
    uninstallCommand: 'msiexec /x "BeyondCompare.msi" /qn /norestart',
    detectionKind: 'script',
    detectionSummary: 'Detect BCompare.exe in Program Files or via uninstall registry display name.',
    detectionScript: `$paths = @(\n  'C:\\Program Files\\Beyond Compare 4\\BCompare.exe',\n  'C:\\Program Files (x86)\\Beyond Compare 4\\BCompare.exe'\n)\nforeach ($path in $paths) {\n  if (Test-Path $path) {\n    Write-Output "Detected"\n    exit 0\n  }\n}\n$keys = @(\n  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',\n  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'\n)\n$hit = Get-ItemProperty $keys -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like '*Beyond Compare*' }\nif ($hit) { Write-Output "Detected"; exit 0 }\nexit 1`,
    notes: ['Validate whether your media is MSI or EXE before production packaging.', 'If you deploy licensing, copy BC4Key.txt after install.'],
    validationChecklist: ['Confirm architecture-specific path.', 'Validate license file placement if used.', 'Test uninstall return codes under Intune context.']
  },
  {
    id: 'google-chrome',
    name: 'Google Chrome',
    publisher: 'Google',
    aliases: ['chrome', 'chrome browser', 'google chrome enterprise'],
    packageId: 'Google.Chrome',
    source: 'winget',
    sourceUrl: 'https://winget.run/pkg/Google/Chrome',
    installCommand: 'winget install --id Google.Chrome --exact --silent --accept-source-agreements --accept-package-agreements',
    uninstallCommand: '"%ProgramFiles%\\Google\\Chrome\\Application\\Installer\\setup.exe" --uninstall --system-level --force-uninstall',
    detectionKind: 'file',
    detectionSummary: 'File detection against chrome.exe under Program Files.',
    detectionScript: `$path = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'\nif (Test-Path $path) { Write-Output 'Detected'; exit 0 }\nexit 1`,
    notes: ['High-confidence WinGet package.', 'Use file version checks only if you need version governance.'],
    validationChecklist: ['Validate uninstall path after installation.', 'Confirm system-context deployment.']
  },
  {
    id: '7zip',
    name: '7-Zip',
    publisher: 'Igor Pavlov',
    aliases: ['7 zip', '7zip file manager'],
    packageId: '7zip.7zip',
    source: 'winget',
    sourceUrl: 'https://winget.run/pkg/7zip/7zip',
    installCommand: 'winget install --id 7zip.7zip --exact --silent --accept-source-agreements --accept-package-agreements',
    uninstallCommand: 'msiexec /x {23170F69-40C1-2702-2400-000001000000} /quiet /norestart',
    detectionKind: 'registry',
    detectionSummary: 'Registry detection via uninstall display name or MSI product code.',
    detectionScript: `$keys = @(\n  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',\n  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'\n)\n$hit = Get-ItemProperty $keys -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like '7-Zip*' }\nif ($hit) { Write-Output 'Detected'; exit 0 }\nexit 1`,
    notes: ['MSI uninstall GUID can vary by major version.', 'Registry detection is safer than file-only detection when x86/x64 variants coexist.'],
    validationChecklist: ['Confirm product code on packaged build.', 'Validate x86 and x64 hives.']
  },
  {
    id: 'notepad-plus-plus',
    name: 'Notepad++',
    publisher: 'Don Ho',
    aliases: ['notepad++', 'notepad plus plus', 'npp'],
    packageId: 'Notepad++.Notepad++',
    source: 'silentinstallhq',
    sourceUrl: 'https://silentinstallhq.com/',
    installCommand: 'npp.<version>.Installer.x64.exe /S',
    uninstallCommand: '"%ProgramFiles%\\Notepad++\\uninstall.exe" /S',
    detectionKind: 'file',
    detectionSummary: 'File detection against notepad++.exe under Program Files.',
    detectionScript: `$paths = @(\n  'C:\\Program Files\\Notepad++\\notepad++.exe',\n  'C:\\Program Files (x86)\\Notepad++\\notepad++.exe'\n)\nif ($paths | Where-Object { Test-Path $_ }) { Write-Output 'Detected'; exit 0 }\nexit 1`,
    notes: ['Community-source commands should be validated with current installer build.', 'Use registry detection if you need stronger install-state proof.'],
    validationChecklist: ['Validate x86/x64 path.', 'Confirm uninstall executable path.']
  },
  {
    id: 'visual-studio-code',
    name: 'Visual Studio Code',
    publisher: 'Microsoft',
    aliases: ['vs code', 'vscode', 'code editor'],
    packageId: 'Microsoft.VisualStudioCode',
    source: 'winget',
    sourceUrl: 'https://winget.run/pkg/Microsoft/VisualStudioCode',
    installCommand: 'winget install --id Microsoft.VisualStudioCode --exact --silent --accept-source-agreements --accept-package-agreements',
    uninstallCommand: '"%LocalAppData%\\Programs\\Microsoft VS Code\\unins000.exe" /VERYSILENT /NORESTART',
    detectionKind: 'script',
    detectionSummary: 'User-scope file detection under LocalAppData is recommended.',
    detectionScript: `$path = Join-Path $env:LOCALAPPDATA 'Programs\\Microsoft VS Code\\Code.exe'\nif (Test-Path $path) { Write-Output 'Detected'; exit 0 }\nexit 1`,
    notes: ['Per-user install scope is common for VS Code.', 'Choose user-context deployment when packaging this variant.'],
    validationChecklist: ['Validate run context.', 'Confirm install scope in test VM.']
  },
  {
    id: 'adobe-acrobat-reader',
    name: 'Adobe Acrobat Reader',
    publisher: 'Adobe',
    aliases: ['acrobat reader', 'adobe reader', 'reader dc'],
    source: 'catalog',
    installCommand: 'AcroRdrDCx64.exe /sAll /rs /rps /msi EULA_ACCEPT=YES',
    uninstallCommand: 'msiexec /x {ADOBE-READER-PRODUCT-CODE} /quiet /norestart',
    detectionKind: 'file',
    detectionSummary: 'Detect AcroRd32.exe under Adobe Acrobat Reader installation path.',
    detectionScript: `$paths = @(\n  'C:\\Program Files\\Adobe\\Acrobat DC\\Acrobat\\Acrobat.exe',\n  'C:\\Program Files (x86)\\Adobe\\Acrobat Reader DC\\Reader\\AcroRd32.exe'\n)\nif ($paths | Where-Object { Test-Path $_ }) { Write-Output 'Detected'; exit 0 }\nexit 1`,
    notes: ['Adobe command line differs by channel and generation.', 'Validate exact media before rollout.'],
    validationChecklist: ['Confirm package family.', 'Verify product code on exact release.']
  }
];

const CATALOG_APP_NAMES = [
  '1Password','Adobe Acrobat','Adobe Acrobat Pro','Adobe Creative Cloud','Advanced IP Scanner','AnyDesk','Audacity','AutoCAD','Azure CLI','Azure Data Studio','Beyond Compare','Bitwarden','Blender','BlueJeans','Brave Browser','Box Drive','Camtasia','Cisco AnyConnect','Citrix Workspace','Chrome Remote Desktop','Cyberduck','DB Browser for SQLite','DBeaver','Discord','Docker Desktop','Draw.io','Dropbox','Eclipse IDE','Egnyte Desktop App','Epic Games Launcher','Everything Search','Figma','FileZilla','Firefox','Foxit PDF Editor','Foxit PDF Reader','Git','GitHub Desktop','GitKraken','Google Chrome','Google Drive','GoTo Resolve','GoTo Meeting','Greenshot','HeidiSQL','IBM Aspera Connect','IrfanView','Java JRE','Java JDK','Jabra Direct','JDK Temurin','KeePass','LibreOffice','Microsoft Edge','Microsoft OneDrive','Microsoft Power BI Desktop','Microsoft Teams','Microsoft To Do','Microsoft Visual C++ Redistributable','Microsoft Visual Studio','Microsoft Visual Studio Code','MobaXterm','Mozilla Thunderbird','MySQL Workbench','Notepad++','OBS Studio','Okta Verify','OpenVPN Connect','Paint.NET','Postman','PowerToys','PuTTY','Python','qBittorrent','Quick Assist','QuickBooks','Remote Desktop Manager','Robo 3T','Royal TS','RStudio','Rufus','SCCM Toolkit','Slack','Snagit','SoapUI','SonicWall NetExtender','Sophos Connect','Spotify','SQL Server Management Studio','Sublime Text','Sysinternals Suite','TeamViewer','TeraCopy','TreeSize Free','Trello','VeraCrypt','VLC Media Player','VMware Horizon Client','VMware Tools','Visual Studio Build Tools','WinRAR','WinSCP','WireGuard','Wireshark','Zoom Workplace','Zoom Rooms','Zscaler Client Connector',
  '7-Zip','Android Studio','Arc Browser','Asana','AWS CLI','Azure VPN Client','Battle.net','BeyondTrust Remote Support','Bitdefender Endpoint Security Tools','Canva','ClickShare','Confluence','CorelDRAW','CrowdStrike Falcon Sensor','CrystalDiskInfo','CyberArk Identity Secure Web Sessions','Devolutions Remote Desktop Manager','DisplayLink Manager','Epic Pen','FortiClient VPN','Google Earth Pro','Grafana Agent','HP Image Assistant','Jamf Connect','K-Lite Codec Pack','LastPass','Lenovo System Update','Logitech Options+','Malwarebytes','ManageEngine Endpoint Central Agent','Maven','McAfee Agent','Microsoft Azure Storage Explorer','Microsoft Company Portal','Microsoft SQL Server Data Tools','MiniTool Partition Wizard','Nmap','Node.js','NordVPN','Opera Browser','Oracle VM VirtualBox','PDQ Deploy','PDFsam','Prism Launcher','Private Internet Access','Redis Insight','RingCentral','RustDesk','Sage 50','SAP GUI','ServiceNow Agent','Signal Desktop','Sonos','Tableau Desktop','Tableau Reader','Tailscale','TightVNC','Tor Browser','Unity Hub','Veeam Agent','Webex','WebStorm','XAMPP','YubiKey Manager','Zoom Plugin for Outlook'
];

function createCatalogRecords(): CatalogRecord[] {
  const records = [...DETAILED_CATALOG];
  const seen = new Set(records.map((item) => `${normalize(item.name)}|${normalize(item.publisher)}`));
  const variants = ['x64', 'x86', 'enterprise', 'msi', 'exe', 'installer'];

  for (const name of CATALOG_APP_NAMES) {
    const publisher = name.split(' ')[0] || 'Vendor';
    const baseKey = `${normalize(name)}|${normalize(publisher)}`;
    if (seen.has(baseKey)) continue;
    seen.add(baseKey);

    const aliases = Array.from(new Set([
      normalize(name),
      normalize(name.replace(/\+/g, ' plus ').replace(/#/g, ' sharp ')),
      normalize(name.replace(/\b(browser|desktop|client|app|suite|studio|editor|player|free)\b/ig, '').trim()),
      normalize(name.replace(/[^a-zA-Z0-9]+/g, '')),
      normalize(`${publisher} ${name}`)
    ].filter(Boolean)));

    const packageId = name.includes(' ') ? `${publisher.replace(/[^a-zA-Z0-9]+/g, '')}.${name.replace(/[^a-zA-Z0-9]+/g, '')}` : undefined;
    records.push({ id: slugify(name), name, publisher, aliases, packageId, source: 'catalog' });

    for (const variant of variants) {
      records.push({
        id: `${slugify(name)}-${variant}`,
        name: `${name} ${variant.toUpperCase()}`,
        publisher,
        aliases: Array.from(new Set([
          ...aliases,
          normalize(`${name} ${variant}`),
          normalize(`${publisher} ${name} ${variant}`),
          normalize(`${name} ${variant} install`)
        ])),
        packageId,
        source: 'catalog'
      });
    }
  }
  return records;
}

const STARTER_CATALOG = createCatalogRecords();
const ALIAS_COUNT = STARTER_CATALOG.reduce((sum, item) => sum + (item.aliases?.length ?? 0), 0);

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}

function scoreMatch(query: string, candidate: string): number {
  const q = normalize(query);
  const c = normalize(candidate);
  if (!q || !c) return 0;
  if (q === c) return 100;
  if (c.startsWith(q)) return 92;
  if (c.includes(q)) return 84;
  if (q.includes(c) && c.length >= 5) return 76;
  const distance = levenshtein(q, c);
  const maxLen = Math.max(q.length, c.length);
  const similarity = maxLen ? 1 - distance / maxLen : 0;
  return similarity >= 0.72 ? Math.round(similarity * 70) : 0;
}

function detectScriptForName(name: string): { detectionKind: Win32ResolvedRecord['detectionKind']; detectionSummary: string; detectionScript: string } {
  const clean = name.replace(/[^a-zA-Z0-9]+/g, ' ').trim();
  const exe = name.replace(/[^a-zA-Z0-9]+/g, '') || 'App';
  return {
    detectionKind: 'script',
    detectionSummary: `Script detection for ${clean} using uninstall registry plus Program Files search.`,
    detectionScript: `$appName = '${clean.replace(/'/g, "''")}'\n$keys = @(\n  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',\n  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'\n)\n$hit = Get-ItemProperty $keys -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like "*$appName*" }\nif ($hit) { Write-Output 'Detected'; exit 0 }\n$paths = @(\n  \"C:\\Program Files\\${clean}\\${exe}.exe\",\n  \"C:\\Program Files (x86)\\${clean}\\${exe}.exe\"\n)\nif ($paths | Where-Object { Test-Path $_ }) { Write-Output 'Detected'; exit 0 }\nexit 1`
  };
}

function buildRecordFromCatalog(item: CatalogRecord, query: string, score: number, matchedOn: string[]): Win32ResolvedRecord {
  const detection = item.detectionScript && item.detectionSummary && item.detectionKind
    ? { detectionKind: item.detectionKind, detectionSummary: item.detectionSummary, detectionScript: item.detectionScript }
    : detectScriptForName(item.name);

  const installCommand = item.installCommand ?? (item.packageId
    ? `winget install --id ${item.packageId} --exact --silent --accept-source-agreements --accept-package-agreements`
    : `setup.exe /quiet /norestart`);
  const uninstallCommand = item.uninstallCommand ?? (item.packageId
    ? `winget uninstall --id ${item.packageId} --silent`
    : `Review vendor uninstall string for ${item.name} before rollout.`);

  const source = item.source ?? (item.packageId ? 'catalog' : 'heuristic');
  const confidence: Win32Confidence = item.installCommand && item.uninstallCommand && item.detectionScript
    ? 'high'
    : item.packageId || source === 'catalog'
      ? 'medium'
      : 'low';

  return {
    id: item.id,
    name: item.name,
    publisher: item.publisher,
    source,
    confidence,
    packageId: item.packageId,
    sourceUrl: item.sourceUrl,
    installCommand,
    uninstallCommand,
    detectionKind: detection.detectionKind,
    detectionSummary: detection.detectionSummary,
    detectionScript: detection.detectionScript,
    notes: item.notes ?? [
      `Matched against the local known-app catalog for query "${query}".`,
      'Validate the final installer media before moving to production.'
    ],
    validationChecklist: item.validationChecklist ?? [
      'Test install on clean VM.',
      'Validate uninstall behavior.',
      'Run detection under system context.'
    ],
    score,
    matchedOn
  };
}

async function searchWinget(query: string) {
  const response = await fetch(`https://winget.run/search?query=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': 'ModernEndpoint/1.0' }
  });
  if (!response.ok) return [] as Win32ResolvedRecord[];
  const html = await response.text();
  const matches = html.matchAll(/\/pkg\/([^"'?#<\s]+)\/([^"'?#<\s]+)/g);
  const rows: Win32ResolvedRecord[] = [];
  const seen = new Set<string>();
  for (const match of matches) {
    const publisher = decodeURIComponent(match[1] ?? '').trim();
    const pkgName = decodeURIComponent(match[2] ?? '').trim();
    if (!publisher || !pkgName) continue;
    const packageId = `${publisher}.${pkgName}`;
    if (seen.has(packageId)) continue;
    seen.add(packageId);
    const displayName = titleCase(pkgName.replace(/[-_.]+/g, ' '));
    const score = Math.max(scoreMatch(query, displayName), scoreMatch(query, packageId));
    if (score < 55) continue;
    const detection = detectScriptForName(displayName);
    rows.push({
      id: `winget-${slugify(packageId)}`,
      name: displayName,
      publisher,
      source: 'winget',
      confidence: 'medium',
      packageId,
      sourceUrl: `https://winget.run/pkg/${publisher}/${pkgName}`,
      installCommand: `winget install --id ${packageId} --exact --silent --accept-source-agreements --accept-package-agreements`,
      uninstallCommand: `winget uninstall --id ${packageId} --silent`,
      detectionKind: detection.detectionKind,
      detectionSummary: detection.detectionSummary,
      detectionScript: detection.detectionScript,
      notes: ['Resolved from WinGet search results.', 'Uninstall command is WinGet-based; validate in packaging VM if you require vendor-native uninstall.'],
      validationChecklist: ['Confirm package identifier.', 'Test uninstall behavior in target context.', 'Review installation scope.'],
      score,
      matchedOn: ['winget']
    });
    if (rows.length >= 8) break;
  }
  return rows;
}

function extractCommandCandidates(text: string): string[] {
  const codeMatches = [...text.matchAll(/<code[^>]*>([\s\S]*?)<\/code>/gi)].map((m) => m[1].replace(/<[^>]+>/g, ' ').trim());
  const preMatches = [...text.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/gi)].map((m) => m[1].replace(/<[^>]+>/g, ' ').trim());
  const lines = [...codeMatches, ...preMatches]
    .flatMap((block) => block.split(/\r?\n/))
    .map((line) => line.replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim())
    .filter(Boolean);
  return Array.from(new Set(lines)).filter((line) => /(msiexec|\.exe|winget|\/S|\/quiet|\/qn|VERYSILENT|SILENT)/i.test(line)).slice(0, 12);
}

async function searchSilentInstallHQ(query: string) {
  const response = await fetch(`https://silentinstallhq.com/?s=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': 'ModernEndpoint/1.0' }
  });
  if (!response.ok) return [] as Win32ResolvedRecord[];
  const html = await response.text();
  const linkMatches = [...html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
  const articleLinks = linkMatches
    .map((m) => ({ url: m[1], title: m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() }))
    .filter((item) => item.url.includes('silentinstallhq.com') && /silent install|install|uninstall|psadt/i.test(item.title));

  const unique = new Map<string, { url: string; title: string }>();
  for (const item of articleLinks) {
    if (!unique.has(item.url)) unique.set(item.url, item);
    if (unique.size >= 5) break;
  }

  const rows: Win32ResolvedRecord[] = [];
  for (const item of unique.values()) {
    const article = await fetch(item.url, { headers: { 'User-Agent': 'ModernEndpoint/1.0' } }).then((r) => r.ok ? r.text() : '');
    const commands = extractCommandCandidates(article);
    const installCommand = commands.find((line) => /(msiexec\s+\/i|install|setup.*\/|\.exe\s+\/|winget install)/i.test(line)) ?? `Review article for ${item.title}`;
    const uninstallCommand = commands.find((line) => /(msiexec\s+\/x|uninstall|remove|winget uninstall)/i.test(line)) ?? 'Review vendor or article uninstall command before rollout.';
    const appName = item.title.replace(/silent install.*$/i, '').replace(/how to guide.*$/i, '').replace(/psadt.*$/i, '').replace(/install and uninstall.*$/i, '').replace(/\s+-\s+.*$/, '').trim() || query;
    const detection = detectScriptForName(appName);
    const score = Math.max(scoreMatch(query, appName), scoreMatch(query, item.title));
    if (score < 45) continue;
    rows.push({
      id: `sihq-${slugify(item.url)}`,
      name: appName,
      publisher: appName.split(' ')[0] || 'Vendor',
      source: 'silentinstallhq',
      confidence: commands.length >= 2 ? 'medium' : 'low',
      sourceUrl: item.url,
      installCommand,
      uninstallCommand,
      detectionKind: detection.detectionKind,
      detectionSummary: detection.detectionSummary,
      detectionScript: detection.detectionScript,
      notes: ['Resolved from Silent Install HQ article search.', 'Validate syntax against the exact installer release you will package.'],
      validationChecklist: ['Open source article and compare to current vendor media.', 'Run install and uninstall test in a packaging VM.'],
      score,
      matchedOn: ['silentinstallhq']
    });
  }
  return rows;
}

function searchCatalog(query: string) {
  const scored = STARTER_CATALOG
    .map((item) => {
      const candidates = [item.name, item.publisher, item.packageId ?? '', ...(item.aliases ?? [])];
      const scores = candidates.map((candidate) => scoreMatch(query, candidate));
      const best = Math.max(...scores);
      const matchedOn = candidates.filter((candidate, index) => scores[index] === best && best > 0).map((candidate) => candidate.slice(0, 80));
      return { item, best, matchedOn };
    })
    .filter((entry) => entry.best >= 48)
    .sort((a, b) => b.best - a.best || a.item.name.localeCompare(b.item.name))
    .slice(0, 12)
    .map((entry) => buildRecordFromCatalog(entry.item, query, entry.best, entry.matchedOn));
  return scored;
}

function mergeAlternatives(records: Win32ResolvedRecord[], bestId?: string): Win32Alternative[] {
  return records
    .filter((item) => item.id !== bestId)
    .slice(0, 6)
    .map((item) => ({
      id: item.id,
      name: item.name,
      publisher: item.publisher,
      source: item.source,
      confidence: item.confidence,
      score: item.score,
      packageId: item.packageId,
      sourceUrl: item.sourceUrl,
      note: item.notes[0]
    }));
}

function rank(records: Win32ResolvedRecord[]): Win32ResolvedRecord[] {
  return records.sort((a, b) => {
    const confidenceWeight = { high: 3, medium: 2, low: 1 };
    const sourceWeight = { vendor: 5, silentinstallhq: 4, winget: 4, catalog: 3, heuristic: 1 };
    return (b.score + confidenceWeight[b.confidence] * 10 + sourceWeight[b.source]) - (a.score + confidenceWeight[a.confidence] * 10 + sourceWeight[a.source]);
  });
}

export async function resolveWin32(query: string, mode: Win32SearchMode = 'quick'): Promise<Win32SearchResponse> {
  const trimmed = query.trim();
  if (!trimmed) {
    return {
      query: '',
      mode,
      catalogSize: STARTER_CATALOG.length,
      aliasCount: ALIAS_COUNT,
      bestMatch: null,
      alternatives: [],
      message: 'Enter an application name to resolve packaging guidance.'
    };
  }

  const catalogResults = searchCatalog(trimmed);
  const tasks = mode === 'catalog'
    ? []
    : [searchWinget(trimmed), searchSilentInstallHQ(trimmed)];

  const remoteResults = await Promise.allSettled(tasks);
  const combined = [...catalogResults];
  for (const result of remoteResults) {
    if (result.status === 'fulfilled') combined.push(...result.value);
  }

  const deduped = new Map<string, Win32ResolvedRecord>();
  for (const item of rank(combined)) {
    const key = `${normalize(item.name)}|${normalize(item.publisher)}`;
    if (!deduped.has(key)) deduped.set(key, item);
  }
  const ranked = Array.from(deduped.values());
  const bestMatch = ranked[0] ?? null;
  return {
    query: trimmed,
    mode,
    catalogSize: STARTER_CATALOG.length,
    aliasCount: ALIAS_COUNT,
    bestMatch,
    alternatives: mergeAlternatives(ranked, bestMatch?.id),
    message: bestMatch
      ? `Resolved ${bestMatch.name} using ${bestMatch.source === 'catalog' ? 'the known-app catalog' : bestMatch.source}.`
      : 'No strong match found. Try Deep Search or refine the application name.'
  };
}

export function getCatalogStats() {
  return {
    catalogSize: STARTER_CATALOG.length,
    aliasCount: ALIAS_COUNT,
    sample: STARTER_CATALOG.slice(0, 12).map((item) => ({ id: item.id, name: item.name, publisher: item.publisher, packageId: item.packageId }))
  };
}
