# Webapp — Intune App & Device Management Workspace

Web console for Intune app deployment status, incident triage, and Win32
packaging — connects to Microsoft Graph (or runs in mock mode with no
tenant connection needed).

## What it does

- **App status normalization** — every raw Intune app-assignment status
  pulled from Graph is run through a signature-based normalization engine
  (`engines/normalization.ts`) that assigns a category, likely cause,
  confidence score, error family, and a signature hash for dedup — so
  "installation failed with error 0x87D1041C" becomes a recognizable,
  actionable pattern instead of a raw code.
- **Incident intelligence** — normalized statuses are grouped into incidents
  by severity threshold (`engines/incidents.ts`,
  `engines/incidentIntelligence.ts`), persisted via Prisma
  (`storage/incidentRepository.ts`), with an AI-generated smart summary per
  incident (`engines/smartSummary.ts`) and recommended remediation playbooks
  (`engines/playbooks.ts`).
- **Win32 packaging** — a live resolver checks WinGet then Silent Install HQ
  for a given app query (`engines/win32LiveResolver.ts`), a catalog of known
  packages (`engines/win32Catalog.ts`), and a zip builder
  (`engines/win32Zip.ts`) that produces the actual Win32 package — with a
  dedicated package-builder workspace in the frontend
  (`Win32PackageBuilderWorkspace.tsx`).
- **WinGet → Intune deploy** — `services/wingetDeploy.ts` pushes a resolved
  WinGet package directly into Intune as an app assignment.
- **Intune AI drawer** — a chat-style panel (`IntuneAIDrawer.tsx`,
  `routes/intuneAi.ts`) for ad-hoc questions against the current Intune/Graph
  data.
- **Compliance/audit panels** — `Phase1AuditPanels.tsx` +
  `engines/remediationAuditPhase1.ts` for a first-phase remediation audit
  view.
- **Auth** — Microsoft Graph via MSAL (`auth/msal.ts`), with a `mockMode`
  config flag that bypasses the tenant connection entirely for local/demo
  use.

## Structure

- `apps/api` — Express + TypeScript backend; `routes/api.ts` is the main
  route file wiring the engines above together.
- `apps/web` — React frontend.
- `packages/shared` — shared TypeScript types (`@efm/shared`) between the
  two.
