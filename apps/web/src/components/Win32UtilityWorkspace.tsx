import { useMemo, useState } from 'react';
import {
  downloadWin32PackageBundle,
  resolveWin32Package,
  type Win32AlternativeRecord,
  type Win32CandidateRecord,
  type Win32ResolveResponse,
  type Win32ResolvedMatch
} from '../api/client.js';

function getCandidateKey(item: Win32CandidateRecord): string {
  return item.packageId || item.sourceUrl || `${item.name}-${item.publisher}-${item.source}`;
}

function getResolvedKey(item: Win32ResolvedMatch | null | undefined): string | null {
  if (!item) return null;
  return item.packageId || item.sourceUrl || `${item.name}-${item.publisher}-${item.source}`;
}

type Mode = 'quick' | 'deep';
type NoticeTone = 'info' | 'success' | 'warn';

const sourceLabel: Record<string, string> = {
  winget: 'WinGet',
  silentinstallhq: 'Silent Install HQ',
  vendor: 'Vendor',
  fallback: 'Fallback',
  template: 'Template'
};

function copyToClipboard(value: string) {
  if (typeof navigator === 'undefined' || !navigator.clipboard || !value) return;
  void navigator.clipboard.writeText(value);
}

function triggerBlobDownload(blob: Blob, filename: string) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
    ...m.evidence.map((item) => `- ${item}`),
    '',
    '## Notes',
    ...m.notes.map((item) => `- ${item}`)
  ].join('\n');
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  triggerBlobDownload(blob, `${m.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-win32-notes.md`);
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

function CandidateCard({
  item,
  active,
  onSelect
}: {
  item: Win32ResolvedMatch;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button type="button" className={`win32-choice-card ${active ? 'is-active' : ''}`} onClick={() => onSelect(getCandidateKey(item))}>
      <div className="win32-choice-top">
        <div>
          <div className="win32-choice-title">{item.name}</div>
          <div className="win32-choice-meta">{item.publisher}</div>
        </div>
        <span className={`hero-chip subtle win32-confidence-${item.confidence}`}>Confidence: {item.confidence}</span>
      </div>
      <div className="hero-chips wrap" style={{ marginTop: '10px' }}>
        <span className="hero-chip">{sourceLabel[item.source] ?? item.source}</span>
        {item.packageId ? <span className="hero-chip subtle">{item.packageId}</span> : null}
      </div>
      <div className="panel-caption" style={{ marginTop: '10px' }}>{item.whySelected}</div>
    </button>
  );
}



function hasSourceBackedInstall(match: Win32ResolvedMatch | null | undefined): boolean {
  if (!match) return false;
  const source = String(match.source || '').toLowerCase();
  const install = String(match.installCommand || '').trim();
  return Boolean(install) && !['fallback', 'template'].includes(source);
}

function chooseBestMatch(payload: Win32ResolveResponse, preferredId: string | null): Win32ResolvedMatch | null {
  const source = payload.bestMatch;
  const candidates = payload.candidates ?? [];
  if (preferredId) {
    const fromCandidates = candidates.find((item) => getCandidateKey(item) === preferredId);
    if (fromCandidates) return fromCandidates;
    if (getResolvedKey(source) === preferredId) return source;
  }
  if (source) return source;
  return candidates.find((item) => hasSourceBackedInstall(item)) ?? candidates[0] ?? null;
}

