1. Apply `patches/packages_shared_src_index.diff`
2. Add `overlay/apps/api/src/engines/remediationAuditPhase1.ts`
3. Apply `patches/apps_api_src_routes_api.diff`
4. Apply `patches/apps_web_src_api_client.diff`
5. Add `overlay/apps/web/src/components/Phase1AuditPanels.tsx`
6. Apply `patches/apps_web_src_App.diff`

Then run:
- npm install
- npm run build
