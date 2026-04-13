import { useEffect, useMemo, useState } from 'react';
import { callIntuneAI, getSignature } from '../utils/intuneAIClient.js';
import { openIntuneAI } from '../utils/openIntuneAI.js';

type Props = {
  open: boolean;
  onClose: () => void;
  action: 'explain' | 'runbook' | 'execSummary';
  row: Record<string, unknown> | null;
  view: string;
  auth: { connected: boolean; upn?: string; tenantId?: string; displayName?: string };
};

export function IntuneAIDrawer(props: Props) {
  const { open, action, row, view, auth } = props;
  const signature = useMemo(() => getSignature(row), [row]);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);

  useEffect(() => {
    if (!open) return;

    setLoading(true);
    setErr(null);
    setNotConfigured(false);

    callIntuneAI({ action, row, view })
      .then((r: any) => {
        if (r?.notConfigured) {
          setNotConfigured(true);
          setResult(null);
          return;
        }
        if (!r?.ok) setErr(r?.message ?? 'AI request failed');
        setResult(r?.result ?? null);
      })
      .catch((e: unknown) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [open, action, signature, view]);

  if (!open) return null;

  return (
    <div id="intune-ai-drawer" style={{ position: 'fixed', right: 0, top: 0, width: 560, height: '100%', background: '#0b0f17', color: '#fff', borderLeft: '1px solid #233', zIndex: 9999, overflow: 'auto' }}>
      <div style={{ padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 14, opacity: 0.8 }}>AI • {action}</div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{result?.title ?? 'M-Intune Architect AI'}</div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Signature: {signature}</div>
        </div>
        <button onClick={props.onClose} style={{ background: 'transparent', color: '#fff', border: '1px solid #334', padding: '6px 10px', borderRadius: 8 }}>
          Close
        </button>
      </div>

      <div style={{ padding: 16, paddingTop: 0 }}>
        {loading && <div style={{ opacity: 0.8 }}>Thinking…</div>}

        {notConfigured && (
          <div style={{ border: '1px solid #334', borderRadius: 10, padding: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>AI provider not configured on server</div>
            <div style={{ opacity: 0.85, marginBottom: 10 }}>Fallback available: copy prompt + open your GPT link.</div>
            <button
              onClick={() => openIntuneAI(row, view as any, auth as any, { scrubPii: true })}
              style={{ background: '#1e293b', color: '#fff', border: '1px solid #334', padding: '8px 10px', borderRadius: 8 }}
            >
              Open GPT (fallback)
            </button>
          </div>
        )}

        {err && <div style={{ color: '#ffb4b4', marginTop: 8 }}>{err}</div>}

        {result && (
          <div style={{ marginTop: 12, whiteSpace: 'pre-wrap', opacity: 0.92 }}>
            {/* You already have a richer renderer; keep yours if exists */}
            {JSON.stringify(result, null, 2)}
          </div>
        )}
      </div>
    </div>
  );
}