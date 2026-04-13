type IntuneAIAction = 'explain' | 'runbook' | 'execSummary';
type AnyRow = Record<string, unknown> | null;

const TTL_DAYS = 7;
const TTL_MS = TTL_DAYS * 24 * 60 * 60 * 1000;

function now() { return Date.now(); }

export function getSignature(row: AnyRow): string {
  const appId = String((row as any)?.appId ?? (row as any)?.AppId ?? '').trim();
  const errorCode = String((row as any)?.errorCode ?? (row as any)?.ErrorCode ?? '').trim();
  const cat = String((row as any)?.normalizedCategory ?? (row as any)?.NormalizedCategory ?? '').trim();
  return [appId, errorCode, cat].join('|');
}

function scrubPII(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  if (Array.isArray(input)) return input.map(scrubPII);

  const piiKeys = new Set([
    'upn','userprincipalname','mail','email','username','displayname','userdisplayname',
    'devicename','serialnumber','id','deviceid','userid','azureaddeviceid','enrollmentid',
  ]);

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (piiKeys.has(k.toLowerCase())) out[k] = '[REDACTED]';
    else out[k] = scrubPII(v);
  }
  return out;
}

function cacheKey(action: IntuneAIAction, signature: string) {
  return `intuneAI:v1:${action}:${signature}`;
}

export function cacheGet(action: IntuneAIAction, signature: string) {
  const key = cacheKey(action, signature);
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    if (!obj?.ts || (now() - obj.ts) > TTL_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return obj.value ?? null;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

export function cacheSet(action: IntuneAIAction, signature: string, value: unknown) {
  const key = cacheKey(action, signature);
  localStorage.setItem(key, JSON.stringify({ ts: now(), value }));
}

export async function callIntuneAI(params: { action: IntuneAIAction; row: AnyRow; view: string }) {
  const signature = getSignature(params.row);

  const cached = cacheGet(params.action, signature);
  if (cached) return { ok: true, result: cached, cached: true, signature };

  const body = {
    action: params.action,
    signature,
    view: params.view,
    row: scrubPII(params.row ?? {}),
  };

  const resp = await fetch('/api/ai/intune', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (resp.status === 501) return { ok: false, notConfigured: true, signature };
  if (resp.status === 401) return { ok: false, unauthorized: true, signature };

  const json = await resp.json().catch(() => ({}));
  if (json?.ok && json?.result) cacheSet(params.action, signature, json.result);
  return { ...json, signature };
}
