import express from 'express';
import cors from 'cors';
import session from 'express-session';
import { pinoHttp } from 'pino-http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { logger, requestLogger } from './utils/logger.js';
import { authRouter } from './auth/routes.js';
import { apiRouter } from './routes/api.js';
import remediationRouter from './routes/remediation.js';

const app = express();
const isProduction = config.nodeEnv === 'production';

// ✅ OpenAI domain verification (PUBLIC) — token per host (app vs api)
app.get('/.well-known/openai-apps-challenge', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  const host = String(req.headers.host ?? '').toLowerCase();

  // 🔴 Update this to the CURRENT token shown in OpenAI UI for api.modernendpoint.tech
  const tokenApi = 'rxqL7PqkBv5kcVS38BHwsU0PIS8N4T3TR8KhqN7NFm0';

  // Keep this as the token used for app.modernendpoint.tech (if OpenAI UI ever points there)
  const tokenApp = 'NPxTCBzK-29NrjELqdkAo92lee5IBPgaLHTp7nk4dEQ';

  const token = host.includes('api.modernendpoint.tech') ? tokenApi : tokenApp;

  res.type('text/plain').send(token);
});

// ✅ MCP OAuth discovery endpoints (PUBLIC)
// OpenAI MCP scanner probes these even when "No Auth" is selected.
// Return minimal valid JSON to avoid "Tool scan failed: Internal service error".

app.get('/.well-known/oauth-protected-resource', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    resource: 'https://api.modernendpoint.tech/api/mcp',
    authorization_servers: [], // No Auth mode
    scopes_supported: []
  });
});

// Some scanners probe with path suffix
app.get('/.well-known/oauth-protected-resource/api/mcp', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    resource: 'https://api.modernendpoint.tech/api/mcp',
    authorization_servers: [],
    scopes_supported: []
  });
});

// OpenID/OAuth server metadata — return minimal docs (No Auth)
app.get('/.well-known/oauth-authorization-server', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    issuer: 'https://api.modernendpoint.tech',
    authorization_endpoint: null,
    token_endpoint: null,
    jwks_uri: null,
    response_types_supported: [],
    subject_types_supported: [],
    id_token_signing_alg_values_supported: []
  });
});

app.get('/.well-known/oauth-authorization-server/api/mcp', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    issuer: 'https://api.modernendpoint.tech',
    authorization_endpoint: null,
    token_endpoint: null,
    jwks_uri: null,
    response_types_supported: [],
    subject_types_supported: [],
    id_token_signing_alg_values_supported: []
  });
});

// Some scanners use OpenID configuration name
app.get('/.well-known/openid-configuration', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    issuer: 'https://api.modernendpoint.tech',
    authorization_endpoint: null,
    token_endpoint: null,
    jwks_uri: null,
    response_types_supported: [],
    subject_types_supported: [],
    id_token_signing_alg_values_supported: []
  });
});

app.get('/.well-known/openid-configuration/api/mcp', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    issuer: 'https://api.modernendpoint.tech',
    authorization_endpoint: null,
    token_endpoint: null,
    jwks_uri: null,
    response_types_supported: [],
    subject_types_supported: [],
    id_token_signing_alg_values_supported: []
  });
});
const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);

/**
 * IMPORTANT:
 * - In production build, server.js lives under: out/apps/api
 * - Web build lives under: out/apps/web
 * Therefore webDistPath must be resolved relative to the compiled server location.
 *
 * Local/dev fallback remains supported if you still build web into apps/web/dist.
 */
const webDistPath = isProduction
  ? path.resolve(currentDir, '../web')          // out/apps/web
  : path.resolve(currentDir, '../../web/dist'); // dev fallback (if relevant)

const webIndexPath = path.join(webDistPath, 'index.html');

app.use(pinoHttp({ logger: requestLogger }));

// ✅ CORS allowlist (and allow no-origin for curl/postman)
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (config.corsOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('CORS origin denied.'));
    },
    credentials: true
  })
);

app.use(express.json({ limit: '2mb' }));

// ✅ Required behind reverse proxies (Azure App Service / ARR)
if (isProduction) {
  // trust first proxy hop
  app.set('trust proxy', 1);
}

