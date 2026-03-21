Merged delta for production base (Webapp-main (6).zip)

Included files:
- apps/api/src/server.ts
- apps/api/src/routes/remediation.ts
- apps/web/src/index.css

What this delta does:
1. Integrates the remediation API under /api/remediation.
2. Upgrades remediation resolve/execute to use the live Win32 resolver when possible, with safer error handling.
3. Fixes the Apps workspace overlap issue by adding more vertical spacing below the sticky hero header and adjusting sticky side panels.

Notes:
- Requires REMEDIATION_SHARED_TOKEN in App Service if you want the second app to authenticate with a shared bearer token.
- After applying, run:
  npm run build -w @efm/api && npm run build -w @efm/web
