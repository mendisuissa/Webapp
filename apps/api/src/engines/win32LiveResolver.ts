export type Win32SearchMode = 'quick' | 'deep';
export type Win32SourceType = 'winget' | 'silentinstallhq' | 'vendor' | 'chocolatey' | 'github' | 'officialdocs' | 'fallback';
export type InstallerType = 'exe' | 'msi' | 'msix' | 'zip' | 'unknown';
export type ExportReadiness = 'ready' | 'partial' | 'research-needed';

type InstallerInsight = {
  installerUrl?: string;
  installerType?: InstallerType;
  downloadPageUrl?: string;
  version?: string;
  docsUrl?: string;
  releaseUrl?: string;
};

type Win32ResolvedRecord = {
  id: string;
  name: string;
  publisher: string;
  packageId?: string;
  sourceType: Win32SourceType;
  sourceLabel: string;
  sourceUrl?: string;
  sourceTitle: string;
  confidence: 'high' | 'medium' | 'low';
  confidenceScore: number;
  confidenceReasons: string[];
  installCommand: string;
  uninstallCommand: string;
  detectionScript: string;
  detectionSummary: string;
  notes: string[];
  evidence: string[];
  whySelected: string;
  score: number;
  installerUrl?: string;
  installerType?: InstallerType;
  downloadPageUrl?: string;
  version?: string;
  docsUrl?: string;
  releaseUrl?: string;
  exportReadiness: ExportReadiness;
};

export type Win32SearchResponse = {
  ok: boolean;
  query: string;
  mode: Win32SearchMode;
  bestMatch: {
    id: string;
    name: string;
    publisher: string;
    packageId?: string;
    source: Win32SourceType;
    confidence: 'high' | 'medium' | 'low';
    confidenceScore: number;
    confidenceReasons: string[];
    installCommand: string;
    uninstallCommand: string;
    detectScript: string;
    whySelected: string;
    notes: string[];
    evidence: string[];
    sourceUrl?: string;
    installerUrl?: string;
    installerType?: InstallerType;
    downloadPageUrl?: string;
    version?: string;
    docsUrl?: string;
    releaseUrl?: string;
    exportReadiness: ExportReadiness;
  } | null;
  candidates: Array<{
    id: string;
    name: string;
    publisher: string;
    packageId?: string;
    source: Win32SourceType;
    confidence: 'high' | 'medium' | 'low';
    confidenceScore: number;
    confidenceReasons: string[];
    installCommand: string;
    uninstallCommand: string;
    detectScript: string;
    whySelected: string;
    notes: string[];
    evidence: string[];
    sourceUrl?: string;
    installerUrl?: string;
    installerType?: InstallerType;
    downloadPageUrl?: string;
    version?: string;
    docsUrl?: string;
    releaseUrl?: string;
    exportReadiness: ExportReadiness;
  }>;
  alternatives: Array<{
    title: string;
    source: Win32SourceType;
    url: string;
    note: string;
  }>;
  checkedSources: string[];
  message: string;
};

type WingetSearchRow = {
  packageIdentifier: string;
  name: string;
  publisher: string;
  sourceUrl: string;
};

type SilentInstallRow = {
  title: string;
  url: string;
  installCommand?: string;
  uninstallCommand?: string;
  notes: string[];
  evidence: string[];
  installerUrl?: string;
  installerType?: InstallerType;
  version?: string;
};

type ChocolateySearchRow = {
  packageId: string;
  name: string;
  sourceUrl: string;
};

const USER_AGENT = 'ModernEndpoint/1.0';
const DROP_WORDS = new Set(['installer', 'setup', 'silent', 'client', 'enterprise', 'workplace', 'vpn', 'edition']);
const SYNONYMS: Record<string, string[]> = {
  chrome: ['google chrome', 'chrome enterprise', 'chrome canary'],
  brave: ['brave browser'],
  firefox: ['mozilla firefox'],
  vscode: ['visual studio code', 'vs code'],
  teams: ['microsoft teams'],
  zoom: ['zoom workplace', 'zoom'],
  acrobat: ['adobe acrobat reader', 'acrobat reader'],
  pycharm: ['jetbrains pycharm', 'pycharm community', 'pycharm professional'],
  intellij: ['jetbrains intellij idea', 'intellij community', 'intellij ultimate']
};

