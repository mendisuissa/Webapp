import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';

type Win32SearchMode = 'quick' | 'deep' | 'catalog';

interface Win32CatalogMatch {
  packageKey: string;
  name: string;
  publisher?: string;
  sourceUrl?: string;
}

interface Win32ResolvedRecord {
  packageKey?: string;
  id?: string;
  name: string;
  publisher?: string;
  packageId?: string;
  detectionType?: string;
  detectionSummary?: string;
  installCommand?: string;
  uninstallCommand?: string;
  detectScript?: string;
  sourceUrl?: string;
  source?: string;
  confidence?: string | number;
  notes?: string[];
  validationChecklist?: string[];
}

async function getWin32Catalog(prefix: string) {
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

async function searchWin32Resolver(query: string, mode: Win32SearchMode) {
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
      source: item.sourceType ?? item.source ?? '',
      confidence: item.confidence ?? '',
      notes: Array.isArray(item.notes) ? item.notes : [],
      validationChecklist: Array.isArray(item.validationChecklist) ? item.validationChecklist : []
    };
  };

  return {
    resolved: mapResolved(data?.bestMatch ?? null),
    alternatives: (Array.isArray(data?.alternatives) ? data.alternatives.map(mapResolved).filter(Boolean) : []) as Win32ResolvedRecord[],
    catalogCount: data?.catalogCount ?? 0,
    message: data?.message ?? ''
  };
}

async function downloadWin32Bundle(packageKey: string, _name?: string) {
  const url = `/win32/bundle/${encodeURIComponent(packageKey)}`;
  const response = await api.get(url, { responseType: 'blob' as const });
  return response.data as Blob;
}

type Props = {
  onToast?: (tone: 'info' | 'success' | 'warn' | 'error', text: string) => void;
};

const modeLabel: Record<Win32SearchMode, string> = {
  quick: 'Quick Resolve',
  deep: 'Deep Search',
  catalog: 'Catalog Only'
};

const sourceLabel: Record<string, string> = {
  vendor: 'Vendor',
  silentinstallhq: 'Silent Install HQ',
  winget: 'WinGet',
  heuristic: 'Heuristic'
};

