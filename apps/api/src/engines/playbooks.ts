import type { AppStatusRow, Playbook } from '@efm/shared';

export const PLAYBOOKS: Playbook[] = [
  {
    id: 'pb-detection',
    title: 'Detection rule failure (Win32)',
    whenToUse:
      'Intune Win32 app installs but is not detected (common with 0x87D1041C / detection-related failures).',
    tags: ['0x87D', 'Detection', 'Win32'],
    steps: [
      {
        title: 'Confirm install command and return codes',
        details: [
          'Check install command line in Intune app.',
          'Validate success return codes and ensure reboot behavior is correct.',
        ],
      },
      {
        title: 'Validate detection rule',
        details: [
          'Check file/registry detection paths and architecture (x64 vs x86).',
          'Verify the app actually writes the detected artifact during install.',
        ],
      },
      {
        title: 'Compare with a known-good device',
        details: [
          'Compare detected artifact on a device where it succeeded.',
          'Confirm same install context (system vs user).',
        ],
      },
    ],
  },

  {
    id: 'pb-requirements',
    title: 'Requirement rule failure (Win32)',
    whenToUse:
      'App fails due to requirement rules (OS version, disk space, architecture, dependencies).',
    tags: ['0x87D', 'Requirements', 'Win32'],
    steps: [
      {
        title: 'Review requirement rules',
        details: [
          'Check OS version/build requirements.',
          'Check architecture and minimum disk space.',
        ],
      },
      {
        title: 'Validate dependency apps',
        details: [
          'Ensure prerequisites are installed/detected.',
          'Consider dependency ordering and supersedence.',
        ],
      },
    ],
  },

  {
    id: 'pb-msix-deps',
    title: 'MSIX/AppX dependency or version conflict',
    whenToUse:
      'Errors in 0x80073*** family (MSIX/AppX deployment), missing frameworks or version conflicts.',
    tags: ['0x80073', 'MSIX', 'AppX'],
    steps: [
      {
        title: 'Check framework dependencies',
        details: [
          'VCLibs (UWP)',
          'Microsoft.WindowsAppRuntime',
          'App Installer version',
          'Windows build compatibility',
        ],
      },
      {
        title: 'Check conflicting packages',
        details: [
          'Remove older versions if needed.',
          'Validate package family names and provisioning state.',
        ],
      },
      {
        title: 'Review AppXDeployment logs',
        details: [
          'Event Viewer: Microsoft-Windows-AppXDeploymentServer/Operational',
          'CBS logs if relevant.',
        ],
      },
    ],
  },

  // ⭐ NEW PLAYBOOK
  {
    id: 'pb-win32-file-not-found',
    title: 'Win32 installer failed (0x80070002)',
    whenToUse:
      'Win32 installer failed with file not found or missing path. Common packaging issue in Intune Win32 apps.',
    tags: ['0x8007', 'Win32', 'Packaging'],
    steps: [
      {
        title: 'Validate install command',
        details: [
          'Check the install command line configured in Intune.',
          'Confirm paths referenced by the installer exist.',
        ],
      },
      {
        title: 'Verify Intune package contents',
        details: [
          'Confirm required files are included in the .intunewin package.',
          'Rebuild the package if needed.',
        ],
      },
      {
        title: 'Check execution context',
        details: [
          'Confirm installer supports SYSTEM context.',
          'Validate file access permissions.',
        ],
      },
      {
        title: 'Review IME logs',
        details: [
          'Open IntuneManagementExtension.log',
          'Search for the failing command path and exit code.',
        ],
      },
    ],
  },
];

function find(id: string): Playbook | undefined {
  return PLAYBOOKS.find((p) => p.id === id);
}

function isPlaybook(pb: Playbook | undefined): pb is Playbook {
  return !!pb;
}

export function recommendPlaybooks(
  row: Partial<AppStatusRow> | null
): Playbook[] {

  if (!row) return [];

  const family = (row.errorFamily || '').toLowerCase();
  const code = (row.errorCode || '').toLowerCase();
  const category = (row.normalizedCategory || '').toLowerCase();

  const out: Array<Playbook | undefined> = [];

  const pushIfFound = (id: string) => out.push(find(id));

  // MSIX errors
  if (code.startsWith('0x80073') || family === '0x80073') {
    pushIfFound('pb-msix-deps');
  }

  // Win32 requirement / detection
  if (code.startsWith('0x87d') || family === '0x87d') {

    if (category.includes('detect')) pushIfFound('pb-detection');

    if (category.includes('require')) pushIfFound('pb-requirements');

    if (!out.some(isPlaybook)) pushIfFound('pb-detection');
  }

  // ⭐ Win32 file/path errors
  if (
    code.includes('80070002') ||
    code.startsWith('0x8007') ||
    family === '0x8007'
  ) {
    pushIfFound('pb-win32-file-not-found');
  }

  return out.filter(isPlaybook);
}