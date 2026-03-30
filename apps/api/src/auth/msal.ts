import { ConfidentialClientApplication } from '@azure/msal-node';
import { authConfigured, config } from '../config.js';

let app: ConfidentialClientApplication | null = null;

export function getMsalApp(): ConfidentialClientApplication {
  if (!authConfigured()) {
    throw new Error('Entra auth is not configured. Set ENTRA_* variables.');
  }

  if (!app) {
    app = new ConfidentialClientApplication({
      auth: {
        clientId: config.entra.clientId,
        authority: `https://login.microsoftonline.com/${config.entra.tenantId}`,
        clientSecret: config.entra.clientSecret
      }
    });
  }

  return app;
}

/**
 * Acquire an app-only access token using Client Credentials flow.
 * Used for server-to-server Graph/Intune calls when no user session is present.
 * Requires DeviceManagementApps.ReadWrite.All as an Application permission
 * with admin consent granted on the Azure App Registration.
 */
export async function getAppAccessToken(): Promise<string> {
  const msalApp = getMsalApp();
  const result = await msalApp.acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default']
  });
  if (!result?.accessToken) {
    throw new Error('Client credentials token acquisition returned no access token.');
  }
  return result.accessToken;
}
