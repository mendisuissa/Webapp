import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { AppStatusRow, ManagedDevice, MobileApp, UserRow } from '@efm/shared';
import { config } from '../config.js';
import { asString, safeDate } from '../utils/safe.js';
import { graphList, graphRequest } from './graphClient.js';

interface DataBundle {
  apps: MobileApp[];
  appStatuses: AppStatusRow[];
  users: UserRow[];
  devices: ManagedDevice[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function fixtureCandidates(name: string): string[] {
  return [
    path.resolve(process.cwd(), 'fixtures', name),
    path.resolve(process.cwd(), 'apps', 'api', 'fixtures', name),
    path.resolve(__dirname, '..', '..', 'fixtures', name),
    path.resolve(__dirname, '..', '..', '..', 'apps', 'api', 'fixtures', name),
    path.resolve(__dirname, '..', '..', '..', '..', 'apps', 'api', 'fixtures', name)
  ];
}

async function loadFixture<T>(name: string): Promise<T[]> {
  for (const fixturePath of fixtureCandidates(name)) {
    try {
      const raw = await fs.readFile(fixturePath, 'utf8');
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data as T[] : [];
    } catch {
      // try next candidate
    }
  }

  throw new Error(`Fixture not found: ${name}`);
}

function normalizePlatform(item: Record<string, unknown>): string {
  const rawType = asString(item['@odata.type'] ?? item.platform, 'unknown').toLowerCase();
  if (rawType.includes('win') || rawType.includes('officeSuiteApp'.toLowerCase()) || rawType.includes('msi')) return 'windows';
  if (rawType.includes('ios') || rawType.includes('android') || rawType.includes('mobile')) return 'mobile';
  if (rawType.includes('mac')) return 'macOS';
  return rawType || 'unknown';
}

function mapApp(item: Record<string, unknown>): MobileApp {
  return {
    id: asString(item.id),
    displayName: asString(item.displayName),
    publisher: asString(item.publisher),
    platform: normalizePlatform(item),
    lastModifiedDateTime: safeDate(item.lastModifiedDateTime)
  };
}

function mapDevice(item: Record<string, unknown>): ManagedDevice {
  return {
    id: asString(item.id),
    deviceName: asString(item.deviceName),
    operatingSystem: asString(item.operatingSystem),
    osVersion: asString(item.osVersion),
    complianceState: asString(item.complianceState, 'unknown'),
    lastSyncDateTime: safeDate(item.lastSyncDateTime),
    userDisplayName: asString(item.userDisplayName),
    userPrincipalName: asString(item.userPrincipalName)
  };
}

function mapUser(item: Record<string, unknown>): UserRow {
  return {
    id: asString(item.id),
    displayName: asString(item.displayName),
    userPrincipalName: asString(item.userPrincipalName),
    mail: asString(item.mail, '')
  };
}

function mapStatus(item: Record<string, unknown>, app: MobileApp, targetType: 'device' | 'user'): AppStatusRow {
  const errorCode = asString(item.errorCode, 'Unknown');
  const errorDescription = asString(item.errorDescription, 'Unknown');
  const installState = asString(item.installState, asString(item.status, 'Unknown')).toLowerCase();

  return {
    id: asString(item.id),
    appId: app.id,
    appName: app.displayName,
    targetType,
    targetId: asString(item.deviceId ?? item.userId),
    targetName: asString(item.deviceDisplayName ?? item.userDisplayName, 'Unknown'),
    installState,
    errorCode,
    errorDescription,
    lastReportedDateTime: safeDate(item.lastReportedDateTime),
    normalizedCategory: 'Unknown',
    cause: 'Unknown',
    confidence: 0,
    recommendedActions: []
  };
}

function isIgnorableGraphError(err: any): boolean {
  const msg = String(err?.message ?? '');
  return (
    msg.includes("Resource not found for the segment 'deviceStatuses'") ||
    msg.includes("Resource not found for the segment 'userStatuses'") ||
    msg.includes('Request not applicable to target tenant') ||
    msg.includes('BadRequest') ||
    msg.includes('Forbidden') ||
    msg.includes('Application is not authorized') ||
    msg.includes('Resource not found for the segment')
  );
}

function isFatalGraphAuthError(err: any): boolean {
  const msg = String(err?.message ?? '');
  return (
    msg.includes('InvalidAuthenticationToken') ||
    msg.includes('Authentication') ||
    msg.includes('AADSTS') ||
    msg.includes('Unauthorized')
  );
}

async function safeGraphList(accessToken: string, url: string): Promise<Record<string, unknown>[]> {
  try {
    return await graphList(accessToken, url);
  } catch (err: any) {
    if (isIgnorableGraphError(err)) return [];
    if (isFatalGraphAuthError(err)) throw err;
    throw err;
  }
}

async function safeGraphListWithFallback(accessToken: string, urls: string[]): Promise<Record<string, unknown>[]> {
  let lastErr: any = null;
  for (const url of urls) {
    try {
      const rows = await safeGraphList(accessToken, url);
      if (rows.length > 0) return rows;
    } catch (err: any) {
      lastErr = err;
      if (isIgnorableGraphError(err)) continue;
      throw err;
    }
  }
  if (lastErr && isIgnorableGraphError(lastErr)) return [];
  return [];
}

async function getGraphApps(accessToken: string): Promise<MobileApp[]> {
  const v1 = await graphList(accessToken, '/v1.0/deviceAppManagement/mobileApps?$select=id,displayName,publisher,lastModifiedDateTime');
  if (v1.length > 0) return v1.map(mapApp);

  const beta = await graphList(accessToken, '/beta/deviceAppManagement/mobileApps?$select=id,displayName,publisher,lastModifiedDateTime');
  return beta.map(mapApp);
}

async function getGraphAppStatuses(accessToken: string, apps: MobileApp[]): Promise<AppStatusRow[]> {
  const rows: AppStatusRow[] = [];
  for (const app of apps) {
    const deviceStatuses = await safeGraphListWithFallback(accessToken, [
      `/v1.0/deviceAppManagement/mobileApps/${app.id}/deviceStatuses`,
      `/beta/deviceAppManagement/mobileApps/${app.id}/deviceStatuses`
    ]);
    rows.push(...deviceStatuses.map((x) => mapStatus(x, app, 'device')));

    const userStatuses = await safeGraphListWithFallback(accessToken, [
      `/v1.0/deviceAppManagement/mobileApps/${app.id}/userStatuses`,
      `/beta/deviceAppManagement/mobileApps/${app.id}/userStatuses`
    ]);
    rows.push(...userStatuses.map((x) => mapStatus(x, app, 'user')));
  }
  return rows;
}

async function getGraphUsers(accessToken: string): Promise<UserRow[]> {
  const users = await safeGraphList(accessToken, '/v1.0/users?$select=id,displayName,userPrincipalName,mail');
  if (users.length > 0) return users.map(mapUser);
  try {
    const me = await graphRequest<Record<string, unknown>>(accessToken, '/v1.0/me?$select=id,displayName,userPrincipalName,mail');
    return me?.id ? [mapUser(me)] : [];
  } catch (err: any) {
    if (isIgnorableGraphError(err)) return [];
    throw err;
  }
}

async function getGraphDevices(accessToken: string): Promise<ManagedDevice[]> {
  const devices = await safeGraphListWithFallback(accessToken, [
    '/v1.0/deviceManagement/managedDevices?$select=id,deviceName,operatingSystem,osVersion,complianceState,lastSyncDateTime,userDisplayName,userPrincipalName,serialNumber,joinType,deviceEnrollmentType',
    '/beta/deviceManagement/managedDevices?$select=id,deviceName,operatingSystem,osVersion,complianceState,lastSyncDateTime,userDisplayName,userPrincipalName,serialNumber,joinType,deviceEnrollmentType'
  ]);
  return devices.map(mapDevice);
}

export async function getDataBundle(accessToken?: string): Promise<DataBundle> {
  if (config.mockMode || !accessToken) {
    const [apps, appStatuses, users, devices] = await Promise.all([
      loadFixture<MobileApp>('apps.json'),
      loadFixture<AppStatusRow>('appStatuses.json'),
      loadFixture<UserRow>('users.json'),
      loadFixture<ManagedDevice>('devices.json')
    ]);
    return { apps, appStatuses, users, devices };
  }

  const apps = await getGraphApps(accessToken);
  const [appStatuses, users, devices] = await Promise.all([
    getGraphAppStatuses(accessToken, apps),
    getGraphUsers(accessToken),
    getGraphDevices(accessToken)
  ]);

  return { apps, appStatuses, users, devices };
}
