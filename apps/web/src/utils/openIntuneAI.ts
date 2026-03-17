// apps/web/src/utils/openIntuneAI.ts

type AuthStatus = {
  connected: boolean;
  upn?: string;
  tenantId?: string;
  displayName?: string;
};

type AnyRow = Record<string, unknown> | null;

const GPT_URL =
  'https://chatgpt.com/g/g-698c483ab6888191a8ac539d2944f696-m-intune-architect-ai-enterprise-edition';

// Safety: avoid leaking PII by default
const DEFAULT_SCRUB_PII = true;

// Keep clipboard prompt reasonably sized
const MAX_PROMPT_CHARS = 12000;

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function redactValue(original: unknown): unknown {
  if (typeof original === 'string') {
    const s = original.trim();
    if (!s) return s;

    // emails / UPN-like
    if (s.includes('@')) return '[REDACTED_EMAIL]';

    // GUID-like
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s))
      return '[REDACTED_GUID]';

    // serial-ish (long-ish alnum)
    if (/^[A-Z0-9]{8,}$/i.test(s)) return '[REDACTED_ID]';

    return s;
  }

  return '[REDACTED]';
}

function scrubPII(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(scrubPII);
  if (!isObject(input)) return input;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    const key = k.toLowerCase();

    const piiKeys = [
      'upn',
      'userprincipalname',
      'mail',
      'email',
      'username',
      'displayname',
      'userdisplayname',
      'devicename',
      'serialnumber',
      'id',
      'deviceid',
      'userid',
      'azureaddeviceid',
      'enrollmentid'
    ];

    if (piiKeys.includes(key)) {
      out[k] = redactValue(v);
      continue;
    }

    // Also scrub nested
    out[k] = scrubPII(v);
  }

  return out;
}

function suggestPlaybooks(row: AnyRow): string[] {
  if (!row || typeof row !== 'object') return [];

  const errorCode = String((row as any).errorCode ?? '').toLowerCase();
  const family = String((row as any).errorFamily ?? '').toLowerCase();
  const category = String((row as any).normalizedCategory ?? '').toLowerCase();

  const out: string[] = [];

  if (errorCode.startsWith('0x80073') || family === '0x80073') {
    out.push('Playbook: MSIX/AppX dependency or version conflict (0x80073****).');
  }

  if (errorCode.startsWith('0x87d') || family === '0x87d') {
    if (category.includes('detect')) out.push('Playbook: Win32 Detection rule failure (0x87D****).');
    else if (category.includes('require')) out.push('Playbook: Win32 Requirement rule failure.');
    else out.push('Playbook: Win32 install/detection triage (0x87D****).');
  }

  const sig = String((row as any).signatureHash ?? (row as any).signatureKey ?? '').trim();
  if (sig) out.push(`Incident Signature: ${sig}`);

  return out;
}

function buildPrompt(params: {
  row: AnyRow;
  view: string;
  auth: AuthStatus;
  scrubPii: boolean;
}): string {
  const { row, view, auth, scrubPii } = params;

  const tenantContext = {
    connected: auth.connected,
    tenantId: auth.tenantId ?? '',
    signedInUser: auth.upn ?? '',
    displayName: auth.displayName ?? ''
  };

  const sanitizedTenant = scrubPii ? (scrubPII(tenantContext) as any) : tenantContext;
  const sanitizedRow = scrubPii ? (scrubPII(row) as any) : row;

  const requestHint =
    isObject(row) && typeof (row as any)._request === 'string' && String((row as any)._request).trim().length > 0
      ? String((row as any)._request)
      : 'Explain root cause + remediation runbook (step-by-step).';

  const detected = suggestPlaybooks(row);

  const prompt = [
    'You are "M-Intune Architect AI" specialized in Microsoft Intune troubleshooting and remediation.',
    '',
    'Goal:',
    requestHint,
    '',
    'Output requirements:',
    '- Give a clear Root Cause (most likely + alternatives).',
    '- Give a Remediation Runbook (step-by-step).',
    '- Include: Intune UI locations, Graph endpoints if relevant, and any PowerShell/CLI commands.',
    '- Provide validation steps and what to check if it still fails.',
    '- Be concise but actionable.',
    '',
    `Context:`,
    `- App View: ${view}`,
    '',
    'Tenant/Auth Context (sanitized):',
    safeJson(sanitizedTenant),
    '',
    'Auto-detected signals:',
    detected.length ? detected.join('\n') : '- (none)',
    '',
    'Selected Row / Evidence (sanitized):',
    safeJson(sanitizedRow ?? { note: 'No row selected' }),
    '',
    'Important:',
    '- If Graph endpoints return errors like "Resource not found for the segment", explain what that means and suggest alternative endpoints.',
    '- If permissions/scopes might be missing, list the exact Graph permissions and admin-consent requirement.',
    ''
  ].join('\n');

  if (prompt.length <= MAX_PROMPT_CHARS) return prompt;

  // If too long, truncate the evidence first
  const trimmedEvidence = safeJson(sanitizedRow ?? { note: 'No row selected' }).slice(0, 6000);

  const shortPrompt = [
    'You are "M-Intune Architect AI" specialized in Microsoft Intune troubleshooting and remediation.',
    '',
    'Goal:',
    requestHint,
    '',
    'Output requirements:',
    '- Root Cause (most likely + alternatives)',
    '- Remediation Runbook (step-by-step)',
    '- Validation steps',
    '',
    `Context: App View: ${view}`,
    '',
    'Tenant/Auth Context (sanitized):',
    safeJson(sanitizedTenant),
    '',
    'Selected Row / Evidence (sanitized, truncated):',
    trimmedEvidence,
    ''
  ].join('\n');

  return shortPrompt.slice(0, MAX_PROMPT_CHARS);
}

async function copyToClipboard(text: string) {
  // Prefer modern clipboard
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  // Fallback
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  ta.style.top = '-9999px';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}

export async function openIntuneAI(
  row: AnyRow,
  view: string,
  auth: AuthStatus,
  options?: { scrubPii?: boolean }
) {
  const scrubPii = options?.scrubPii ?? DEFAULT_SCRUB_PII;

  const prompt = buildPrompt({
    row,
    view,
    auth,
    scrubPii
  });

  await copyToClipboard(prompt);

  // Open GPT in new tab
  window.open(GPT_URL, '_blank', 'noopener,noreferrer');
}