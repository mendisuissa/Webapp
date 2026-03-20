Phase 2 delta on production zip base

Included:
- apps/api/src/engines/win32LiveResolver.ts
- apps/web/src/api/client.ts
- apps/web/src/components/Win32UtilityWorkspace.tsx
- apps/web/src/index.css

Changes:
- Added installerUrl / installerType / downloadPageUrl / version / exportReadiness in resolver response
- Added EXE/MSI link extraction heuristics from WinGet pages, Chocolatey pages, and Silent Install HQ articles
- Added confidenceScore and confidenceReasons from backend
- Improved Win32 UI layout with horizontal filters, compact alternatives, stronger selection panel, and installer actions
