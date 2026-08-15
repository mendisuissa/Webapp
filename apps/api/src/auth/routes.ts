import { Router, type Request } from 'express';
import { config } from '../config.js';
import { getMsalApp } from './msal.js';
import { validateQaToken } from './qaAuth.js';

export const authRouter = Router();

function getRequestOrigin(req: Request): string {
  const forwardedProto = req.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const forwardedHost = req.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || req.get('host') || '';
  const protocol = forwardedProto || req.protocol;
  return `${protocol}://${host}`;
}

function decodeTokenScopes(token: string): string[] {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
    const scp: string = payload?.scp ?? '';
    const roles: string[] = payload?.roles ?? [];
    return [...scp.split(' ').filter(Boolean), ...roles];
  } catch {
    return [];
  }
}

authRouter.get('/status', (req, res) => {
  // QA test sessions (see POST /qa-login) have no accessToken by design —
  // they can't call Graph, so report connected-with-no-write-permissions
  // rather than falling through to the "not connected" branch below.
  if (req.session.isQaTestSession) {
    return res.json({
      connected: true,
      upn: 'qa-bot@modernendpoint.tech',
      tenantId: config.qaLogin.tenantId,
      displayName: 'QA Automation',
      mockMode: config.mockMode,
      hasWritePermissions: false,
      scopes: []
    });
  }

  if (!req.session.account || !req.session.accessToken) {
    return res.json({ connected: false, upn: '', tenantId: '', displayName: '', mockMode: config.mockMode, hasWritePermissions: false, scopes: [] });
  }

  const scopes = decodeTokenScopes(req.session.accessToken);
  const writeScopes = [
    'DeviceManagementApps.ReadWrite.All',
    'Group.Read.All',
    'Directory.Read.All',
    'DeviceManagementConfiguration.ReadWrite.All'
  ];
  const hasWritePermissions = writeScopes.some((s) => scopes.includes(s)) || req.session.hasWritePermissions === true;

  return res.json({
    connected: true,
    upn: req.session.account.username ?? '',
    tenantId: req.session.account.tenantId ?? '',
    displayName: req.session.account.name ?? '',
    mockMode: config.mockMode,
    hasWritePermissions,
    scopes
  });
});

authRouter.get('/login', async (req, res) => {
  try {
    const origin = getRequestOrigin(req);
    const redirectUri = config.entra.redirectUri !== 'http://localhost:4000/api/auth/callback'
      ? config.entra.redirectUri
      : `${origin}/api/auth/callback`;
    const elevated = req.query.elevated === 'true';

    req.session.authRedirectUri = redirectUri;
    req.session.authReturnUrl = config.webAppUrl !== 'http://localhost:5173' ? config.webAppUrl : origin;
    req.session.authElevated = elevated;

    const msal = getMsalApp();
    const scopes = elevated ? config.entra.scopesWrite : config.entra.scopes;
    const authCodeUrl = await msal.getAuthCodeUrl({
      scopes,
      redirectUri,
      prompt: elevated ? 'consent' : undefined
    });
    res.redirect(authCodeUrl);
  } catch (error) {
    res.status(500).json({ message: error instanceof Error ? error.message : 'Login setup failed.' });
  }
});

authRouter.get('/callback', async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  if (!code) {
    return res.status(400).send('Missing auth code.');
  }

  try {
    const redirectUri = req.session.authRedirectUri ?? config.entra.redirectUri;
    const elevated = req.session.authElevated === true;
    const msal = getMsalApp();
    const requestedScopes = elevated ? config.entra.scopesWrite : config.entra.scopes;
    const tokenResponse = await msal.acquireTokenByCode({
      code,
      scopes: requestedScopes,
      redirectUri
    });

    req.session.accessToken = tokenResponse?.accessToken;
    req.session.account = {
      username: tokenResponse?.account?.username,
      tenantId: tokenResponse?.tenantId,
      name: tokenResponse?.account?.name
    };

    const grantedScopes = tokenResponse?.accessToken ? decodeTokenScopes(tokenResponse.accessToken) : [];
    req.session.hasWritePermissions = grantedScopes.includes('DeviceManagementApps.ReadWrite.All') || grantedScopes.includes('Group.Read.All') || grantedScopes.includes('Directory.Read.All') || grantedScopes.includes('DeviceManagementConfiguration.ReadWrite.All');

    const returnUrl = req.session.authReturnUrl ?? config.webAppUrl;
    req.session.authRedirectUri = undefined;
    req.session.authReturnUrl = undefined;
    req.session.authElevated = undefined;

    res.redirect(returnUrl);
  } catch (error) {
    res.status(500).send(error instanceof Error ? error.message : 'Auth callback failed');
  }
});

// QA-only login path: trades a verified client-credentials token from the
// dedicated QA app registration for a real session, so the automated QA
// bot can test the authenticated dashboard/devices/apps views without ever
// performing interactive Microsoft sign-in. See auth/qaAuth.ts for what
// "verified" requires — this is not a generic bypass, it rejects anything
// that isn't signed by the exact configured tenant for the exact
// configured QA app id. Deliberately never sets accessToken: this session
// only satisfies the "is someone signed in" UI gate — it cannot call Graph
// on anyone's behalf, so getDataBundle() falls back to its existing
// fixture-data path (same path used today for local dev / MOCK_MODE)
// instead of ever touching real tenant data.
authRouter.post('/qa-login', async (req, res) => {
  const authHeader = req.get('authorization') || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (!bearer) {
    return res.status(401).json({ message: 'Missing bearer token.' });
  }

  try {
    const claims = await validateQaToken(bearer);

    req.session.account = {
      username: 'qa-bot@modernendpoint.tech',
      tenantId: claims.tid ?? config.qaLogin.tenantId,
      name: 'QA Automation'
    };
    req.session.isQaTestSession = true;

    console.log('QA_LOGIN_OK', { appId: claims.azp ?? claims.appid });
    res.json({ ok: true });
  } catch (error) {
    console.warn('QA_LOGIN_REJECTED', error instanceof Error ? error.message : error);
    res.status(401).json({ message: 'Invalid QA token.' });
  }
});

authRouter.post('/logout', (req, res) => {
  if (!req.session) return res.json({ ok: true });
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ ok: false, message: 'Logout failed.' });
    res.json({ ok: true });
  });
});

/**
 * GET /api/auth/webapp-consent/callback
 *
 * Microsoft redirects here after the customer grants Intune admin consent
 * to the Webapp app registration. This route is PUBLIC (no session required).
 *
 * It forwards all query params to the IdentityMonitor backend so that it can
 * persist the webappConsentGrantedAt timestamp and redirect the user to the
 * IdentityMonitor dashboard.
 *
 * Required env var: IDENTITY_MONITOR_API_URL (e.g. https://identity.modernendpoint.tech)
 */
authRouter.get('/webapp-consent/callback', (req, res) => {
  const identityApiBase = (process.env.IDENTITY_MONITOR_API_URL ?? '').replace(/\/$/, '');

  if (!identityApiBase) {
    // Fallback: redirect to the Webapp's own frontend with a note
    const fallback = config.webAppUrl.replace(/\/$/, '');
    return res.redirect(`${fallback}?webapp_consent=error&reason=identity_api_url_not_configured`);
  }

  // Pass all Microsoft query params (admin_consent, tenant, error, etc.) through
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query)) {
    if (typeof v === 'string') params.set(k, v);
  }

  res.redirect(`${identityApiBase}/api/auth/webapp-consent/callback?${params.toString()}`);
});
