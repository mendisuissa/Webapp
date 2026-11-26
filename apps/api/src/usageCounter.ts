// usageCounter.ts — counts who uses this product, nothing else (owner decision on #172, 26.11).
//
// One JSON file: { "YYYY-MM-DD": { "<event>": { "<tenantId or 'demo'>": ["<user hash>", ...] } } }.
// No names, no addresses, no tokens: a user is the first 16 hex characters of a SHA-256 of their object id.
// On App Service the file lives in /home/data, which survives restarts and deploys (the code folder is read-only).
// Kept for 400 days. A failure here never affects the request that triggered it.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const FILE =
  process.env.USAGE_COUNTS_FILE ||
  (process.env.WEBSITE_SITE_NAME ? "/home/data/usage-counts.json" : path.join(process.cwd(), ".usage-counts.json"));
const KEEP_DAYS = 400;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Counts = Record<string, Record<string, Record<string, string[]>>>;

function load(): Counts {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Counts) : {};
  } catch {
    return {};
  }
}

export function recordUsage(event: string, tenantId: string | null | undefined, userKey?: string | null, now = new Date()): void {
  try {
    const tenant = tenantId && GUID.test(tenantId) ? tenantId.toLowerCase() : "demo";
    const user = crypto.createHash("sha256").update(String(userKey || "anonymous")).digest("hex").slice(0, 16);
    const day = now.toISOString().slice(0, 10);
    const counts = load();
    const byTenant = ((counts[day] ??= {})[event] ??= {});
    const users = (byTenant[tenant] ??= []);
    if (users.includes(user)) return;
    users.push(user);
    const oldest = new Date(now.getTime() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
    for (const d of Object.keys(counts)) if (d < oldest) delete counts[d];
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = `${FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(counts));
    fs.renameSync(tmp, FILE);
  } catch (err) {
    console.warn("[usage-counter] not recorded:", err instanceof Error ? err.message : String(err));
  }
}

// The object id ("oid") of the signed-in user, read from a Microsoft token without verifying it (counting only).
export function tokenUserKey(token: string | null | undefined): string | null {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split(".")[1], "base64url").toString("utf8")) as { oid?: string; sub?: string };
    return payload.oid ?? payload.sub ?? null;
  } catch {
    return null;
  }
}

export const usageCountsFile = FILE;
