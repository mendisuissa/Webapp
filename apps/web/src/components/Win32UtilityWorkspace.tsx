import { useMemo, useState } from 'react';
import {
  downloadWin32PackageBundle,
  resolveWin32Package,
  type Win32AlternativeRecord,
  type Win32ResolveResponse
} from '../api/client.js';

type Mode = 'quick' | 'deep';

type NoticeTone = 'info' | 'success' | 'warn';

const sourceLabel: Record<string, string> = {
  winget: 'WinGet',
  silentinstallhq: 'Silent Install HQ',
  vendor: 'Vendor',
  fallback: 'Fallback'
};

function copyToClipboard(value: string) {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return;
  void navigator.clipboard.writeText(value);
}

function downloadNotes(payload: Win32ResolveResponse) {
  if (typeof window === 'undefined' || !payload.bestMatch) return;
  const m = payload.bestMatch;
  const text = [
    `# ${m.name}`,
    '',
    `Publisher: ${m.publisher}`,
    `Source: ${sourceLabel[m.source] ?? m.source}`,
    `Confidence: ${m.confidence}`,
    `Source URL: ${m.sourceUrl ?? 'N/A'}`,
    '',
    '## Install command',
    m.installCommand,
    '',
    '## Uninstall command',
    m.uninstallCommand,
    '',
    '## Detection script',
    m.detectScript,
    '',
    '## Why selected',
    m.whySelected,
    '',
    '## Evidence',
    ...m.evidence.map((item: string) => `- ${item}`),
    '',
    '## Notes',
    ...m.notes.map((item: string) => `- ${item}`)
  ].join('\n');
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${m.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-win32-notes.md`;
  a.click();
  URL.revokeObjectURL(url);
}

function Notice({ tone, children }: { tone: NoticeTone; children: React.ReactNode }) {
  return <div className={`win32-notice ${tone}`}>{children}</div>;
}

function AlternativeCard({ item }: { item: Win32AlternativeRecord }) {
  return (
    <a className="win32-alt-card" href={item.url} target="_blank" rel="noreferrer">
      <div className="win32-alt-top">
        <span className="win32-source-tag">{sourceLabel[item.source] ?? item.source}</span>
        <span className="win32-alt-open">Open</span>
      </div>
      <div className="win32-alt-title">{item.title}</div>
      <div className="win32-alt-note">{item.note}</div>
    </a>
  );
}

export default function Win32UtilityWorkspace() {
  const [query, setQuery] = useState('Google Chrome');
  const [mode, setMode] = useState<Mode>('quick');
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Win32ResolveResponse | null>(null);

  const best = result?.bestMatch ?? null;
  const hasResult = !!best;

  const checkedSources = useMemo(() => result?.checkedSources ?? ['WinGet', 'Silent Install HQ', 'Vendor search'], [result]);

  async function runResolve() {
    const trimmed = query.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      const payload = await resolveWin32Package(trimmed);
      setResult(payload);
    } catch (resolveError) {
      setResult(null);
      setError(resolveError instanceof Error ? resolveError.message : 'Failed to resolve package.');
    } finally {
      setLoading(false);
    }
  }

  async function handleDownloadBundle() {
    if (!best?.name || !best.installCommand) {
      setError('Resolve a package with a valid install command before downloading the bundle.');
      return;
    }

    setDownloading(true);
    setError(null);
    try {
      await downloadWin32PackageBundle({
        appName: best.name,
        publisher: best.publisher,
        installCommand: best.installCommand,
        uninstallCommand: best.uninstallCommand,
        detectScript: best.detectScript,
        source: sourceLabel[best.source] ?? best.source,
        notes: best.notes ?? []
      });
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : 'Failed to download package folder.');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <section className="win32-shell">
      <div className="win32-header-card info-card drawer-card accent">
        <div>
          <div className="section-title">Win32 Utility</div>
          <div className="summary-text">Search live packaging sources, compare alternatives, and only return source-backed commands when a reliable match is found.</div>
        </div>
        <div className="hero-chips wrap">
          <span className="hero-chip">Sources: WinGet + Silent Install HQ + vendor search</span>
          <span className="hero-chip subtle">Mode: {mode === 'quick' ? 'Quick resolve' : 'Deep search'}</span>
        </div>
      </div>

      <div className="win32-search-card info-card drawer-card">
        <div className="win32-search-row">
          <label className="win32-input-wrap">
            <span className="win32-label">Search application</span>
            <input
              className="column-search win32-search-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Beyond Compare, TreeSize, Advanced IP Scanner"
            />
          </label>
          <div className="win32-actions">
            <button className="btn btn-primary" type="button" onClick={() => void runResolve()} disabled={loading || !query.trim()}>
              {loading ? 'Searching…' : 'Resolve package'}
            </button>
            <button className="btn btn-secondary" type="button" onClick={handleDownloadBundle} disabled={!hasResult || downloading}>
              {downloading ? 'Preparing…' : 'Download package folder'}
            </button>
            <button className="btn btn-secondary" type="button" onClick={() => result && downloadNotes(result)} disabled={!hasResult}>
              Export notes
            </button>
          </div>
        </div>
        <div className="win32-mode-row">
          <button className={`segment-btn ${mode === 'quick' ? 'active' : ''}`} type="button" onClick={() => setMode('quick')}>Quick search</button>
          <button className={`segment-btn ${mode === 'deep' ? 'active' : ''}`} type="button" onClick={() => setMode('deep')}>Deep search</button>
        </div>
        <div className="hero-chips wrap" style={{ marginTop: '12px' }}>
          {checkedSources.map((source: string) => (
            <span key={source} className="hero-chip subtle">Checked: {source}</span>
          ))}
        </div>
      </div>

      {error ? <Notice tone="warn">{error}</Notice> : null}

      {loading ? (
        <Notice tone="info">Looking across packaging sources and ranking the best match for <strong>{query}</strong>.</Notice>
      ) : null}

      {result && !result.ok ? (
        <div className="win32-empty-grid">
          <div className="info-card drawer-card accent">
            <div className="section-title">No reliable source found</div>
            <div className="summary-text">{result.message}</div>
            <div className="readiness-list" style={{ marginTop: '14px' }}>
              <div className="readiness-item"><span>1</span><span>Try a simpler product name such as the vendor product name only.</span></div>
              <div className="readiness-item"><span>2</span><span>Use Deep Search to review community or vendor candidates.</span></div>
              <div className="readiness-item"><span>3</span><span>Open one of the sources below to validate packaging guidance before rollout.</span></div>
            </div>
          </div>
          <div className="win32-alt-grid">
            {result.alternatives.map((item: Win32AlternativeRecord) => <AlternativeCard key={item.url} item={item} />)}
          </div>
        </div>
      ) : null}

      {hasResult ? (
        <div className="win32-main-grid">
          <div className="win32-left-stack">
            <div className="info-card drawer-card accent">
              <div className="win32-card-top">
                <div>
                  <div className="section-title">Best match</div>
                  <div className="summary-text">{best.name} • {best.publisher}</div>
                </div>
                <div className="hero-chips wrap">
                  <span className="hero-chip">Source: {sourceLabel[best.source] ?? best.source}</span>
                  <span className={`hero-chip subtle win32-confidence-pill win32-confidence-${best.confidence}`}>Confidence: {best.confidence}</span>
                </div>
              </div>
              <div className="detail-list">
                <div className="detail-row"><div className="detail-key">Package ID</div><div className="detail-value">{best.packageId}</div></div>
                <div className="detail-row stack"><div className="detail-key">Why selected</div><div className="detail-value">{best.whySelected}</div></div>
                <div className="detail-row stack"><div className="detail-key">Evidence</div><div className="detail-value">{best.evidence.join(' • ')}</div></div>
              </div>
              {best.sourceUrl ? (
                <div className="drawer-actions compact" style={{ marginTop: '12px' }}>
                  <a className="btn btn-secondary" href={best.sourceUrl} target="_blank" rel="noreferrer">Open source</a>
                </div>
              ) : null}
            </div>

            <div className="info-card drawer-card">
              <div className="section-title">Commands</div>
              <div className="win32-command-grid-pretty">
                <div className="win32-code-card">
                  <div className="win32-code-head">
                    <span>Install command</span>
                    <button className="btn btn-secondary" type="button" onClick={() => copyToClipboard(best.installCommand)}>Copy</button>
                  </div>
                  <pre className="code-surface">{best.installCommand}</pre>
                </div>
                <div className="win32-code-card">
                  <div className="win32-code-head">
                    <span>Uninstall command</span>
                    <button className="btn btn-secondary" type="button" onClick={() => copyToClipboard(best.uninstallCommand)}>Copy</button>
                  </div>
                  <pre className="code-surface">{best.uninstallCommand}</pre>
                </div>
              </div>
            </div>

            <div className="info-card drawer-card">
              <div className="win32-code-head">
                <div>
                  <div className="section-title">Detection script</div>
                  <div className="panel-caption">Generated from source-backed evidence and standard uninstall registry locations.</div>
                </div>
                <button className="btn btn-secondary" type="button" onClick={() => copyToClipboard(best.detectScript)}>Copy script</button>
              </div>
              <pre className="code-surface">{best.detectScript}</pre>
            </div>
          </div>

          <div className="win32-right-stack">
            <Notice tone={best.source === 'winget' ? 'success' : 'warn'}>
              {best.source === 'winget'
                ? 'This result is source-backed from WinGet. Detection is generated, so validate before production rollout.'
                : 'This result came from a community or fallback path. Validate commands against the linked source before production rollout.'}
            </Notice>

            <div className="info-card drawer-card">
              <div className="section-title">Alternative matches</div>
              {result?.alternatives?.length ? (
                <div className="win32-alt-grid compact">
                  {result.alternatives.map((item: Win32AlternativeRecord) => <AlternativeCard key={item.url} item={item} />)}
                </div>
              ) : (
                <div className="summary-text">No additional alternatives were returned for this query.</div>
              )}
            </div>

            <div className="info-card drawer-card">
              <div className="section-title">Packaging notes</div>
              <ul className="plain-list">
                {best.notes.map((note: string) => <li key={note}>{note}</li>)}
              </ul>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