function normalize(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function slug(text: string) {
  return normalize(text).replace(/\s+/g, '-') || 'app';
}

function htmlDecode(text: string) {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function stripTags(text: string) {
  return htmlDecode(text.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function tokenize(text: string) {
  return normalize(text)
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !DROP_WORDS.has(token));
}

function expandQueries(query: string, mode: Win32SearchMode) {
  const trimmed = query.trim();
  const values = new Set<string>([trimmed]);
  const normalized = normalize(trimmed);
  const tokens = tokenize(trimmed);

  for (const token of tokens) {
    for (const synonym of SYNONYMS[token] ?? []) values.add(synonym);
  }
  for (const synonym of SYNONYMS[normalized] ?? []) values.add(synonym);

  if (tokens.length > 1) {
    values.add(tokens.join(' '));
    values.add(tokens.slice(0, -1).join(' '));
  }

  if (mode === 'deep') {
    for (const value of [...values]) {
      values.add(`${value} silent install`);
      values.add(`${value} install uninstall`);
      values.add(`${value} msi exe`);
    }
  }

  return [...values].filter((item) => item && item.trim().length > 0);
}

async function fetchText(url: string) {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error(`Fetch failed for ${url} (${response.status}).`);
  return await response.text();
}

function inferInstallerType(url?: string): InstallerType | undefined {
  if (!url) return undefined;
  const value = url.toLowerCase();
  if (value.includes('.msix')) return 'msix';
  if (value.includes('.msi')) return 'msi';
  if (value.includes('.exe')) return 'exe';
  if (value.includes('.zip')) return 'zip';
  return undefined;
}

function extractVersion(text: string): string | undefined {
  const match = text.match(/\b(20\d{2}(?:\.\d+){0,3}|\d{1,3}(?:\.\d+){1,3})\b/);
  return match?.[1];
}

function pickBestInstaller(urls: string[]): { installerUrl?: string; installerType?: InstallerType } {
  const ranked = urls
    .map((url) => ({ url, type: inferInstallerType(url) ?? 'unknown' as InstallerType }))
    .filter((item) => item.type !== 'zip')
    .sort((a, b) => {
      const rank = (t: InstallerType) => (t === 'msi' ? 1 : t === 'exe' ? 2 : t === 'msix' ? 3 : t === 'zip' ? 4 : 5);
      return rank(a.type) - rank(b.type);
    });
  const best = ranked[0] ?? urls[0] ? { url: urls[0], type: inferInstallerType(urls[0]) ?? 'unknown' as InstallerType } : undefined;
  return best ? { installerUrl: best.url, installerType: best.type } : {};
}

function extractUrls(html: string) {
  const urls = new Set<string>();
  for (const match of html.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
    const url = (match[0] ?? '').replace(/[),.;]+$/, '');
    if (url) urls.add(url);
  }
  for (const match of html.matchAll(/href=["']([^"']+)["']/gi)) {
    const url = match[1] ?? '';
    if (/^https?:\/\//i.test(url)) urls.add(url);
  }
  return [...urls];
}

function extractDirectInstallerLinks(html: string) {
  const urls = extractUrls(html).filter((url) => /\.(msi|exe|msix|zip)(\?|$)/i.test(url));
  return [...new Set(urls)];
}

function extractCommandsFromHtml(html: string) {
  const blocks = [
    ...html.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/gi),
    ...html.matchAll(/<code[^>]*>([\s\S]*?)<\/code>/gi)
  ].map((match) => htmlDecode(match[1] ?? ''));

  const candidates = blocks
    .map((line) => line.split(/\r?\n/).map((item) => item.trim()).filter(Boolean))
    .flat()
    .filter((line) => /(msiexec|setup\.exe|\.exe\s|\.msi|\/quiet|\/qn|\/S|\/silent|\/verysilent|uninstall|winget install|winget uninstall|choco install|choco uninstall)/i.test(line));

  const installCommand = candidates.find((line) => !/uninstall/i.test(line) && /(msiexec|winget install|choco install|\/quiet|\/qn|\/s|\/silent|\/verysilent)/i.test(line));
  const uninstallCommand = candidates.find((line) => /uninstall|msiexec\s+\/x|winget uninstall|choco uninstall/i.test(line));
  const directLinks = extractDirectInstallerLinks(html);
  const installerPick = pickBestInstaller(directLinks);

  return {
    installCommand: installCommand?.trim(),
    uninstallCommand: uninstallCommand?.trim(),
    evidence: candidates.slice(0, 8),
    ...installerPick,
    version: extractVersion(stripTags(html))
  };
}

async function searchWingetCatalog(query: string): Promise<WingetSearchRow[]> {
  const html = await fetchText(`https://winget.run/search?query=${encodeURIComponent(query)}`);
  const matches = html.matchAll(/\/pkg\/([^"'?#<\s]+)\/([^"'?#<\s]+)/g);
  const seen = new Set<string>();
  const rows: WingetSearchRow[] = [];

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

  return rows;
}

async function inspectWingetPackagePage(url: string): Promise<InstallerInsight> {
  try {
    const html = await fetchText(url);
    const directLinks = extractDirectInstallerLinks(html);
    const installerPick = pickBestInstaller(directLinks);
    const version = extractVersion(stripTags(html));
    return { ...installerPick, downloadPageUrl: url, version };
  } catch {
    return { downloadPageUrl: url };
  }
}

async function searchSilentInstallHq(query: string): Promise<SilentInstallRow[]> {
  const html = await fetchText(`https://silentinstallhq.com/?s=${encodeURIComponent(query)}`);
  const urls = [...html.matchAll(/href=["'](https:\/\/silentinstallhq\.com\/[^"'#]+)["']/gi)]
    .map((match) => match[1])
    .filter((url): url is string => Boolean(url) && !url.includes('/?s='));
  const uniqueUrls = [...new Set(urls)].slice(0, 6);
  const rows: SilentInstallRow[] = [];

  for (const url of uniqueUrls) {
    try {
      const articleHtml = await fetchText(url);
      const titleMatch = articleHtml.match(/<title>([\s\S]*?)<\/title>/i);
      const title = stripTags(titleMatch?.[1] ?? url);
      const commands = extractCommandsFromHtml(articleHtml);
      if (!commands.installCommand && !commands.uninstallCommand) continue;
      rows.push({
        title,
        url,
        installCommand: commands.installCommand,
        uninstallCommand: commands.uninstallCommand,
        installerUrl: commands.installerUrl,
        installerType: commands.installerType,
        version: commands.version,
        notes: ['Commands captured from Silent Install HQ. Validate against your exact installer media before production use.'],
        evidence: commands.evidence
      });
    } catch {
      // ignore one bad article
    }
  }

  return rows;
}

async function searchChocolateyCatalog(query: string): Promise<ChocolateySearchRow[]> {
  const html = await fetchText(`https://community.chocolatey.org/packages?q=${encodeURIComponent(query)}`);
  const rows: ChocolateySearchRow[] = [];
  const seen = new Set<string>();
  const matches = html.matchAll(/href=["']\/packages\/([^"'#?\s<>]+)["']/gi);

  for (const match of matches) {
    const packageId = decodeURIComponent(match[1] ?? '').trim();
    if (!packageId || seen.has(packageId)) continue;
    if (/^install|^packages$/i.test(packageId)) continue;
    seen.add(packageId);
    rows.push({
      packageId,
      name: packageId.replace(/[._-]+/g, ' '),
      sourceUrl: `https://community.chocolatey.org/packages/${packageId}`
    });
    if (rows.length >= 10) break;
  }

  return rows;
}

async function inspectChocolateyPackagePage(url: string): Promise<InstallerInsight> {
  try {
    const html = await fetchText(url);
    const directLinks = extractDirectInstallerLinks(html);
    const installerPick = pickBestInstaller(directLinks);
    const version = extractVersion(stripTags(html));
    return { ...installerPick, downloadPageUrl: url, version };
  } catch {
    return { downloadPageUrl: url };
  }
}

function buildOfficialDocAlternatives(query: string) {
  const encoded = encodeURIComponent(query);
  return [
    {
      title: `${query} vendor deployment docs`,
      source: 'officialdocs' as Win32SourceType,
      url: `https://www.google.com/search?q=${encoded}+official+deployment+documentation`,
      note: 'Look for official enterprise deployment or silent install documentation.'
    },
    {
      title: `${query} installer releases`,
      source: 'github' as Win32SourceType,
      url: `https://www.google.com/search?q=${encoded}+github+releases+installer`,
      note: 'Useful for release assets, MSI/EXE variants, and version history.'
    }
  ];
}

function buildDetectScript(appName: string) {
  const escapedName = appName.replace(/'/g, "''");
  return `$appName = '${escapedName}'\n$registryPaths = @(\n  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',\n  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'\n)\n$found = Get-ItemProperty -Path $registryPaths -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like "*$appName*" }\nif ($found) {\n  Write-Output "Detected via registry"\n  exit 0\n}\nexit 1`;
}

function computeConfidence(query: string, candidateName: string, publisher: string, sourceType: Win32SourceType, options: { hasInstall: boolean; hasUninstall: boolean; installerType?: InstallerType; installerUrl?: string; docsUrl?: string; releaseUrl?: string; packageId?: string; }) {
  const qTokens = tokenize(query);
  const cTokens = tokenize(candidateName);
  let score = 18;
  const reasons: string[] = [];
  let matchedTokens = 0;
  for (const token of qTokens) {
    if (cTokens.includes(token)) {
      matchedTokens += 1;
      score += 16;
    }
    if (normalize(publisher).includes(token)) score += 6;
  }
  if (matchedTokens) reasons.push(`Matched ${matchedTokens} query token${matchedTokens > 1 ? 's' : ''}`);
  if (normalize(candidateName) === normalize(query)) {
    score += 26;
    reasons.push('Exact product name match');
  }
  if (options.packageId && normalize(options.packageId).includes(normalize(query))) {
    score += 10;
    reasons.push('Package identifier aligns with the query');
  }
  const sourceBonus: Record<Win32SourceType, number> = {
    winget: 24,
    officialdocs: 22,
    github: 18,
    chocolatey: 14,
    silentinstallhq: 10,
    vendor: 12,
    fallback: 0
  };
  score += sourceBonus[sourceType] ?? 0;
  reasons.push(`${sourceType === 'officialdocs' ? 'Official docs' : sourceType === 'github' ? 'GitHub release' : sourceType === 'silentinstallhq' ? 'Silent Install HQ' : sourceType === 'chocolatey' ? 'Chocolatey' : sourceType === 'winget' ? 'WinGet' : 'Vendor'} source metadata found`);
  if (options.hasInstall) {
    score += 10;
    reasons.push('Install command available');
  }
  if (options.hasUninstall) {
    score += 8;
    reasons.push('Uninstall command available');
  }
  if (options.installerUrl) {
    score += 18;
    reasons.push('Direct installer link found');
  }
  if (options.installerType && options.installerType !== 'unknown') {
    score += options.installerType === 'msi' ? 14 : 10;
    reasons.push(`Installer type identified: ${options.installerType.toUpperCase()}`);
  }
  if (options.docsUrl) {
    score += 8;
    reasons.push('Deployment guidance link available');
  }
  if (options.releaseUrl) {
    score += 6;
    reasons.push('Release source available');
  }
  score = Math.max(0, Math.min(99, score));
  const confidence = score >= 82 ? 'high' : score >= 58 ? 'medium' : 'low';
  return { score, confidence, reasons } as const;
}

function resolveExportReadiness(record: Pick<Win32ResolvedRecord, 'installCommand' | 'sourceType' | 'installerUrl' | 'installerType'>): ExportReadiness {
  if (record.installCommand && record.installerUrl && record.installerType && record.installerType !== 'unknown' && !['fallback'].includes(record.sourceType)) return 'ready';
  if (record.installCommand && !['fallback'].includes(record.sourceType)) return 'partial';
  return 'research-needed';
}

function scoreResult(query: string, candidateName: string, publisher: string, sourceType: Win32SourceType, hasBothCommands: boolean, installerType?: InstallerType) {
  let score = computeConfidence(query, candidateName, publisher, sourceType, {
    hasInstall: hasBothCommands,
    hasUninstall: hasBothCommands,
    installerType
  }).score;
  if (sourceType === 'winget') score += 6;
  return score;
}

function toPublicRecord(item: Win32ResolvedRecord) {
  return {
    id: item.id,
    name: item.name,
    publisher: item.publisher,
    packageId: item.packageId,
    source: item.sourceType,
    confidence: item.confidence,
    confidenceScore: item.confidenceScore,
    confidenceReasons: item.confidenceReasons,
    installCommand: item.installCommand,
    uninstallCommand: item.uninstallCommand,
    detectScript: item.detectionScript,
    whySelected: item.whySelected,
    notes: item.notes,
    evidence: item.evidence,
    sourceUrl: item.sourceUrl,
    installerUrl: item.installerUrl,
    installerType: item.installerType,
    downloadPageUrl: item.downloadPageUrl,
    version: item.version,
    docsUrl: item.docsUrl,
    releaseUrl: item.releaseUrl,
    exportReadiness: item.exportReadiness
  };
}

export async function resolveWin32Search(query: string, mode: Win32SearchMode): Promise<Win32SearchResponse> {
  const trimmed = query.trim();
  if (!trimmed) {
    return {
      ok: false,
      query: '',
      mode,
      bestMatch: null,
      candidates: [],
      alternatives: [],
      checkedSources: [],
      message: 'Enter an application name to resolve packaging commands.'
    };
  }

  const queries = expandQueries(trimmed, mode);
  const checkedSources: string[] = [];
  const candidates: Array<Win32ResolvedRecord> = [];
  const altMap = new Map<string, { title: string; source: Win32SourceType; url: string; note: string }>();

  try {
    checkedSources.push('WinGet');
    for (const q of queries) {
      const rows = await searchWingetCatalog(q);
      for (const row of rows) {
        if (candidates.some((item) => item.packageId === row.packageIdentifier)) continue;
        const name = row.name.replace(/\b\w/g, (m) => m.toUpperCase());
        const installer = mode === 'deep' ? await inspectWingetPackagePage(row.sourceUrl) : { downloadPageUrl: row.sourceUrl };
        const confidence = computeConfidence(trimmed, name, row.publisher, 'winget', {
          hasInstall: true,
          hasUninstall: true,
          installerType: installer.installerType,
          installerUrl: installer.installerUrl,
          packageId: row.packageIdentifier,
          docsUrl: installer.docsUrl,
          releaseUrl: installer.releaseUrl
        });
        const record: Win32ResolvedRecord = {
          id: `winget-${slug(row.packageIdentifier)}`,
          name,
          publisher: row.publisher,
          packageId: row.packageIdentifier,
          sourceType: 'winget',
          sourceLabel: 'WinGet',
          sourceUrl: row.sourceUrl,
          sourceTitle: row.packageIdentifier,
          confidence: confidence.confidence,
          confidenceScore: confidence.score,
          confidenceReasons: confidence.reasons,
          installCommand: `winget install --id ${row.packageIdentifier} --exact --silent --accept-source-agreements --accept-package-agreements`,
          uninstallCommand: `winget uninstall --id ${row.packageIdentifier} --exact --silent`,
          detectionScript: buildDetectScript(name),
          detectionSummary: 'Generated detection script based on app name and standard registry uninstall locations.',
          notes: [
            'Install and uninstall commands are source-backed by the WinGet package identifier.',
            installer.installerUrl ? 'Installer evidence was detected from the WinGet package page.' : 'No direct EXE/MSI link was exposed on the package page.',
            'Validate generated detection logic in a packaging VM before production rollout.'
          ],
          evidence: [row.packageIdentifier, row.sourceUrl].filter(Boolean),
          whySelected: `Best source-backed match from WinGet for ${trimmed}.`,
          score: scoreResult(trimmed, name, row.publisher, 'winget', true, installer.installerType),
          installerUrl: installer.installerUrl,
          installerType: installer.installerType,
          downloadPageUrl: installer.downloadPageUrl,
          version: installer.version,
          docsUrl: installer.docsUrl,
          releaseUrl: installer.releaseUrl,
          exportReadiness: 'partial'
        };
        record.exportReadiness = resolveExportReadiness(record);
        candidates.push(record);
        altMap.set(`winget:${row.packageIdentifier}`, {
          title: `${name} (${row.publisher})`,
          source: 'winget',
          url: row.sourceUrl,
          note: `WinGet package: ${row.packageIdentifier}`
        });
      }
    }
  } catch {
    // ignore and continue
  }

  try {
    checkedSources.push('Silent Install HQ');
    for (const q of queries) {
      const rows = await searchSilentInstallHq(q);
      for (const row of rows) {
        const cleanTitle = row.title.replace(/\s*[-|].*$/, '').trim();
        const inferredName = cleanTitle.replace(/silent install.*$/i, '').replace(/how to guide.*$/i, '').trim() || trimmed;
        if (!row.installCommand && !row.uninstallCommand) continue;
        if (candidates.some((item) => item.sourceUrl === row.url)) continue;
        const hasBothCommands = Boolean(row.installCommand && row.uninstallCommand);
        const confidence = computeConfidence(trimmed, inferredName, 'Community source', 'silentinstallhq', {
          hasInstall: Boolean(row.installCommand),
          hasUninstall: Boolean(row.uninstallCommand),
          installerType: row.installerType,
          installerUrl: row.installerUrl,
          docsUrl: row.url
        });
        const record: Win32ResolvedRecord = {
          id: `sihq-${slug(row.url)}`,
          name: inferredName,
          publisher: 'Community source',
          packageId: undefined,
          sourceType: 'silentinstallhq',
          sourceLabel: 'Silent Install HQ',
          sourceUrl: row.url,
          sourceTitle: row.title,
          confidence: confidence.confidence,
          confidenceScore: confidence.score,
          confidenceReasons: confidence.reasons,
          installCommand: row.installCommand ?? '',
          uninstallCommand: row.uninstallCommand ?? '',
          detectionScript: buildDetectScript(inferredName),
          detectionSummary: 'Detection script generated from source-backed app title and common uninstall registry locations.',
          notes: row.notes,
          evidence: row.evidence,
          whySelected: `Community packaging article matched ${trimmed}.`,
          score: scoreResult(trimmed, inferredName, 'Community source', 'silentinstallhq', hasBothCommands, row.installerType),
          installerUrl: row.installerUrl,
          installerType: row.installerType,
          downloadPageUrl: row.url,
          version: row.version,
          docsUrl: row.url,
          releaseUrl: undefined,
          exportReadiness: 'partial'
        };
        record.exportReadiness = resolveExportReadiness(record);
        candidates.push(record);
        altMap.set(`sihq:${row.url}`, {
          title: row.title,
          source: 'silentinstallhq',
          url: row.url,
          note: hasBothCommands ? 'Community article with install and uninstall commands.' : 'Community article with partial packaging guidance.'
        });
      }
    }
  } catch {
    // ignore and continue
  }

  try {
    checkedSources.push('Chocolatey');
    for (const q of queries) {
      const rows = await searchChocolateyCatalog(q);
      for (const row of rows) {
        if (candidates.some((item) => item.packageId?.toLowerCase() === row.packageId.toLowerCase())) continue;
        const name = row.name.replace(/\b\w/g, (m) => m.toUpperCase());
        const installer = mode === 'deep' ? await inspectChocolateyPackagePage(row.sourceUrl) : { downloadPageUrl: row.sourceUrl };
        const confidence = computeConfidence(trimmed, name, 'Chocolatey community', 'chocolatey', {
          hasInstall: true,
          hasUninstall: true,
          installerType: installer.installerType,
          installerUrl: installer.installerUrl,
          packageId: row.packageId,
          releaseUrl: installer.releaseUrl
        });
        const record: Win32ResolvedRecord = {
          id: `choco-${slug(row.packageId)}`,
          name,
          publisher: 'Chocolatey community',
          packageId: row.packageId,
          sourceType: 'chocolatey',
          sourceLabel: 'Chocolatey',
          sourceUrl: row.sourceUrl,
          sourceTitle: row.packageId,
          confidence: confidence.confidence,
          confidenceScore: confidence.score,
          confidenceReasons: confidence.reasons,
          installCommand: `choco install ${row.packageId} -y --no-progress`,
          uninstallCommand: `choco uninstall ${row.packageId} -y --remove-dependencies`,
          detectionScript: buildDetectScript(name),
          detectionSummary: 'Detection script generated from Chocolatey package name and standard uninstall registry locations.',
          notes: [
            'Chocolatey package commands are community-backed and should be validated in a packaging VM before production use.',
            installer.installerUrl ? 'Direct installer evidence was extracted from Chocolatey package metadata.' : 'Chocolatey metadata was found but no direct EXE/MSI link was extracted.',
            'Use Chocolatey when WinGet does not provide the edition or metadata you need.'
          ],
          evidence: [row.packageId, row.sourceUrl].filter(Boolean),
          whySelected: `Chocolatey package matched ${trimmed}.`,
          score: scoreResult(trimmed, name, 'Chocolatey community', 'chocolatey', true, installer.installerType) - 5,
          installerUrl: installer.installerUrl,
          installerType: installer.installerType,
          downloadPageUrl: installer.downloadPageUrl,
          version: installer.version,
          docsUrl: undefined,
          releaseUrl: installer.releaseUrl,
          exportReadiness: 'partial'
        };
        record.exportReadiness = resolveExportReadiness(record);
        candidates.push(record);
        altMap.set(`choco:${row.packageId}`, {
          title: `${name} (${row.packageId})`,
          source: 'chocolatey',
          url: row.sourceUrl,
          note: 'Chocolatey package page with install guidance and community metadata.'
        });
      }
    }
  } catch {
    // ignore and continue
  }

  checkedSources.push('Vendor search');
  for (const vendorQuery of queries.slice(0, mode === 'deep' ? 5 : 3)) {
    const vendorUrl = `https://www.google.com/search?q=${encodeURIComponent(vendorQuery + ' vendor silent install')}`;
    altMap.set(`vendor:${vendorQuery}`, {
      title: `${vendorQuery} vendor search`,
      source: 'vendor',
      url: vendorUrl,
      note: 'Use this when WinGet and community sources do not return a reliable source-backed package.'
    });
  }

  for (const item of buildOfficialDocAlternatives(trimmed)) {
    altMap.set(`${item.source}:${item.url}`, item);
  }

  candidates.sort((a, b) => b.score - a.score);
  const sourceBackedCandidates = candidates.filter((item) => Boolean(item.installCommand) && !['fallback', 'template'].includes(item.sourceType as string));
  const best = sourceBackedCandidates[0] ?? null;

  return {
    ok: Boolean(best || sourceBackedCandidates.length > 0),
    query: trimmed,
    mode,
    bestMatch: best ? toPublicRecord(best) : null,
    candidates: sourceBackedCandidates.slice(0, mode === 'deep' ? 8 : 5).map(toPublicRecord),
    alternatives: [...altMap.values()].filter((item) => !best || item.url !== best.sourceUrl).slice(0, mode === 'deep' ? 8 : 4),
    checkedSources,
    message: best
      ? `Resolved ${best.name} from ${best.sourceLabel}.`
      : 'No reliable source-backed package was found for this query yet. Review the alternatives, switch to Deep Search, or try a more specific edition name.'
  };
}
