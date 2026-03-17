import { useEffect, useMemo, useState } from 'react';
import {
  downloadWin32Bundle,
  getWin32Catalog,
  searchWin32Resolver,
  type Win32CatalogMatch,
  type Win32ResolvedRecord,
  type Win32SearchMode
} from '../api/client.js';

type Props = {
  onToast?: (tone: 'info' | 'success' | 'warn' | 'error', text: string) => void;
};

const modeLabel: Record<Win32SearchMode, string> = {
  quick: 'Quick Resolve',
  deep: 'Deep Search',
  catalog: 'Catalog Only'
};

const sourceLabel: Record<Win32ResolvedRecord['source'], string> = {
  vendor: 'Vendor',
  silentinstallhq: 'Silent Install HQ',
  winget: 'WinGet',
  heuristic: 'Heuristic'
};

function copyToClipboard(value: string, onToast?: Props['onToast']) {
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
  const [alternatives, setAlternatives] = useState<Win32CatalogMatch[]>([]);
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
          {resolved ? <span className="hero-chip subtle">Source: {sourceLabel[resolved.source]}</span> : null}
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
            <button key={`${item.packageKey}-${index}`} type="button" className="win32-alt-choice" onClick={() => { setQuery(item.name); void resolvePackage(item.name, mode); }}>
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
              {resolved.notes.map((note, index) => (
                <div key={`note-${index}`} className="readiness-item ok"><span>{index + 1}</span><span>{note}</span></div>
              ))}
            </div>
          </div>
          <div className="info-card drawer-card">
            <div className="section-title">Validation checklist</div>
            <div className="readiness-list">
              {resolved.validationChecklist.map((note, index) => (
                <div key={`check-${index}`} className="readiness-item ok"><span>{index + 1}</span><span>{note}</span></div>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
