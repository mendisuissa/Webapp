export type Win32SearchMode = 'quick' | 'deep';
export type Win32SourceType = 'winget' | 'silentinstallhq';
export type Win32ResolutionType = 'source_backed' | 'generated_detection';

export type Win32ResolvedRecord = {
  id: string;
  name: string;
  publisher: string;
  packageId?: string;
  sourceType: Win32SourceType;
  sourceLabel: string;
  sourceUrl: string;
  sourceTitle: string;
  resolutionType: Win32ResolutionType;
  confidence: 'high' | 'medium';
  installCommand: string;
  uninstallCommand: string;
  detectionScript: string;
  detectionSummary: string;
  notes: string[];
  evidence?: string[];
};

export type Win32SearchResponse = {
  query: string;
  mode: Win32SearchMode;
  bestMatch: Win32ResolvedRecord | null;
  alternatives: Win32ResolvedRecord[];
  sourcesChecked: string[];
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
};

const USER_AGENT = 'ModernEndpoint/1.0';

function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/\b(x64|x86|64-bit|32-bit|installer|setup|silent|enterprise|workplace)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function slug(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
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

async function fetchText(url: string) {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) {
    throw new Error(`Fetch failed for ${url} (${response.status}).`);
  }
  return await response.text();
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
    if (rows.length >= 10) break;
  }

  return rows;
}

function extractCommandsFromHtml(html: string) {
  const blocks = [
    ...html.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/gi),
    ...html.matchAll(/<code[^>]*>([\s\S]*?)<\/code>/gi)
  ].map((match) => stripTags(match[1] ?? ''));

  const candidates = blocks
    .map((line) => line.split(/\r?\n/).map((item) => item.trim()).filter(Boolean))
    .flat()
    .filter((line) => /(msiexec|setup\.exe|\.exe\s|\.msi|\/quiet|\/qn|\/S|\/silent|\/verysilent|uninstall|winget install|winget uninstall)/i.test(line));

  const installCommand = candidates.find(
    (line) => !/uninstall/i.test(line) && /(msiexec|winget install|\/quiet|\/qn|\/s|\/silent|\/verysilent)/i.test(line)
  );
  const uninstallCommand = candidates.find((line) => /uninstall|msiexec\s+\/x|winget uninstall/i.test(line));
  return {
    installCommand: installCommand?.trim(),
    uninstallCommand: uninstallCommand?.trim(),
    evidence: candidates.slice(0, 8)
  };
}

async function searchSilentInstallHq(query: string): Promise<SilentInstallRow[]> {
  const searchUrl = `https://silentinstallhq.com/?s=${encodeURIComponent(query)}`;
  const html = await fetchText(searchUrl);
  const matches = [...html.matchAll(/href=["'](https:\/\/silentinstallhq\.com\/[^"'#]+)["']/gi)]
    .map((match) => match[1])
    .filter((url): url is string => Boolean(url) && !url.includes('/?s='));
  const uniqueUrls = [...new Set(matches)].slice(0, 5);
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
        notes: ['Commands captured from Silent Install HQ content. Validate against your media before production use.'],
        evidence: commands.evidence
      });
    } catch {
      // continue
    }
  }

  return rows;
}

