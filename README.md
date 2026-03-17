This pack fixes the previous issue where App.tsx did not include the new Win32 Utility view.

Included:
- apps/web/src/App.tsx  -> merged shell with sidebar + Win32 Utility view wired in
- apps/web/src/components/Win32UtilityWorkspace.tsx
- apps/web/src/components/win32UtilitySeed.ts
- apps/web/src/styles/index-delta-additions.css

Merge notes:
1. Replace your current apps/web/src/App.tsx with the one in this ZIP.
2. Add the two component files under apps/web/src/components/.
3. Append or replace your index-delta-additions.css with the one in this ZIP.
4. Ensure your main stylesheet imports index-delta-additions.css.

This is a UI-integrated delta baseline with mock/seed data for the Win32 Utility workspace.
