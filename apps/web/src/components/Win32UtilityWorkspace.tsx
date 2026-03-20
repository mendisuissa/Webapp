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
type SourceFilter = 'all' | 'winget' | 'chocolatey' | 'silentinstallhq' | 'vendor' | 'github' | 'officialdocs';
type ConfidenceFilter = 'all' | 'high' | 'medium' | 'low';

const sourceLabel: Record<string, string> = {
  winget: 'WinGet',
  chocolatey: 'Chocolatey',
  silentinstallhq: 'Silent Install HQ',
  vendor: 'Vendor',
  github: 'GitHub releases',
  officialdocs: 'Official docs',
  fallback: 'Fallback',
  template: 'Template'
};

const sourcePriority: Record<string, number> = {
  winget: 1,
  chocolatey: 2,
  officialdocs: 3,
  github: 4,
  silentinstallhq: 5,
  vendor: 6,
  fallback: 7,
  template: 8
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

function downloadNotes(payload: Win32ResolveResponse, selected: Win32ResolvedMatch | null) {
  if (typeof window === 'undefined' || !selected) return;
  const m = selected;
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

function scoreReason(item: Win32ResolvedMatch) {
  const reasons = [
    `${sourceLabel[item.source] ?? item.source} metadata available`,
    `${item.confidence} confidence`,
    item.packageId ? 'package identifier present' : 'title-based matching',
    item.installCommand ? 'export-ready install command' : 'requires command validation'
  ];
  return reasons.join(' • ');
}

function CandidateCard({
  item,
  active,
  recommended,
  onSelect
}: {
  item: Win32ResolvedMatch;
  active: boolean;
  recommended: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button type="button" className={`win32-choice-card ${active ? 'is-active' : ''} ${recommended ? 'is-recommended' : ''}`} onClick={() => onSelect(getCandidateKey(item))}>
      <div className="win32-choice-top">
        <div>
          <div className="win32-choice-title">{item.name}</div>
          <div className="win32-choice-meta">{item.publisher}</div>
        </div>
        <div className="hero-chips wrap compact-right">
          {recommended ? <span className="hero-chip">Recommended</span> : null}
          {active ? <span className="hero-chip subtle">Selected</span> : null}
        </div>
      </div>
      <div className="hero-chips wrap" style={{ marginTop: '10px' }}>
        <span className="hero-chip">{sourceLabel[item.source] ?? item.source}</span>
        <span className={`hero-chip subtle win32-confidence-${item.confidence}`}>{item.confidence} confidence</span>
        {item.packageId ? <span className="hero-chip subtle">{item.packageId}</span> : null}
      </div>
      <div className="win32-choice-reason">{item.whySelected}</div>
      <div className="win32-choice-proof">{scoreReason(item)}</div>
      <div className="win32-choice-footer">
        <span>{item.installCommand ? 'Export-ready' : 'Needs validation'}</span>
        <span className="btn btn-secondary tiny">Select package</span>
      </div>
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

type Win32UtilityWorkspaceProps = {
  onToast?: (tone: 'info' | 'success' | 'warn' | 'error', text: string) => void;
};

export default function Win32UtilityWorkspace({ onToast }: Win32UtilityWorkspaceProps) {
  const [query, setQuery] = useState('Google Chrome');
  const [mode, setMode] = useState<Mode>('quick');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Win32ResolveResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilter>('all');
  const [onlyReady, setOnlyReady] = useState(false);

  const checkedSources = useMemo(() => result?.checkedSources ?? ['WinGet', 'Chocolatey', 'Silent Install HQ', 'Vendor search', 'Official docs', 'GitHub releases'], [result]);
  const candidates = result?.candidates ?? [];
  const recommended = result?.bestMatch ?? null;
  const filteredCandidates = useMemo(() => {
    return [...candidates]
      .filter((item) => (sourceFilter === 'all' ? true : item.source === sourceFilter))
      .filter((item) => (confidenceFilter === 'all' ? true : item.confidence === confidenceFilter))
      .filter((item) => (onlyReady ? hasSourceBackedInstall(item) : true))
      .sort((a, b) => {
        const priorityDiff = (sourcePriority[a.source] ?? 99) - (sourcePriority[b.source] ?? 99);
        if (priorityDiff !== 0) return priorityDiff;
        return a.name.localeCompare(b.name);
      });
  }, [candidates, sourceFilter, confidenceFilter, onlyReady]);

  const best = useMemo(() => {
    if (!result) return null;
    return chooseBestMatch({ ...result, candidates: filteredCandidates.length ? filteredCandidates : candidates }, selectedCandidateId);
  }, [result, selectedCandidateId, filteredCandidates, candidates]);

  const canDownloadBundle = hasSourceBackedInstall(best);
  const statusLabel = !result
    ? 'idle'
    : !result.ok
      ? 'not_found'
      : filteredCandidates.length > 1
        ? 'choices'
        : 'resolved';

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
        <div className="win32-hero-grid">
          <div>
            <div className="section-title">Win32 Utility</div>
            <div className="summary-text">Search live packaging sources, compare edition-aware matches, review confidence signals, and export a package folder only when the selection is truly source-backed.</div>
          </div>
          <div className="hero-chips wrap align-end">
            <span className="hero-chip">Live sources: WinGet, Chocolatey, Silent Install HQ</span>
            <span className="hero-chip subtle">Enrichment: vendor docs + GitHub releases</span>
            <span className="hero-chip subtle">State: {statusLabel}</span>
          </div>
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
            <button className="btn btn-secondary" type="button" onClick={() => result && downloadNotes(result, best)} disabled={!best}>
              Export package notes
            </button>
          </div>
        </div>

        <div className="win32-toolbar-grid">
          <div className="win32-mode-row">
            <button className={`segment-btn ${mode === 'quick' ? 'active' : ''}`} type="button" onClick={() => setMode('quick')}>Quick search</button>
            <button className={`segment-btn ${mode === 'deep' ? 'active' : ''}`} type="button" onClick={() => setMode('deep')}>Deep search</button>
          </div>
          <div className="win32-filter-row">
            {(['all', 'winget', 'chocolatey', 'silentinstallhq', 'officialdocs', 'github'] as SourceFilter[]).map((item) => (
              <button key={item} type="button" className={`segment-btn ${sourceFilter === item ? 'active' : ''}`} onClick={() => setSourceFilter(item)}>
                {item === 'all' ? 'All sources' : sourceLabel[item]}
              </button>
            ))}
          </div>
          <div className="win32-filter-row">
            {(['all', 'high', 'medium', 'low'] as ConfidenceFilter[]).map((item) => (
              <button key={item} type="button" className={`segment-btn ${confidenceFilter === item ? 'active' : ''}`} onClick={() => setConfidenceFilter(item)}>
                {item === 'all' ? 'All confidence' : `${item} confidence`}
              </button>
            ))}
            <button type="button" className={`segment-btn ${onlyReady ? 'active' : ''}`} onClick={() => setOnlyReady((value) => !value)}>
              Export-ready only
            </button>
          </div>
        </div>

        <div className="hero-chips wrap" style={{ marginTop: '12px' }}>
          {checkedSources.map((source: string) => (
            <span key={source} className="hero-chip subtle">Checked: {source}</span>
          ))}
        </div>
      </div>

      {error ? <Notice tone="warn">{error}</Notice> : null}
      {loading ? <Notice tone="info">Looking across live package catalogs, community articles, and enrichment sources for <strong>{query}</strong>.</Notice> : null}

      {result && !result.ok ? (
        <div className="win32-empty-grid">
          <div className="info-card drawer-card accent">
            <div className="section-title">No reliable source found</div>
            <div className="summary-text">{result.message}</div>
            <div className="readiness-list" style={{ marginTop: '14px' }}>
              <div className="readiness-item"><span>1</span><span>Try a more specific edition name such as Community, Professional, Enterprise, or x64.</span></div>
              <div className="readiness-item"><span>2</span><span>Use Deep Search to expand Chocolatey, vendor docs, and GitHub release enrichment.</span></div>
              <div className="readiness-item"><span>3</span><span>Package export stays disabled until a source-backed install command is found.</span></div>
            </div>
          </div>
          <div className="win32-alt-grid">{(result.alternatives ?? []).map((item) => <AlternativeCard key={item.url} item={item} />)}</div>
        </div>
      ) : null}

      {result?.ok ? (
        <div className="win32-main-grid three-col">
          <div className="win32-left-stack">
            <div className="info-card drawer-card">
              <div className="win32-card-top">
                <div>
                  <div className="section-title">Search workflow</div>
                  <div className="summary-text">Use filters to narrow the result set, then select the exact edition you want to export.</div>
                </div>
                <div className="hero-chips wrap">
                  <span className="hero-chip">Matches: {filteredCandidates.length}</span>
                  <span className="hero-chip subtle">Status: {statusLabel}</span>
                </div>
              </div>
              <div className="detail-list compact">
                <div className="detail-row"><div className="detail-key">Query</div><div className="detail-value">{result.query}</div></div>
                <div className="detail-row"><div className="detail-key">Mode</div><div className="detail-value">{mode === 'deep' ? 'Deep search' : 'Quick search'}</div></div>
                <div className="detail-row"><div className="detail-key">Source scope</div><div className="detail-value">{sourceFilter === 'all' ? 'All sources' : sourceLabel[sourceFilter]}</div></div>
                <div className="detail-row"><div className="detail-key">Export gate</div><div className="detail-value">{canDownloadBundle ? 'Ready' : 'Selection required'}</div></div>
              </div>
            </div>

            <div className="info-card drawer-card">
              <div className="section-title">Alternative sources</div>
              {(result.alternatives ?? []).length ? (
                <div className="win32-alt-grid compact">
                  {(result.alternatives ?? []).map((item) => <AlternativeCard key={item.url} item={item} />)}
                </div>
              ) : (
                <div className="summary-text">No additional alternatives were returned for this query.</div>
              )}
            </div>
          </div>

          <div className="win32-center-stack">
            {recommended ? (
              <div className="info-card drawer-card accent">
                <div className="win32-card-top">
                  <div>
                    <div className="section-title">Recommended package</div>
                    <div className="summary-text">Best source-backed match based on source priority, confidence, and package metadata.</div>
                  </div>
                  <span className="hero-chip">{sourceLabel[recommended.source] ?? recommended.source}</span>
                </div>
                <CandidateCard item={recommended} active={getResolvedKey(best) === getResolvedKey(recommended)} recommended onSelect={handleSelectCandidate} />
              </div>
            ) : null}

            <div className="info-card drawer-card">
              <div className="win32-card-top">
                <div>
                  <div className="section-title">Matching packages</div>
                  <div className="summary-text">Compare editions, trust signals, and source coverage before you export a package folder.</div>
                </div>
                <div className="hero-chips wrap">
                  <span className="hero-chip">Source-backed choices</span>
                  {filteredCandidates.length > 1 ? <span className="hero-chip subtle">Selection required</span> : <span className="hero-chip subtle">Single best match</span>}
                </div>
              </div>
              <div className="win32-candidate-grid upgraded">
                {filteredCandidates.map((item) => (
                  <CandidateCard
                    key={getCandidateKey(item)}
                    item={item}
                    active={getCandidateKey(item) === getResolvedKey(best)}
                    recommended={getResolvedKey(recommended) === getCandidateKey(item)}
                    onSelect={handleSelectCandidate}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="win32-right-stack">
            <Notice tone={canDownloadBundle ? 'success' : 'warn'}>
              {canDownloadBundle
                ? 'The selected package is source-backed and ready for export as an Intune package folder.'
                : 'Select an export-ready package with a valid install command before downloading the package folder.'}
            </Notice>

            {best ? (
              <div className="info-card drawer-card accent">
                <div className="win32-card-top">
                  <div>
                    <div className="section-title">Selection panel</div>
                    <div className="summary-text">{best.name} • {best.publisher}</div>
                  </div>
                  <div className="hero-chips wrap">
                    <span className="hero-chip">{sourceLabel[best.source] ?? best.source}</span>
                    <span className={`hero-chip subtle win32-confidence-${best.confidence}`}>{best.confidence} confidence</span>
                  </div>
                </div>
                <div className="detail-list">
                  <div className="detail-row"><div className="detail-key">Package ID</div><div className="detail-value">{best.packageId || 'N/A'}</div></div>
                  <div className="detail-row"><div className="detail-key">Export readiness</div><div className="detail-value">{canDownloadBundle ? 'Ready for export' : 'Needs validation'}</div></div>
                  <div className="detail-row stack"><div className="detail-key">Why this match</div><div className="detail-value">{best.whySelected}</div></div>
                  <div className="detail-row stack"><div className="detail-key">Confidence reason</div><div className="detail-value">{scoreReason(best)}</div></div>
                  <div className="detail-row stack"><div className="detail-key">Evidence</div><div className="detail-value">{best.evidence.join(' • ') || 'N/A'}</div></div>
                </div>
                <div className="drawer-actions compact" style={{ marginTop: '12px' }}>
                  {best.sourceUrl ? <a className="btn btn-secondary" href={best.sourceUrl} target="_blank" rel="noreferrer">Open source</a> : null}
                  <button className="btn btn-secondary" type="button" onClick={() => copyToClipboard(best.installCommand)}>Copy install</button>
                </div>
              </div>
            ) : null}

            {best ? (
              <div className="info-card drawer-card">
                <div className="section-title">Package commands</div>
                <div className="win32-command-stack">
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
            ) : null}

            {best ? (
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
            ) : null}

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
