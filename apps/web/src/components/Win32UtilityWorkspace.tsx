import { useEffect, useMemo, useState } from 'react';
import { searchWin32Packages, type Win32SearchResponse, type Win32SearchResultRecord } from '../api/client.js';

type Props = {
  initialQuery?: string;
};

type SearchMode = 'quick' | 'deep';

function copyToClipboard(value: string) {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return;
  void navigator.clipboard.writeText(value);
}

function downloadPackageNotes(record: Win32SearchResultRecord) {
  if (typeof window === 'undefined') return;
  const text = [
    `# ${record.name}`,
    `Publisher: ${record.publisher}`,
    `Source: ${record.sourceLabel}`,
    `Source URL: ${record.sourceUrl}`,
    `Confidence: ${record.confidence}`,
    `Resolution type: ${record.resolutionType}`,
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
    '## Detection script',
    record.detectionScript,
    '',
    '## Notes',
    ...record.notes.map((item) => `- ${item}`),
    '',
    '## Evidence',
    ...(record.evidence?.map((item) => `- ${item}`) ?? [])
  ].join('\n');

  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${record.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-win32-package-notes.txt`;
  link.click();
  URL.revokeObjectURL(url);
}

function SourceBadge({ value }: { value: string }) {
  const safe = value.toLowerCase().includes('winget') ? 'winget' : 'silentinstallhq';
  return <span className={`win32-badge win32-badge-${safe}`}>Source: {value}</span>;
}

function ConfidenceBadge({ value }: { value: 'high' | 'medium' }) {
  return <span className={`win32-badge win32-confidence-${value}`}>Confidence: {value}</span>;
}

export default function Win32UtilityWorkspace({ initialQuery = '' }: Props) {
  const [query, setQuery] = useState(initialQuery || 'Beyond Compare');
  const [mode, setMode] = useState<SearchMode>('quick');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Win32SearchResponse | null>(null);
  const [selectedId, setSelectedId] = useState('');

  async function runSearch(activeQuery = query, activeMode = mode) {
    const trimmed = activeQuery.trim();
    if (!trimmed) return;
    setLoading(true);
    setError('');
    try {
      const response = await searchWin32Packages(trimmed, activeMode);
      setResult(response);
      setSelectedId(response.bestMatch?.id ?? response.alternatives[0]?.id ?? '');
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : 'Search failed.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void runSearch(query, mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const records = useMemo(() => {
    const items: Win32SearchResultRecord[] = [];
    if (result?.bestMatch) items.push(result.bestMatch);
    items.push(...(result?.alternatives ?? []));
    return items;
  }, [result]);

  const selected = useMemo(() => records.find((item) => item.id === selectedId) ?? records[0] ?? null, [records, selectedId]);

  return (
    <section className="win32-workspace-shell">
      <div className="win32-hero-card">
        <div>
          <div className="win32-kicker">Live source resolution</div>
          <h2 className="win32-title">Win32 Packaging Assistant</h2>
          <p className="win32-subtitle">
            Search WinGet first, then trusted external sources. If no reliable source exists, the app says so instead of inventing commands.
          </p>
        </div>
        <div className="win32-hero-actions">
          <button className="win32-primary-button" type="button" disabled={loading} onClick={() => void runSearch()}>
            {loading ? 'Resolving…' : mode === 'deep' ? 'Run deep search' : 'Resolve package'}
          </button>
          <button className="win32-secondary-button" type="button" disabled={!selected} onClick={() => selected && downloadPackageNotes(selected)}>
            Export package notes
          </button>
        </div>
      </div>

      <div className="win32-toolbar">
        <label className="win32-search-box">
          <span className="win32-search-label">Search application</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void runSearch();
            }}
            placeholder="Beyond Compare, Notepad++, TreeSize"
            className="win32-search-input"
          />
        </label>

        <div className="win32-filter-group">
          <span className="win32-search-label">Search mode</span>
          <div className="win32-pill-row">
            {(['quick', 'deep'] as const).map((item) => (
              <button key={item} type="button" className={`win32-filter-pill ${mode === item ? 'is-active' : ''}`} onClick={() => setMode(item)}>
                {item === 'quick' ? 'Quick search' : 'Deep search'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="win32-layout-grid">
        <aside className="win32-results-panel">
          <div className="win32-panel-title-row">
            <h3 className="win32-panel-title">Matches</h3>
            <span className="win32-count-pill">{records.length}</span>
          </div>
          <div className="win32-empty-state" style={{ marginBottom: '12px' }}>
            {result?.message ?? 'Search WinGet and external sources from one place.'}
            {result?.sourcesChecked?.length ? ` Sources checked: ${result.sourcesChecked.join(', ')}.` : ''}
          </div>
          {error ? <div className="win32-empty-state">{error}</div> : null}
          <div className="win32-results-list">
            {records.map((record, index) => (
              <button key={record.id} type="button" className={`win32-result-card ${selected?.id === record.id ? 'is-selected' : ''}`} onClick={() => setSelectedId(record.id)}>
                <div className="win32-result-header">
                  <div>
                    <div className="win32-result-name">{index === 0 && result?.bestMatch?.id === record.id ? 'Best match • ' : ''}{record.name}</div>
                    <div className="win32-result-publisher">{record.publisher}</div>
                  </div>
                  <ConfidenceBadge value={record.confidence} />
                </div>
                <div className="win32-result-meta">
                  <SourceBadge value={record.sourceLabel} />
                  <span className="win32-result-date">{record.packageId ?? record.sourceTitle}</span>
                </div>
              </button>
            ))}
            {!loading && records.length === 0 ? <div className="win32-empty-state">No reliable source-backed command set was found for this query.</div> : null}
          </div>
        </aside>

        <div className="win32-detail-panel">
          {selected ? (
            <>
              <div className="win32-summary-card">
                <div className="win32-summary-header">
                  <div>
                    <div className="win32-summary-title">{selected.name}</div>
                    <div className="win32-summary-meta">{selected.publisher}{selected.packageId ? ` • ${selected.packageId}` : ''}</div>
                  </div>
                  <div className="win32-summary-badges">
                    <SourceBadge value={selected.sourceLabel} />
                    <ConfidenceBadge value={selected.confidence} />
                    <a href={selected.sourceUrl} target="_blank" rel="noreferrer" className="win32-link-button">Open source</a>
                  </div>
                </div>
                <div className="win32-summary-note">{selected.detectionSummary}</div>
              </div>

              <div className="win32-command-grid">
                <article className="win32-command-card">
                  <div className="win32-command-header">
                    <h3>Install command</h3>
                    <button type="button" className="win32-copy-button" onClick={() => copyToClipboard(selected.installCommand)}>Copy</button>
                  </div>
                  <pre className="win32-code-block">{selected.installCommand}</pre>
                </article>

                <article className="win32-command-card">
                  <div className="win32-command-header">
                    <h3>Uninstall command</h3>
                    <button type="button" className="win32-copy-button" onClick={() => copyToClipboard(selected.uninstallCommand)}>Copy</button>
                  </div>
                  <pre className="win32-code-block">{selected.uninstallCommand}</pre>
                </article>
              </div>

              <article className="win32-detection-card">
                <div className="win32-command-header">
                  <div>
                    <h3>Detection script</h3>
                    <div className="win32-detection-subtitle">Generated from source clues, not from a fake install template.</div>
                  </div>
                  <button type="button" className="win32-copy-button" onClick={() => copyToClipboard(selected.detectionScript)}>Copy</button>
                </div>
                <pre className="win32-code-block win32-script-block">{selected.detectionScript}</pre>
              </article>

              <div className="win32-lower-grid">
                <article className="win32-list-card">
                  <h3>Notes</h3>
                  <div className="win32-list-stack">
                    {selected.notes.map((note) => <div key={note} className="win32-list-item">{note}</div>)}
                  </div>
                </article>
                <article className="win32-list-card">
                  <h3>Evidence</h3>
                  <div className="win32-list-stack">
                    {(selected.evidence?.length ? selected.evidence : ['No explicit evidence lines were captured.']).map((item) => (
                      <div key={item} className="win32-list-item">{item}</div>
                    ))}
                  </div>
                </article>
              </div>
            </>
          ) : (
            <div className="win32-empty-state">Run a search to resolve live, source-backed install and uninstall commands.</div>
          )}
        </div>
      </div>
    </section>
  );
}