function buildDetectScript(appName: string) {
  const escapedName = appName.replace(/'/g, "''");
  const nameTokens = appName.split(/\s+/).filter(Boolean).slice(0, 3);
  const exeCandidates = [...new Set(nameTokens.map((item) => item.replace(/[^a-zA-Z0-9]/g, '')).filter(Boolean))]
    .slice(0, 2)
    .map(
      (item) =>
        `  "C:\\Program Files\\${escapedName}\\${item}.exe",\n  "C:\\Program Files (x86)\\${escapedName}\\${item}.exe"`
    )
    .join(',\n');

  return `$appName = '${escapedName}'
$registryPaths = @(
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
)
$found = Get-ItemProperty -Path $registryPaths -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like "*$appName*" }
if ($found) {
  Write-Output "Detected via registry"
  exit 0
}
$paths = @(
${exeCandidates || '  "C:\\Program Files\\App\\App.exe"'}
)
foreach ($path in $paths) {
  if (Test-Path $path) {
    Write-Output "Detected via file"
    exit 0
  }
}
exit 1`;
}

function scoreResult(query: string, name: string, publisher: string, sourceType: Win32SourceType, hasBothCommands: boolean) {
  const q = normalize(query);
  const n = normalize(name);
  let score = 0;
  if (n === q) score += 120;
  if (n.includes(q) || q.includes(n)) score += 80;
  if (normalize(publisher).includes(q)) score += 20;
  if (sourceType === 'winget') score += 20;
  if (hasBothCommands) score += 30;
  return score;
}

export async function resolveWin32Search(query: string, mode: Win32SearchMode): Promise<Win32SearchResponse> {
  const trimmed = query.trim();
  if (!trimmed) {
    return {
      query: '',
      mode,
      bestMatch: null,
      alternatives: [],
      sourcesChecked: [],
      message: 'Enter an application name to resolve packaging commands.'
    };
  }

  const sourcesChecked: string[] = [];
  const candidates: Array<Win32ResolvedRecord & { score: number }> = [];

  try {
    sourcesChecked.push('WinGet');
    const wingetRows = await searchWingetCatalog(trimmed);
    for (const row of wingetRows) {
      candidates.push({
        id: `winget-${slug(row.packageIdentifier)}`,
        name: row.name,
        publisher: row.publisher,
        packageId: row.packageIdentifier,
        sourceType: 'winget',
        sourceLabel: 'WinGet',
        sourceUrl: row.sourceUrl,
        sourceTitle: row.packageIdentifier,
        resolutionType: 'source_backed',
        confidence: 'high',
        installCommand: `winget install --id ${row.packageIdentifier} --exact --silent --accept-source-agreements --accept-package-agreements`,
        uninstallCommand: `winget uninstall --id ${row.packageIdentifier} --exact --silent`,
        detectionScript: buildDetectScript(row.name),
        detectionSummary: 'Generated detection script based on app name and standard registry uninstall locations.',
        notes: [
          'Install and uninstall commands are sourced from the WinGet package identifier.',
          'Detection script is generated from source clues and should be validated on a test VM.'
        ],
        evidence: [row.packageIdentifier, row.sourceUrl],
        score: scoreResult(trimmed, row.name, row.publisher, 'winget', true)
      });
    }
  } catch {
    // ignore and continue
  }

  try {
    sourcesChecked.push('Silent Install HQ');
    const silentRows = await searchSilentInstallHq(trimmed);
    for (const row of silentRows) {
      const cleanTitle = row.title.replace(/\s*[-|].*$/, '').trim();
      const inferredName = cleanTitle.replace(/silent install.*$/i, '').replace(/how to guide.*$/i, '').trim() || trimmed;
      const hasBothCommands = Boolean(row.installCommand && row.uninstallCommand);
      if (!row.installCommand && !row.uninstallCommand) continue;
      candidates.push({
        id: `sihq-${slug(row.url)}`,
        name: inferredName,
        publisher: 'Community source',
        sourceType: 'silentinstallhq',
        sourceLabel: 'Silent Install HQ',
        sourceUrl: row.url,
        sourceTitle: row.title,
        resolutionType: 'source_backed',
        confidence: 'medium',
        installCommand: row.installCommand ?? 'No source-backed install command found on this page.',
        uninstallCommand: row.uninstallCommand ?? 'No source-backed uninstall command found on this page.',
        detectionScript: buildDetectScript(inferredName),
        detectionSummary: 'Detection script generated from source-backed app title and common uninstall registry locations.',
        notes: row.notes,
        evidence: row.evidence,
        score: scoreResult(trimmed, inferredName, 'Community source', 'silentinstallhq', hasBothCommands)
      });
    }
  } catch {
    // ignore and continue
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0] ?? null;
  const alternatives = (mode === 'deep' ? candidates.slice(1, 6) : candidates.slice(1, 3)).map(({ score, ...item }) => item);

  return {
    query: trimmed,
    mode,
    bestMatch: best ? (({ score, ...item }) => item)(best) : null,
    alternatives,
    sourcesChecked,
    message: best
      ? `Resolved ${best.name} from ${best.sourceLabel}.`
      : 'No reliable source-backed command set was found. Try Deep Search or validate manually.'
  };
}
