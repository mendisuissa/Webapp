import { Router, type Request } from 'express';
import { config } from '../config.js';
import { getMsalApp } from './msal.js';

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

authRouter.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});
