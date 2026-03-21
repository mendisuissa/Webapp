Combined delta for production base (Webapp-main (6).zip)

Included files:
- apps/api/src/routes/remediation.ts
- apps/api/src/server.ts
- apps/web/src/index.css

This merge includes:
- remediation health/resolve/execute endpoints
- remediation bundle download route
- live execute flow via /api/winget/deploy when WinGet-backed
- ZIP fallback bundle flow for non-WinGet/offline scenarios
- Apps pane/header layout spacing fix in index.css

Environment:
- REMEDIATION_SHARED_TOKEN

Recommended build:
- npm run build -w @efm/api && npm run build -w @efm/web
