import 'express-session';

declare module 'express-session' {
  interface SessionData {
    accessToken?: string;
    authRedirectUri?: string;
    authReturnUrl?: string;
    account?: {
      username?: string;
      tenantId?: string;
      name?: string;
    };
    authElevated?: boolean;
    hasWritePermissions?: boolean;
    // Set by POST /api/auth/qa-login (see auth/qaAuth.ts) — a verified QA
    // bot session with no real accessToken, so it can pass the "signed in"
    // gate for UI checks without ever calling Graph on anyone's behalf.
    isQaTestSession?: boolean;
  }
}
