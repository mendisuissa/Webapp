import type { Request, Response } from 'express';
import { OpenAI } from 'openai';

type IntuneAIAction = 'explain' | 'runbook' | 'execSummary';

type IntuneAIRequestBody = {
  action: IntuneAIAction;
  signature: string;
  view?: string;
  row?: Record<string, unknown> | null;
};

type CachedItem = { expiresAt: number; value: any };
const mem = new Map<string, CachedItem>();
const TTL_DAYS = Number(process.env.INTUNE_AI_CACHE_TTL_DAYS ?? '7');
const TTL_MS = Math.max(1, TTL_DAYS) * 24 * 60 * 60 * 1000;

function cacheGet(key: string) {
  const hit = mem.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    mem.delete(key);
    return null;
  }
  return hit.value;
}
function cacheSet(key: string, value: any) {
  mem.set(key, { value, expiresAt: Date.now() + TTL_MS });
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

const IntuneAIResultSchema = {
  name: 'intune_ai_result',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['action', 'signature', 'title', 'createdAt'],
    properties: {
      action: { type: 'string', enum: ['explain', 'runbook', 'execSummary'] },
      signature: { type: 'string' },
      title: { type: 'string' },

      errorMeaning: { type: 'string' },
      likelyCauses: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'why', 'confidence'],
          properties: {
            title: { type: 'string' },
            why: { type: 'string' },
            confidence: { type: 'string', enum: ['high', 'med', 'low'] }
          }
        }
      },
      checks: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'steps'],
          properties: { name: { type: 'string' }, steps: { type: 'array', items: { type: 'string' } } }
        }
      },

      runbook: {
        type: 'object',
        additionalProperties: false,
        required: ['steps'],
        properties: {
          steps: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['title', 'details'],
              properties: {
                title: { type: 'string' },
                details: { type: 'array', items: { type: 'string' } },
                commands: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['label', 'cmd'],
                    properties: { label: { type: 'string' }, cmd: { type: 'string' } }
                  }
                },
                validations: { type: 'array', items: { type: 'string' } }
              }
            }
          },
          rollback: { type: 'array', items: { type: 'string' } }
        }
      },

      executiveSummary: {
        type: 'object',
        additionalProperties: false,
        required: ['situation', 'impact', 'mostLikelyCause', 'nextActions'],
        properties: {
          situation: { type: 'string' },
          impact: { type: 'string' },
          mostLikelyCause: { type: 'string' },
          nextActions: { type: 'array', items: { type: 'string' } }
        }
      },

      references: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['label'],
          properties: { label: { type: 'string' }, url: { type: 'string' }, note: { type: 'string' } }
        }
      },

      rawText: { type: 'string' },
      createdAt: { type: 'string' },
      model: { type: 'string' }
    }
  }
};

function buildSystemBase() {
  return [
    'You are "M-Intune Architect AI | Enterprise Edition" — enterprise-grade Intune troubleshooting agent.',
    'Return JSON strictly matching the provided schema. No extra keys. No markdown.',
    'Do not output PII. Treat user/device identifiers as redacted.',
    'Be actionable: checks, commands, validations. Use enterprise tone.'
  ].join('\n');
}

function buildSystemMode(action: IntuneAIAction) {
  if (action === 'explain') {
    return 'MODE: Troubleshooting. Output errorMeaning, likelyCauses (ranked), checks.';
  }
  if (action === 'runbook') {
    return 'MODE: Runbook. Output runbook.steps with commands and validations, include rollback if relevant.';
  }
  return 'MODE: Executive. Output executiveSummary with short business-friendly text.';
}

function buildUser(body: IntuneAIRequestBody) {
  const evidence = scrubPII(body.row ?? {});
  return [
    `Action: ${body.action}`,
    `Signature: ${body.signature}`,
    body.view ? `View: ${body.view}` : '',
    'Evidence (sanitized):',
    JSON.stringify(evidence, null, 2)
  ].filter(Boolean).join('\n');
}

export async function postIntuneAi(req: Request, res: Response) {
  const body = req.body as IntuneAIRequestBody;

  if (!body?.action || !body?.signature) {
    return res.status(400).json({ ok: false, message: 'Missing action/signature' });
  }

  const cacheKey = `intuneAI:v1:${body.action}:${body.signature}`;
  const cached = cacheGet(cacheKey);
  if (cached) return res.json({ ok: true, result: cached, cached: true });

  if (!process.env.OPENAI_API_KEY) {
    return res.status(501).json({ ok: false, message: 'AI provider not configured' });
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_MODEL ?? 'gpt-4.1-mini';

  const rsp = await client.responses.create({
    model,
    input: [
      { role: 'system', content: buildSystemBase() },
      { role: 'system', content: buildSystemMode(body.action) },
      { role: 'user', content: buildUser(body) }
    ],
    text: { format: { type: 'json_schema', ...IntuneAIResultSchema } }
  });

  const text = rsp.output_text ?? '';
  let parsed: any;
  try { parsed = JSON.parse(text); }
  catch {
    parsed = {
      action: body.action,
      signature: body.signature,
      title: 'AI response (unparsed)',
      rawText: text,
      createdAt: new Date().toISOString(),
      model
    };
  }

  parsed.action = parsed.action ?? body.action;
  parsed.signature = parsed.signature ?? body.signature;
  parsed.createdAt = parsed.createdAt ?? new Date().toISOString();
  parsed.model = parsed.model ?? model;

  cacheSet(cacheKey, parsed);
  return res.json({ ok: true, result: parsed, cached: false });
}