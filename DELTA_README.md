# Webapp-main-permclone Phase 1 Delta

This delta is built against the current public `mendisuissa/Webapp` structure:
- `apps/web`
- `apps/api`
- `packages/shared`

The current repo already includes the first-pass Phase 1 baseline:
- dashboard impact area
- app audit endpoint
- dashboard impact endpoint
- app details audit sections

This delta therefore focuses on **tightening the implementation to better match the guidance document** instead of re-adding what already exists.

## What this delta adds

### Dashboard
- stronger impact framing
- more explicit remediation queue preview model
- proof summary with verification state
- cleaner distinction between failure volume and business impact

### App details
- richer failure clustering shape
- structured playbook model instead of string-only list
- verification workflow state
- rollout / verification readiness framing

### Backend
- minimal additional shaping helper
- optional `queuePreview` and `proofSummary` fields on `/dashboard/impact`
- richer `clusters`, `smartPlaybooks`, and `verification` payloads on `/apps/:id/audit`

## Important
This ZIP is a **real implementation delta pack**, but because the environment here cannot clone and build the repo directly, it is packaged as:
1. targeted patch files for existing repo files
2. small overlay files that can be added directly

It is intentionally narrow and keeps the existing app shell and WinGet workspace intact.
