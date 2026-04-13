# Production Deployment Runbook (Azure App Service)

## Current Live Endpoints
- API custom domain: `https://api.modernendpoint.tech`
- Web custom domain: `https://app.modernendpoint.tech`
- Azure default app URL: `https://moderne-wa-fne8h7hnb9emehdp.israelcentral-01.azurewebsites.net`
- Health endpoint: `https://api.modernendpoint.tech/health`

## App Service
- App name: `ModernE-Wa`
- OS/Stack: Linux, Node 22 LTS
- Startup command:
  - `node out/apps/api/server.js`

## Required App Settings
Set these under App Service -> Environment variables -> App settings:

- `NODE_ENV=production`
- `SCM_DO_BUILD_DURING_DEPLOYMENT=false`
- `ENABLE_ORYX_BUILD=false`
- `WEBSITE_WARMUP_PATH=/health`
- `WEBSITES_CONTAINER_START_TIME_LIMIT=1800`
- `SESSION_SECRET=<long-random-secret>`
- `WEB_APP_URL=https://app.modernendpoint.tech`
- `CORS_ORIGINS=https://app.modernendpoint.tech`
- `ENTRA_REDIRECT_URI=https://api.modernendpoint.tech/api/auth/callback`

Entra values (real tenant values required):
- `ENTRA_CLIENT_ID`
- `ENTRA_CLIENT_SECRET`
- `ENTRA_TENANT_ID`
- `GRAPH_SCOPES`

## Domain + TLS
- `api.modernendpoint.tech` added as custom domain
- SSL binding type: `SNI SSL`
- Certificate: App Service managed certificate
- `app.modernendpoint.tech` can be bound similarly if needed for web host routing

## Entra App Registration
Authentication -> Web redirect URIs must include:
- `https://api.modernendpoint.tech/api/auth/callback`
- `https://moderne-wa-fne8h7hnb9emehdp.israelcentral-01.azurewebsites.net/api/auth/callback` (optional fallback)

API permissions must be granted + **Admin consent** completed.

## CI/CD (GitHub Actions)
Workflow file:
- `.github/workflows/main_moderne-wa.yml`

Key behavior:
- Builds `@iisr/shared` + `@iisr/api`
- Runs Prisma generate for API
- Includes hidden files in artifact upload (required for Prisma client files)
- Deploys via `azure/webapps-deploy`

## Post-Deploy Validation
1. Confirm deployment succeeded in Deployment Center.
2. Verify health:
   - `GET /health` returns JSON including `"ok": true`.
3. Verify root endpoint:
   - `GET /` returns `OK`.
4. Verify auth flow:
   - Open `https://api.modernendpoint.tech/api/auth/login`
   - Complete sign-in and confirm callback success.
5. Verify app-to-api CORS from `https://app.modernendpoint.tech`.

## Troubleshooting Quick Notes
- `503` on startup usually means startup command/app settings mismatch or runtime crash in logs.
- Prisma error like `Cannot find module '.prisma/client/default'` means generated Prisma files were not included in deployment artifact.
- `DNS_PROBE_FINISHED_NXDOMAIN` means wrong subdomain or missing DNS record.

## Operational Tips
- Keep one stable fallback callback URI (azurewebsites.net) until custom domain auth is fully verified.
- Rotate `SESSION_SECRET` and `ENTRA_CLIENT_SECRET` on a schedule.
- Enable Application Insights for ongoing monitoring.
