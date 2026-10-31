import type express from 'express';

// Liveness that depends on nothing: no config module, no logger, no DB, no Graph, no filesystem.
export interface HealthState {
  ready: boolean;
  initError: string | null;
}

export const healthState: HealthState = { ready: false, initError: null };

export function healthPayload() {
  return {
    ok: true,
    service: 'webapp-api',
    version: process.env.npm_package_version || process.env.APP_VERSION || '1.0.0',
    mockMode: (process.env.MOCK_MODE ?? 'false').toLowerCase() === 'true',
    ready: healthState.ready,
    initError: healthState.initError,
    uptime: Math.floor(process.uptime()),
    now: new Date().toISOString()
  };
}

export function registerHealthRoutes(app: express.Express): void {
  const handler: express.RequestHandler = (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(healthPayload());
  };
  app.get('/health', handler);
  app.get('/api/health', handler);
}