function copyToClipboard(value?: string, onToast?: Props['onToast']) {
  if (!value) return;
  if (typeof navigator === 'undefined' || !navigator.clipboard) return;
  void navigator.clipboard.writeText(value);
  onToast?.('success', 'Copied to clipboard.');
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function Win32PackageBuilderWorkspace({ onToast }: Props) {
  const [query, setQuery] = useState('Beyond Compare');
  const [mode, setMode] = useState<Win32SearchMode>('quick');
  const [loading, setLoading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [catalogCount, setCatalogCount] = useState(0);
  const [catalogPreview, setCatalogPreview] = useState<Win32CatalogMatch[]>([]);
  const [resolved, setResolved] = useState<Win32ResolvedRecord | null>(null);
  const [alternatives, setAlternatives] = useState<Win32ResolvedRecord[]>([]);
  const [message, setMessage] = useState('Resolve a package to generate packaging commands and a downloadable Intune source bundle.');

  useEffect(() => {
    void (async () => {
      try {
        const result = await getWin32Catalog('');
        setCatalogCount(result.count);
        setCatalogPreview(result.rows.slice(0, 6));
      } catch {
        setCatalogCount(0);
      }
    })();
  }, []);

  async function resolvePackage(nextQuery = query, nextMode = mode) {
    setLoading(true);
    try {
      const result = await searchWin32Resolver(nextQuery, nextMode);
      setResolved(result.resolved);
      setAlternatives(result.alternatives ?? []);
      setCatalogCount(result.catalogCount ?? catalogCount);
      setMessage(result.message);
      onToast?.('success', result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Resolve failed.');
      onToast?.('error', 'Win32 resolve failed.');
    } finally {
      setLoading(false);
    }
  }

  async function buildBundle() {
    if (!resolved) {
      onToast?.('warn', 'Resolve an app first.');
      return;
    }
    if (!resolved.packageKey) {
      onToast?.('error', 'No package key available.');
      return;
    }
    setBuilding(true);
    try {
      const blob = await downloadWin32Bundle(resolved.packageKey, resolved.name);
      downloadBlob(blob, `${resolved.packageKey}-intune-package-source.zip`);
      onToast?.('success', 'Downloaded Intune package source bundle.');
    } catch {
      onToast?.('error', 'Failed to build package bundle.');
    } finally {
      setBuilding(false);
    }
  }

  const bundleFiles = useMemo(() => {
    const slug = resolved?.packageKey ?? 'package';
    return [
      `${slug}/install.ps1`,
      `${slug}/uninstall.ps1`,
      `${slug}/detect.ps1`,
      `${slug}/app-manifest.json`,
      `${slug}/package-notes.md`,
      `${slug}/import-checklist.md`,
      `${slug}/files/.keep`
    ];
  }, [resolved?.packageKey]);

  return (
    <div className="winget-workspace-grid enhanced">
      <div className="info-card drawer-card accent" style={{ gridColumn: '1 / -1' }}>
        <div className="section-title">Win32 Package Builder</div>
        <div className="summary-text">
          Free search, deep search, best match, alternatives, and a downloadable Intune package source bundle.
        </div>
        <div className="drawer-actions compact wrap">
          <input
            className="column-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search any app name, vendor, or package ID"
            style={{ minWidth: '280px', flex: '1 1 320px' }}
          />
          <button className="btn btn-primary" type="button" disabled={loading} onClick={() => void resolvePackage()}>
            {loading ? 'Resolving...' : 'Resolve package'}
          </button>
          <button className="btn btn-secondary" type="button" disabled={!resolved || building} onClick={() => void buildBundle()}>
            {building ? 'Building...' : 'Build Intune package bundle'}
          </button>
        </div>
        <div className="win32-mode-row">
          {(Object.keys(modeLabel) as Win32SearchMode[]).map((item) => (
            <button
              key={item}
              type="button"
              className={`win32-mode-pill ${mode === item ? 'is-active' : ''}`}
              onClick={() => {
                setMode(item);
                void resolvePackage(query, item);
              }}
            >
              {modeLabel[item]}
            </button>
          ))}
        </div>
        <div className="hero-chips wrap" style={{ marginTop: '14px' }}>
          <span className="hero-chip">Catalog records: {catalogCount.toLocaleString()}</span>
          <span className="hero-chip subtle">Mode: {modeLabel[mode]}</span>
          {resolved ? <span className="hero-chip subtle">Source: {sourceLabel[resolved.source ?? 'heuristic']}</span> : null}
          {resolved ? <span className="hero-chip subtle">Confidence: {resolved.confidence}</span> : null}
        </div>
      </div>

      <div className="info-card drawer-card">
        <div className="section-title">Best match</div>
        {resolved ? (
          <>
            <div className="detail-list">
              <div className="detail-row"><div className="detail-key">App</div><div className="detail-value">{resolved.name}</div></div>
              <div className="detail-row"><div className="detail-key">Publisher</div><div className="detail-value">{resolved.publisher}</div></div>
              <div className="detail-row"><div className="detail-key">Package ID</div><div className="detail-value">{resolved.packageId}</div></div>
              <div className="detail-row"><div className="detail-key">Detection</div><div className="detail-value">{resolved.detectionType}</div></div>
              <div className="detail-row stack"><div className="detail-key">Summary</div><div className="detail-value">{resolved.detectionSummary}</div></div>
            </div>
            <div className="drawer-actions compact wrap" style={{ marginTop: '12px' }}>
              <button className="btn btn-secondary" type="button" onClick={() => copyToClipboard(resolved.installCommand, onToast)}>Copy install</button>
              <button className="btn btn-secondary" type="button" onClick={() => copyToClipboard(resolved.detectScript, onToast)}>Copy detect script</button>
              {resolved.sourceUrl ? (
                <a className="btn btn-ghost" href={resolved.sourceUrl} target="_blank" rel="noreferrer">Open source</a>
              ) : null}
            </div>
          </>
        ) : (
          <div className="summary-text">{message}</div>
        )}
      </div>

      <div className="info-card drawer-card">
        <div className="section-title">Alternative matches</div>
        <div className="readiness-list">
          {alternatives.length > 0 ? alternatives.map((item, index) => (
            <button key={`${item.packageKey ?? item.id ?? index}`} type="button" className="win32-alt-choice" onClick={() => { setQuery(item.name); void resolvePackage(item.name, mode); }}>
              <span>{item.name}</span>
              <span className="subtle-text">{item.publisher}</span>
            </button>
          )) : catalogPreview.map((item, index) => (
            <button key={`${item.packageKey}-${index}`} type="button" className="win32-alt-choice" onClick={() => { setQuery(item.name); void resolvePackage(item.name, mode); }}>
              <span>{item.name}</span>
              <span className="subtle-text">{item.publisher}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="info-card drawer-card">
        <div className="section-title">Bundle preview</div>
        <div className="summary-text">Build Intune package bundle downloads a zip with packaging source files and a files/ folder placeholder for the installer.</div>
        <div className="win32-bundle-list">
          {bundleFiles.map((item) => (
            <div key={item} className="win32-bundle-item">{item}</div>
          ))}
        </div>
      </div>

      {resolved ? (
        <div className="info-card drawer-card" style={{ gridColumn: '1 / -1' }}>
          <div className="winget-review-grid">
            <div className="review-column">
              <div className="section-title">Silent install</div>
              <div className="detail-row stack"><div className="detail-value code">{resolved.installCommand}</div></div>
              <div className="drawer-actions compact"><button className="btn btn-secondary" type="button" onClick={() => copyToClipboard(resolved.installCommand, onToast)}>Copy</button></div>
            </div>
            <div className="review-column">
              <div className="section-title">Silent uninstall</div>
              <div className="detail-row stack"><div className="detail-value code">{resolved.uninstallCommand}</div></div>
              <div className="drawer-actions compact"><button className="btn btn-secondary" type="button" onClick={() => copyToClipboard(resolved.uninstallCommand, onToast)}>Copy</button></div>
            </div>
            <div className="review-column">
              <div className="section-title">Detect script</div>
              <div className="detail-row stack"><div className="detail-value code">{resolved.detectScript}</div></div>
              <div className="drawer-actions compact"><button className="btn btn-secondary" type="button" onClick={() => copyToClipboard(resolved.detectScript, onToast)}>Copy</button></div>
            </div>
          </div>
        </div>
      ) : null}

      {resolved ? (
        <>
          <div className="info-card drawer-card">
            <div className="section-title">Validation notes</div>
            <div className="readiness-list">
              {(resolved.notes ?? []).map((note: string, index: number) => (
                <div key={`note-${index}`} className="readiness-item ok"><span>{index + 1}</span><span>{note}</span></div>
              ))}
            </div>
          </div>
          <div className="info-card drawer-card">
            <div className="section-title">Validation checklist</div>
            <div className="readiness-list">
              {(resolved.validationChecklist ?? []).map((note: string, index: number) => (
                <div key={`check-${index}`} className="readiness-item ok"><span>{index + 1}</span><span>{note}</span></div>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
