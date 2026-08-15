import dotenv from 'dotenv';

dotenv.config();

const nodeEnv = process.env.NODE_ENV ?? 'development';
const isProduction = nodeEnv === 'production';

export const config = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv,
  mockMode: (process.env.MOCK_MODE ?? 'false').toLowerCase() === 'true',
  databaseUrl: process.env.DATABASE_URL ?? (isProduction ? 'file:/home/data/iais.db' : 'file:./prisma/dev.db'),
  logFile: process.env.LOG_FILE ?? (isProduction ? '/home/LogFiles/iais/app.log' : './logs/app.log'),
  sessionSecret: process.env.SESSION_SECRET ?? (nodeEnv === 'production' ? (() => { throw new Error('SESSION_SECRET must be set in production'); })() : 'dev-session-secret'),
  webAppUrl: process.env.WEB_APP_URL ?? 'http://localhost:5173',
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(',').map((item) => item.trim()).filter(Boolean),
  refreshIntervalSeconds: 60,
  incidentWindowMinutes: 120,
  incidentThresholdCount: 10,
  severityThresholds: {
    Low: 10,
    Medium: 25,
    High: 50
  },
  entra: {
    tenantId: process.env.ENTRA_TENANT_ID ?? '',
    clientId: process.env.ENTRA_CLIENT_ID ?? '',
    clientSecret: process.env.ENTRA_CLIENT_SECRET ?? '',
    redirectUri: process.env.ENTRA_REDIRECT_URI ?? 'http://localhost:4000/api/auth/callback',
    scopes: (process.env.GRAPH_SCOPES ?? 'openid profile offline_access User.Read User.ReadBasic.All DeviceManagementManagedDevices.Read.All DeviceManagementApps.Read.All').split(' ').filter(Boolean),
    scopesWrite: (process.env.GRAPH_SCOPES_WRITE ?? 'openid profile offline_access User.Read User.ReadBasic.All DeviceManagementManagedDevices.Read.All DeviceManagementApps.Read.All DeviceManagementApps.ReadWrite.All Group.Read.All').split(' ').filter(Boolean)
  },
  // Same pattern as enrollment-flow-monitor-webapp's config.qaLogin — lets
  // the automated QA bot trade a verified client-credentials token from the
  // dedicated QA_WEBAPP app registration for a real (Graph-less) session, so
  // it can exercise the authenticated dashboard/devices/apps views instead
  // of only smoke-testing the anonymous landing page. See auth/qaAuth.ts.
  qaLogin: {
    clientId: process.env.QA_WEBAPP_CLIENT_ID ?? '',
    tenantId: process.env.QA_WEBAPP_TENANT_ID ?? ''
  }
};

export function authConfigured(): boolean {
  return Boolean(config.entra.tenantId && config.entra.clientId && config.entra.clientSecret);
}
