export type AppCatalogEntry = {
  match: {
    names: string[];
    publishers?: string[];
  };
  app: {
    name: string;
    publisher: string;
    wingetId: string;
  };
  remediationType: 'winget-intune-upgrade' | 'manual-review';
  autoRemediate: boolean;
};

const catalog: AppCatalogEntry[] = [
  {
    match: { names: ['google chrome', 'chrome'], publishers: ['google'] },
    app: { name: 'Google Chrome', publisher: 'Google', wingetId: 'Google.Chrome' },
    remediationType: 'winget-intune-upgrade',
    autoRemediate: true
  },
  {
    match: { names: ['microsoft edge', 'edge'], publishers: ['microsoft'] },
    app: { name: 'Microsoft Edge', publisher: 'Microsoft', wingetId: 'Microsoft.Edge' },
    remediationType: 'winget-intune-upgrade',
    autoRemediate: true
  },
  {
    match: { names: ['mozilla firefox', 'firefox'], publishers: ['mozilla'] },
    app: { name: 'Mozilla Firefox', publisher: 'Mozilla', wingetId: 'Mozilla.Firefox' },
    remediationType: 'winget-intune-upgrade',
    autoRemediate: true
  },
  {
    match: { names: ['7-zip', '7zip'], publishers: ['igor pavlov'] },
    app: { name: '7-Zip', publisher: 'Igor Pavlov', wingetId: '7zip.7zip' },
    remediationType: 'winget-intune-upgrade',
    autoRemediate: true
  },
  {
    match: { names: ['notepad++', 'notepad plus plus'], publishers: ['notepad++ team'] },
    app: { name: 'Notepad++', publisher: 'Notepad++ Team', wingetId: 'Notepad++.Notepad++' },
    remediationType: 'winget-intune-upgrade',
    autoRemediate: true
  }
];

function normalize(value?: string): string {
  return (value || '').trim().toLowerCase();
}

export function resolveCatalogApp(productName?: string, publisher?: string) {
  const normalizedName = normalize(productName);
  const normalizedPublisher = normalize(publisher);

  const matched = catalog.find((entry) => {
    const nameMatch = entry.match.names.some((n) => normalizedName.includes(normalize(n)));
    const publisherMatch =
      !entry.match.publishers?.length ||
      entry.match.publishers.some((p) => normalizedPublisher.includes(normalize(p)));
    return nameMatch && publisherMatch;
  });

  if (!matched) {
    return {
      supported: false,
      remediationType: 'manual-review' as const,
      autoRemediate: false,
      app: null
    };
  }

  return {
    supported: true,
    remediationType: matched.remediationType,
    autoRemediate: matched.autoRemediate,
    app: matched.app
  };
}