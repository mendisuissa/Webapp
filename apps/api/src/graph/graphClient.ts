import { safeArray } from '../utils/safe.js';

const GRAPH_BASE = 'https://graph.microsoft.com';

interface GraphListPayload {
  value?: unknown;
  '@odata.nextLink'?: unknown;
}

interface GraphRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  maxRetries?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function graphFetch(accessToken: string, path: string, options: GraphRequestOptions = {}): Promise<Response> {
  const method = options.method ?? 'GET';
  const maxRetries = options.maxRetries ?? 3;
  let attempt = 0;
  let delay = 500;

  while (attempt <= maxRetries) {
    const response = await fetch(`${GRAPH_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers ?? {})
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined
    });

    if (response.ok) {
      return response;
    }

    if ((response.status === 429 || response.status === 503) && attempt < maxRetries) {
      await sleep(delay);
      delay *= 2;
      attempt += 1;
      continue;
    }

    const text = await response.text();
    throw new Error(`Graph request failed (${response.status}) on ${method} ${path}: ${text || response.statusText}`);
  }

  throw new Error(`Graph request exhausted retries on ${method} ${path}`);
}

export async function graphRequest<T>(accessToken: string, path: string, options: GraphRequestOptions = {}): Promise<T> {
  const response = await graphFetch(accessToken, path, options);
  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  return text ? JSON.parse(text) as T : undefined as T;
}

export async function graphNoContent(accessToken: string, path: string, options: GraphRequestOptions = {}): Promise<void> {
  await graphFetch(accessToken, path, options);
}

export async function graphList(accessToken: string, path: string, headers: Record<string, string> = {}): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  let nextPath: string | undefined = path;

  while (nextPath) {
    const payload: GraphListPayload = await graphRequest<GraphListPayload>(accessToken, nextPath, { headers });
    all.push(...safeArray<Record<string, unknown>>(payload.value));

    const next: string = typeof payload['@odata.nextLink'] === 'string' ? payload['@odata.nextLink'] : '';
    if (!next) {
      nextPath = undefined;
      continue;
    }

    nextPath = next.startsWith(GRAPH_BASE) ? next.replace(GRAPH_BASE, '') : next;
  }

  return all;
}
