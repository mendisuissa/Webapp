Win32 phase 2 delta

Files included:
- apps/api/src/engines/win32LiveResolver.ts
- apps/web/src/api/client.ts
- apps/web/src/components/Win32UtilityWorkspace.tsx

What this delta adds:
- direct installer metadata (installerUrl, installerType, downloadPageUrl, version)
- confidenceScore and confidenceReasons from backend
- Chocolatey source search
- Official docs search and parsing (heuristic)
- GitHub release parsing for installer assets (heuristic)
- exportReadiness states (ready/partial/research-needed)
- UI actions for installer/docs/release links

Notes:
- Official docs and GitHub parsing are heuristic and should be validated per app.
- This delta was prepared on top of the uploaded Webapp-main project and should be tested with npm build after merge.