export default function Win32UtilityWorkspace() {
  const [query, setQuery] = useState('Google Chrome');
  const [mode, setMode] = useState<Mode>('quick');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Win32ResolveResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);

  const checkedSources = useMemo(() => result?.checkedSources ?? ['WinGet', 'Silent Install HQ', 'Vendor search'], [result]);
  const candidates = result?.candidates ?? [];
  const best = useMemo(() => {
    if (!result) return null;
    return chooseBestMatch(result, selectedCandidateId);
  }, [result, selectedCandidateId]);
  const canDownloadBundle = hasSourceBackedInstall(best);
  const visibleCandidates = candidates.length ? candidates : best ? [best] : [];

  async function runResolve() {
    const trimmed = query.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    setSelectedCandidateId(null);
    try {
      const payload = await resolveWin32Package(trimmed, mode);
      setResult(payload);
      const defaultBest = chooseBestMatch(payload, null);
      setSelectedCandidateId(getResolvedKey(defaultBest));
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : 'Failed to resolve package.');
    } finally {
      setLoading(false);
    }
  }

  function handleSelectCandidate(id: string) {
    setSelectedCandidateId(id);
    setError(null);
  }

  async function handleDownloadBundle() {
    if (!best) {
      setError('Select a package result before downloading the package folder.');
      return;
    }
    if (!hasSourceBackedInstall(best)) {
      setError('Download is available only after selecting a source-backed package with a valid install command.');
      return;
    }

    try {
      setError(null);
      const blob = await downloadWin32PackageBundle({
        appName: best.name,
        publisher: best.publisher,
        packageId: best.packageId,
        installCommand: best.installCommand,
        uninstallCommand: best.uninstallCommand,
        detectScript: best.detectScript,
        source: best.source,
        sourceUrl: best.sourceUrl,
        confidence: best.confidence,
        notes: best.notes ?? []
      });
      const safeName = (best.name || 'win32-package').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
      triggerBlobDownload(blob, `${safeName}-intune-package.zip`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to build package bundle.');
    }
  }

  return (
    <section className="win32-shell">
      <div className="win32-header-card info-card drawer-card accent">
        <div>
          <div className="section-title">Win32 Utility</div>
          <div className="summary-text">Search live packaging sources, choose the right package when multiple editions exist, and build a package folder only from source-backed results.</div>
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
              placeholder="PyCharm, Beyond Compare, TreeSize, Advanced IP Scanner"
            />
          </label>
          <div className="win32-actions">
            <button className="btn btn-primary" type="button" onClick={() => void runResolve()} disabled={loading || !query.trim()}>
              {loading ? 'Searching…' : 'Resolve package'}
            </button>
            <button className="btn btn-secondary" type="button" onClick={() => void handleDownloadBundle()} disabled={!canDownloadBundle}>
              Download package folder
            </button>
            <button className="btn btn-secondary" type="button" onClick={() => result && best && downloadNotes({ ...result, bestMatch: best })} disabled={!best}>
              Export package notes
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
      {loading ? <Notice tone="info">Looking across packaging sources and ranking the best matches for <strong>{query}</strong>.</Notice> : null}

      {result && !result.ok ? (
        <div className="win32-empty-grid">
          <div className="info-card drawer-card accent">
            <div className="section-title">No reliable source found</div>
            <div className="summary-text">{result.message}</div>
            <div className="readiness-list" style={{ marginTop: '14px' }}>
              <div className="readiness-item"><span>1</span><span>Try a simpler product name such as the vendor or edition only.</span></div>
              <div className="readiness-item"><span>2</span><span>Use Deep Search to review vendor or community candidates.</span></div>
              <div className="readiness-item"><span>3</span><span>Package download stays disabled until a source-backed install command is found.</span></div>
            </div>
          </div>
          <div className="win32-alt-grid">{(result.alternatives ?? []).map((item) => <AlternativeCard key={item.url} item={item} />)}</div>
        </div>
      ) : null}

      {result?.ok ? (
        <div className="win32-main-grid">
          <div className="win32-left-stack">
            <div className="info-card drawer-card">
              <div className="win32-card-top">
                <div>
                  <div className="section-title">Matching packages</div>
                  <div className="summary-text">Choose the exact package you want to package. This is especially useful for multiple editions such as Community, Professional, Enterprise, or Canary builds.</div>
                </div>
                <div className="hero-chips wrap">
                  <span className="hero-chip">Matches: {visibleCandidates.length}</span>
                  {visibleCandidates.length > 1 ? <span className="hero-chip subtle">Selection required</span> : <span className="hero-chip subtle">Single best match</span>}
                </div>
              </div>
              <div className="win32-candidate-grid">
                {visibleCandidates.map((item) => (
                  <CandidateCard
  key={getCandidateKey(item)} item={item} active={getCandidateKey(item) === getResolvedKey(best)} onSelect={handleSelectCandidate} /> ))}
              </div>
            </div>

            {best ? (
              <>
                <div className="info-card drawer-card accent">
                  <div className="win32-card-top">
                    <div>
                      <div className="section-title">Selected package</div>
                      <div className="summary-text">{best.name} • {best.publisher}</div>
                    </div>
                    <div className="hero-chips wrap">
                      <span className="hero-chip">Source: {sourceLabel[best.source] ?? best.source}</span>
                      <span className={`hero-chip subtle win32-confidence-${best.confidence}`}>Confidence: {best.confidence}</span>
                    </div>
                  </div>
                  <div className="detail-list">
                    <div className="detail-row"><div className="detail-key">Package ID</div><div className="detail-value">{best.packageId || 'N/A'}</div></div>
                    <div className="detail-row stack"><div className="detail-key">Why selected</div><div className="detail-value">{best.whySelected}</div></div>
                    <div className="detail-row stack"><div className="detail-key">Evidence</div><div className="detail-value">{best.evidence.join(' • ') || 'N/A'}</div></div>
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
                      <pre className="code-surface">{best.installCommand || 'No source-backed install command available.'}</pre>
                    </div>
                    <div className="win32-code-card">
                      <div className="win32-code-head">
                        <span>Uninstall command</span>
                        <button className="btn btn-secondary" type="button" onClick={() => copyToClipboard(best.uninstallCommand)}>Copy</button>
                      </div>
                      <pre className="code-surface">{best.uninstallCommand || 'No uninstall command was captured from the selected source.'}</pre>
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
              </>
            ) : null}
          </div>

          <div className="win32-right-stack">
            <Notice tone={canDownloadBundle ? 'success' : 'warn'}>
              {canDownloadBundle
                ? 'The selected package is source-backed and can be exported as an Intune package folder.'
                : 'Select a source-backed package with an install command before using Download package folder.'}
            </Notice>

            <div className="info-card drawer-card">
              <div className="section-title">Alternative matches</div>
              {(result.alternatives ?? []).length ? (
                <div className="win32-alt-grid compact">
                  {(result.alternatives ?? []).map((item) => <AlternativeCard key={item.url} item={item} />)}
                </div>
              ) : (
                <div className="summary-text">No additional alternatives were returned for this query.</div>
              )}
            </div>

            {best ? (
              <div className="info-card drawer-card">
                <div className="section-title">Packaging notes</div>
                <ul className="plain-list">
                  {best.notes.map((note) => <li key={note}>{note}</li>)}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
