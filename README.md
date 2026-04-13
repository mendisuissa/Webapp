Apply these files as a delta on top of your current Webapp repo.

Updated files:
- apps/api/src/engines/win32LiveResolver.ts
- apps/api/src/routes/api.ts
- apps/web/src/api/client.ts
- apps/web/src/components/Win32UtilityWorkspace.tsx
- apps/web/src/App.tsx
- apps/web/src/index.css

What changed:
- Replaced the rough inline Win32 Utility UI with a cleaner workspace that matches the current design language better.
- Added a live resolver route: GET /api/win32/resolve?q=...
- Resolver checks WinGet first, then Silent Install HQ, then returns a clean no-result state with source links.
- Results now show source, evidence, alternatives, and a better empty state instead of a broken-looking screen.

Notes:
- The detection script is still generated from source clues and standard registry paths. Validate before production.
- Silent Install HQ results are community-sourced. Treat them as medium confidence.
