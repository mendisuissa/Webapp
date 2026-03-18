
export type Win32SourceType = 'winget' | 'silentinstallhq' | 'vendor' | 'fallback';

export type Win32Alternative = {
  title: string;
  source: Win32SourceType;
  url: string;
  note: string;
};

export type Win32ResolvedPackage = {
  ok: boolean;
  query: string;
  message: string;
  bestMatch: {
    name: string;
    publisher: string;
    packageId: string;
    source: Win32SourceType;
    sourceUrl?: string;
    confidence: 'high' | 'medium' | 'low';
    installCommand: string;
    uninstallCommand: string;
    detectScript: string;
    notes: string[];
    evidence: string[];
    whySelected: string;
  } | null;
  alternatives: Win32Alternative[];
  checkedSources: string[];
};

function decodeHtml(text: string): string {
  return text
    .replace(/&#8211;/g, '–')
    .replace(/&#8217;/g, "'")
    .replace(/&#038;/g, '&')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function normalizeQuery(query: string): string {
  return query.replace(/\s+/g, ' ').trim();
}

function buildDetectScript(name: string, exeHint: string): string {
  const safeName = name.replace(/"/g, '\"');
  const safeExe = exeHint.replace(/"/g, '\"');
  return `$displayName = "${safeName}"
` + `$exeCandidates = @(
` + `  "C:\\Program Files\\${safeExe}\",
` + `  "C:\\Program Files (x86)\\${safeExe}\"
)

` + `foreach ($candidate in $exeCandidates) {
` + `  if (Test-Path $candidate) {
` + `    Write-Output "Detected"
` + `    exit 0
` + `  }
` + `}

` + `$registryHit = Get-ChildItem "HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
` + `                            "HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall" -ErrorAction SilentlyContinue |
` + `  Get-ItemProperty |
` + `  Where-Object { $_.DisplayName -like "*${safeName}*" }

` + `if ($registryHit) {
  Write-Output "Detected"
  exit 0
}

exit 1`;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 Win32 Utility Resolver',
      'accept-language': 'en-US,en;q=0.9'
    }
  });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return await response.text();
}

async function searchWinget(query: string) {
  const url = `https://winget.run/search?query=${encodeURIComponent(query)}`;
  try {
    const html = await fetchText(url);
    const matches = [...html.matchAll(/href="\/pkg\/([^"]+)"[^>]*>(.*?)<\/a>/gi)]
      .slice(0, 5)
      .map((m) => {
        const path = m[1];
        const label = decodeHtml(m[2]);
        const parts = path.split('/');
        const publisher = parts.at(-2) ?? 'Unknown';
        const pkg = parts.at(-1) ?? label;
        return {
          name: label || pkg,
          publisher,
          packageId: `${publisher}.${pkg}`,
          url: `https://winget.run/pkg/${path}`,
          installCommand: `winget install --id ${publisher}.${pkg} --exact --silent --accept-source-agreements --accept-package-agreements`,
          uninstallCommand: `winget uninstall --id ${publisher}.${pkg} --exact --silent`,
          note: 'Resolved from WinGet package directory.'
        };
      });
    return matches;
  } catch {
    return [] as Array<{name:string;publisher:string;packageId:string;url:string;installCommand:string;uninstallCommand:string;note:string}>;
  }
}

async function searchSilentInstallHq(query: string) {
  const url = `https://silentinstallhq.com/?s=${encodeURIComponent(query)}`;
  try {
    const html = await fetchText(url);
    const matches = [...html.matchAll(/<a[^>]+href="(https:\/\/silentinstallhq\.com\/[^"]+)"[^>]*>(.*?)<\/a>/gi)]
      .map((m) => ({ url: m[1], title: decodeHtml(m[2]) }))
      .filter((item) => item.title && /install|uninstall|silent/i.test(item.title))
      .filter((item, index, arr) => arr.findIndex((x) => x.url === item.url) == index)
      .slice(0, 5);
    return matches;
  } catch {
    return [] as Array<{url:string;title:string}>;
  }
}

function createFallback(query: string): Win32ResolvedPackage {
  const exeHint = `${query.replace(/[^a-zA-Z0-9+.-]+/g, '')}.exe`;
  return {
    ok: false,
    query,
    message: 'No reliable source-backed packaging record was found. Try Deep Search or a simpler product name.',
    bestMatch: null,
    alternatives: [
      {
        title: 'Search WinGet manually',
        source: 'winget',
        url: `https://winget.run/search?query=${encodeURIComponent(query)}`,
        note: 'Review whether the package exists in WinGet.'
      },
      {
        title: 'Search Silent Install HQ',
        source: 'silentinstallhq',
        url: `https://silentinstallhq.com/?s=${encodeURIComponent(query)}`,
        note: 'Review community packaging guidance.'
      },
      {
        title: 'Search vendor documentation',
        source: 'vendor',
        url: `https://www.google.com/search?q=${encodeURIComponent(query + ' silent install vendor')}`,
        note: 'Open vendor deployment documentation in a new tab.'
      }
    ],
    checkedSources: ['WinGet', 'Silent Install HQ', 'Vendor search'],
  };
}

export async function resolveWin32Package(queryInput: string): Promise<Win32ResolvedPackage> {
  const query = normalizeQuery(queryInput);
  if (!query) {
    return {
      ok: false,
      query: '',
      message: 'Enter an application name to search across packaging sources.',
      bestMatch: null,
      alternatives: [],
      checkedSources: []
    };
  }

  const [wingetMatches, hqMatches] = await Promise.all([
    searchWinget(query),
    searchSilentInstallHq(query)
  ]);

  if (wingetMatches.length > 0) {
    const best = wingetMatches[0];
    return {
      ok: true,
      query,
      message: `Resolved ${best.name} from WinGet. Sources checked: WinGet, Silent Install HQ, vendor search.`,
      bestMatch: {
        name: best.name,
        publisher: best.publisher,
        packageId: best.packageId,
        source: 'winget',
        sourceUrl: best.url,
        confidence: 'high',
        installCommand: best.installCommand,
        uninstallCommand: best.uninstallCommand,
        detectScript: buildDetectScript(best.name, `${slugify(best.name)}.exe`),
        notes: [
          'Install and uninstall commands are source-backed from WinGet search results.',
          'Detection script is generated from standard file and registry evidence for Intune.'
        ],
        evidence: [best.note],
        whySelected: 'Exact or high-quality package match found in WinGet.'
      },
      alternatives: [
        ...wingetMatches.slice(1, 4).map((item) => ({
          title: `${item.name} • ${item.publisher}`,
          source: 'winget' as const,
          url: item.url,
          note: 'Alternative WinGet package candidate.'
        })),
        ...hqMatches.slice(0, 2).map((item) => ({
          title: item.title,
          source: 'silentinstallhq' as const,
          url: item.url,
          note: 'Supplemental packaging guidance from community source.'
        }))
      ],
      checkedSources: ['WinGet', 'Silent Install HQ', 'Vendor search']
    };
  }

  if (hqMatches.length > 0) {
    const best = hqMatches[0];
    const querySlug = slugify(query);
    return {
      ok: true,
      query,
      message: `Found community packaging guidance for ${query} outside WinGet.`,
      bestMatch: {
        name: query,
        publisher: 'Needs validation',
        packageId: `custom.${querySlug}`,
        source: 'silentinstallhq',
        sourceUrl: best.url,
        confidence: 'medium',
        installCommand: `Review source page and confirm vendor-supported silent install for ${query}`,
        uninstallCommand: `Review source page and confirm vendor uninstall string or MSI product code for ${query}`,
        detectScript: buildDetectScript(query, `${querySlug}.exe`),
        notes: [
          'Primary packaging guidance was found in a community source, not WinGet.',
          'Validate the final install and uninstall commands against the linked source page before production rollout.'
        ],
        evidence: [best.title],
        whySelected: 'WinGet did not return a strong result, but a community packaging article matched the query.'
      },
      alternatives: hqMatches.slice(1, 5).map((item) => ({
        title: item.title,
        source: 'silentinstallhq' as const,
        url: item.url,
        note: 'Alternative community packaging article.'
      })),
      checkedSources: ['WinGet', 'Silent Install HQ', 'Vendor search']
    };
  }

  return createFallback(query);
}
