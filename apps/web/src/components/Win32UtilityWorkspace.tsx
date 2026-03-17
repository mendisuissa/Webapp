import { useMemo, useState } from 'react';
import {
  win32UtilitySeed,
  type Win32AlternativeSource,
  type Win32SourceKind,
  type Win32UtilityRecord
} from './win32UtilitySeed.js';

type Props = {
  initialQuery?: string;
};

type SourceFilter = 'all' | Win32SourceKind;

const sourceLabel: Record<Win32SourceKind, string> = {
  winget: 'WinGet',
  silentinstallhq: 'Silent Install HQ',
  template: 'Template'
};

function copyToClipboard(value: string) {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return;
  void navigator.clipboard.writeText(value);
}

function downloadPackageNotes(record: Win32UtilityRecord) {
  if (typeof window === 'undefined') return;
  const text = [
    `# ${record.name}`,
    `Publisher: ${record.publisher}`,
    `Source: ${sourceLabel[record.source]}`,
    `Confidence: ${record.confidence}`,
    `Last verified: ${record.lastVerified}`,
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
    '## Validation checklist',
    ...record.validationChecklist.map((item) => `- ${item}`)
  ].join('\n');

  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${record.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-win32-package-notes.txt`;
  link.click();
  URL.revokeObjectURL(url);
}

function SourceBadge({ source }: { source: Win32SourceKind }) {
  return <span className={`win32-badge win32-badge-${source}`}>Source: {sourceLabel[source]}</span>;
}

function ConfidenceBadge({ confidence }: { confidence: Win32UtilityRecord['confidence'] }) {
  return <span className={`win32-badge win32-confidence-${confidence}`}>Confidence: {confidence}</span>;
}

function AlternativeSourceRow({ item }: { item: Win32AlternativeSource }) {
  return (
    <div className="win32-alt-row">
      <div>
        <div className="win32-alt-title">{item.label}</div>
        <div className="win32-alt-note">{item.note ?? 'Supplemental validation source.'}</div>
      </div>
      <div className="win32-alt-actions">
        <span className={`win32-mini-badge win32-badge-${item.kind}`}>{sourceLabel[item.kind]}</span>
        {item.url ? (
          <a href={item.url} target="_blank" rel="noreferrer" className="win32-link-button">
            Open
          </a>
        ) : null}
      </div>
    </div>
  );
}

export default function Win32UtilityWorkspace({ initialQuery = '' }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [selectedId, setSelectedId] = useState<string>(win32UtilitySeed[0]?.id ?? '');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return win32UtilitySeed.filter((record) => {
      const sourceMatch = sourceFilter === 'all' || record.source === sourceFilter;
      const searchMatch =
        !needle ||
        record.name.toLowerCase().includes(needle) ||
        record.publisher.toLowerCase().includes(needle) ||
        record.packageId?.toLowerCase().includes(needle);
      return sourceMatch && searchMatch;
    });
  }, [query, sourceFilter]);

  const selected = useMemo(() => {
    const directMatch = filtered.find((item) => item.id === selectedId);
    return directMatch ?? filtered[0] ?? win32UtilitySeed[0] ?? null;
  }, [filtered, selectedId]);

  return (
    <section className="win32-workspace-shell">
      <div className="win32-hero-card">
        <div>
          <div className="win32-kicker">New workspace</div>
          <h2 className="win32-title">Win32 Packaging Assistant</h2>
          <p className="win32-subtitle">
            Find silent install, uninstall, and detection logic for packaging apps into Intune.
          </p>
        </div>
        <div className="win32-hero-actions">
          <button className="win32-primary-button" type="button" onClick={() => selected && downloadPackageNotes(selected)}>
            Export package notes
          </button>
          <button className="win32-secondary-button" type="button" onClick={() => selected && copyToClipboard(selected.detectionScript)}>
            Copy detect script
          </button>
        </div>
      </div>

      <div className="win32-toolbar">
        <label className="win32-search-box">
          <span className="win32-search-label">Search application</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Chrome, VS Code, Zoom, Notepad++"
            className="win32-search-input"
          />
        </label>

        <div className="win32-filter-group">
          <span className="win32-search-label">Source filter</span>
          <div className="win32-pill-row">
            {(['all', 'winget', 'silentinstallhq', 'template'] as const).map((filter) => (
              <button
                key={filter}
                type="button"
                className={`win32-filter-pill ${sourceFilter === filter ? 'is-active' : ''}`}
                onClick={() => setSourceFilter(filter)}
              >
                {filter === 'all' ? 'All sources' : sourceLabel[filter]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="win32-layout-grid">
        <aside className="win32-results-panel">
          <div className="win32-panel-title-row">
            <h3 className="win32-panel-title">Matches</h3>
            <span className="win32-count-pill">{filtered.length}</span>
          </div>

          <div className="win32-results-list">
            {filtered.map((record) => (
              <button
                key={record.id}
                type="button"
                className={`win32-result-card ${selected?.id === record.id ? 'is-selected' : ''}`}
                onClick={() => setSelectedId(record.id)}
              >
                <div className="win32-result-header">
                  <div>
                    <div className="win32-result-name">{record.name}</div>
                    <div className="win32-result-publisher">{record.publisher}</div>
                  </div>
                  <ConfidenceBadge confidence={record.confidence} />
                </div>
                <div className="win32-result-meta">
                  <SourceBadge source={record.source} />
                  <span className="win32-result-date">Verified {record.lastVerified}</span>
                </div>
              </button>
            ))}

            {filtered.length === 0 ? (
              <div className="win32-empty-state">
                No packages matched this search. Use template mode for private or unknown apps.
              </div>
            ) : null}
          </div>
        </aside>

        <div className="win32-detail-panel">
          {selected ? (
            <>
              <div className="win32-summary-card">
                <div className="win32-summary-header">
                  <div>
                    <div className="win32-summary-title">{selected.name}</div>
                    <div className="win32-summary-meta">
                      {selected.publisher}
                      {selected.version ? ` • ${selected.version}` : ''}
                      {selected.packageId ? ` • ${selected.packageId}` : ''}
                    </div>
                  </div>
                  <div className="win32-summary-badges">
                    <SourceBadge source={selected.source} />
                    <ConfidenceBadge confidence={selected.confidence} />
                    <span className="win32-badge win32-badge-muted">Verified {selected.lastVerified}</span>
                  </div>
                </div>
                <div className="win32-summary-note">{selected.detectionSummary}</div>
              </div>

              <div className="win32-command-grid">
                <article className="win32-command-card">
                  <div className="win32-command-header">
                    <h3>Install command</h3>
                    <button type="button" className="win32-copy-button" onClick={() => copyToClipboard(selected.installCommand)}>
                      Copy
                    </button>
                  </div>
                  <pre className="win32-code-block">{selected.installCommand}</pre>
                </article>

                <article className="win32-command-card">
                  <div className="win32-command-header">
                    <h3>Uninstall command</h3>
                    <button type="button" className="win32-copy-button" onClick={() => copyToClipboard(selected.uninstallCommand)}>
                      Copy
                    </button>
                  </div>
                  <pre className="win32-code-block">{selected.uninstallCommand}</pre>
                </article>
              </div>

              <article className="win32-detection-card">
                <div className="win32-command-header">
                  <div>
                    <h3>Detection method</h3>
                    <div className="win32-detection-subtitle">Recommended {selected.detectionKind} detection for Intune packaging.</div>
                  </div>
                  <button type="button" className="win32-copy-button" onClick={() => copyToClipboard(selected.detectionScript)}>
                    Copy script
                  </button>
                </div>
                <pre className="win32-code-block win32-script-block">{selected.detectionScript}</pre>
              </article>

              <div className="win32-lower-grid">
                <article className="win32-list-card">
                  <h3>Notes</h3>
                  <ul>
                    {selected.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </article>

                <article className="win32-list-card">
                  <h3>Validation checklist</h3>
                  <ul>
                    {selected.validationChecklist.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </article>
              </div>

              {selected.alternatives?.length ? (
                <article className="win32-alt-card">
                  <div className="win32-command-header">
                    <h3>Alternative sources</h3>
                    {selected.sourceUrl ? (
                      <a href={selected.sourceUrl} target="_blank" rel="noreferrer" className="win32-link-button">
                        Open primary source
                      </a>
                    ) : null}
                  </div>
                  <div className="win32-alt-list">
                    {selected.alternatives.map((item) => (
                      <AlternativeSourceRow key={`${selected.id}-${item.label}`} item={item} />
                    ))}
                  </div>
                </article>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
