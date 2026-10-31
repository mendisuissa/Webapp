// Entry point (App Service startup: node out/apps/api/server.js).
//
// Order matters (issue #20): answer health and bind PORT first, then load the application.
// Only express/http and ./health.js are imported statically, so no config, file logging on the
// /home share, Prisma or Graph/Entra initialisation can run before the listener is up.
import express from 'express';
import http from 'http';
import { healthState, registerHealthRoutes } from './health.js';

const port = Number(process.env.PORT ?? 4000);

const root = express();
root.disable('x-powered-by');
registerHealthRoutes(root);

const server = http.createServer(root);
server.listen(port, () => {
  console.log(`API listening on port ${port}; loading application`);
  void loadApplication();
});

async function loadApplication(): Promise<void> {
  try {
    const { app } = await import('./app.js');
    if (app.get('trust proxy')) root.set('trust proxy', app.get('trust proxy'));
    root.use(app);
    healthState.ready = true;
    console.log('Application loaded');
  } catch (err) {
    healthState.initError = err instanceof Error ? err.message : String(err);
    console.error('Application failed to load; serving health only', err);
    root.use((_req, res) => {
      res.status(503).json({ ok: false, message: 'Service is starting or failed to start.' });
    });
  }
}
