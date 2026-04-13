# Live Win32 source-resolution delta

Apply these files into your existing `Webapp-main` repo:

- `apps/api/src/engines/win32LiveResolver.ts`
- `apps/api/src/routes/api.ts`
- `apps/web/src/api/client.ts`
- `apps/web/src/components/Win32UtilityWorkspace.tsx`
- `apps/web/src/App.tsx`

## What changes
- Replaces the fake Win32 preset experience with live source resolution.
- Searches WinGet first.
- If there is no good WinGet match, searches Silent Install HQ.
- Returns source URL, source title, install command, uninstall command, notes, and evidence.
- Generates detection script from source clues.
- If no reliable source exists, the UI says so instead of inventing commands.

## Important
- Install/uninstall commands are source-backed only.
- Detection script is generated and should still be validated before production use.
- This delta does **not** claim 1000 verified apps.