app.use(
  session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      // secure cookies only on HTTPS; with trust proxy, req.secure works correctly
      secure: isProduction
    }
  })
);

// ✅ Static web app (prod only)
if (isProduction) {
  if (fs.existsSync(webIndexPath)) {
    app.use(express.static(webDistPath));
    logger.info({ webDistPath }, 'Serving web build from webDistPath');
  } else {
    logger.warn({ webDistPath, webIndexPath }, 'Web build not found; SPA will not be served.');
  }
}

// ✅ Root
app.get('/', (_req, res) => {
  if (isProduction && fs.existsSync(webIndexPath)) {
    res.sendFile(webIndexPath);
    return;
  }

  res.type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Intune Install Status</title>
</head>
<body style="font-family:Segoe UI,Arial,sans-serif;background:#f8fafc;color:#0f172a;margin:0;">
  <main style="max-width:760px;margin:64px auto;padding:24px;background:#ffffff;border:1px solid #e2e8f0;border-radius:10px;">
    <h1 style="margin:0 0 12px;">Intune Install Status &amp; Remediation</h1>
    <p style="margin:0 0 16px;">Public preview is available. Sign in to access tenant data and remediation actions.</p>
    <p style="margin:0 0 20px;">
      <a href="/api/auth/login" style="display:inline-block;padding:10px 14px;border-radius:8px;background:#2563eb;color:#fff;text-decoration:none;">Sign in</a>
    </p>
    <p style="margin:0;font-size:13px;color:#475569;">Service health: <a href="/health">/health</a></p>
  </main>
</body>
</html>`);
});

// ✅ Health (both paths) - PUBLIC (for CI health checks)
app.get('/health', (_req, res) => {
  res.json({ ok: true, mockMode: config.mockMode, now: new Date().toISOString() });
});
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, mockMode: config.mockMode, now: new Date().toISOString() });
});

// ✅ Diagnostics
app.get('/api/diag', (req, res) => {
  const requestHost = req.get('host') ?? '';
  const requestProtocol = req.get('x-forwarded-proto') ?? req.protocol;
  const requestOrigin = req.get('origin') ?? '';
  const callbackUrl = config.entra.redirectUri;

  const callbackHost = (() => {
    try {
      return new URL(callbackUrl).host;
    } catch {
      return '';
    }
  })();

  res.json({
    ok: true,
    now: new Date().toISOString(),
    nodeEnv: config.nodeEnv,
    app: {
      webAppUrl: config.webAppUrl,
      corsOrigins: config.corsOrigins
    },
    request: {
      host: requestHost,
      protocol: requestProtocol,
      origin: requestOrigin,
      secure: req.secure
    },
    auth: {
      redirectUri: callbackUrl,
      redirectHost: callbackHost,
      callbackHostMatchesRequestHost: Boolean(
        callbackHost && requestHost && callbackHost.toLowerCase() === requestHost.toLowerCase()
      ),
      configured: Boolean(config.entra.tenantId && config.entra.clientId && config.entra.clientSecret),
      scopes: config.entra.scopes
    },
    sessionCookiePolicy: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction
    },
    runtime: {
      nodeVersion: process.version
    },
    web: {
      webDistPath,
      webIndexExists: fs.existsSync(webIndexPath)
    }
  });
});

// ✅ API routers (must be after session)
app.use('/api/auth', authRouter);
app.use('/api/remediation', remediationRouter);
app.use('/api', apiRouter);

// ✅ SPA fallback (prod only) — keep AFTER /api mounts
if (isProduction) {
  app.get('*', (req, res, next) => {
    // Don't let SPA swallow OpenAI domain verification
    if (
      req.path === '/health' ||
      req.path.startsWith('/api') ||
      req.path.startsWith('/.well-known')
    ) return next();

    if (fs.existsSync(webIndexPath)) return res.sendFile(webIndexPath);
    return res.status(404).type('text/plain').send('Web build not found.');
  });
}

// ✅ Global error handler (api + others)
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, 'Unhandled API error');
  res.status(500).json({ message: err instanceof Error ? err.message : 'Unexpected server error.' });
});

app.listen(config.port, () => {
  logger.info(`API listening on port ${config.port}`);
});
