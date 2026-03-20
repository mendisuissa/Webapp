Win32 UI + Source Expansion delta

Included changes:
- UI refresh for Win32 Utility workspace
  - 3-column workflow layout
  - recommended package card
  - source and confidence filters
  - richer result cards with badges, reasons, and selection state
  - improved right-side selection panel
- Source expansion prep in resolver
  - added Chocolatey package search as a source-backed package option
  - added official docs and GitHub release enrichment as alternative sources
  - expanded checked source list and source labels
- Client type updates for new source types
- CSS updates for upgraded result cards and workflow layout

Files:
- apps/api/src/engines/win32LiveResolver.ts
- apps/web/src/api/client.ts
- apps/web/src/components/Win32UtilityWorkspace.tsx
- apps/web/src/index.css

Notes:
- This delta focuses on the UI polish phase plus practical source expansion.
- Official docs and GitHub are added as enrichment/alternative links, not full source-backed installers yet.
- Chocolatey is added as a source-backed candidate path.
