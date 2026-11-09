// Server-only Google Drive client for a Workspace shared drive, via a service account.
// The service account only reaches the shared drive (or folders) explicitly shared with it.
import { createSign } from "node:crypto";

export type DriveConfig = {
  enabled: boolean;
  clientEmail: string;
  privateKey: string;
  parentFolderId: string;
};

const FOLDER_ID = /^[A-Za-z0-9_-]{10,200}$/;

export function driveConfig(): DriveConfig {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
  // Vercel stores multi-line secrets fine, but pasted keys often carry literal "\n".
  const privateKey = (
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || ""
  ).replace(/\\n/g, "\n");
  const parentFolderId = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID || "";
  return {
    enabled:
      /^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/.test(clientEmail) &&
      privateKey.includes("PRIVATE KEY") &&
      FOLDER_ID.test(parentFolderId),
    clientEmail,
    privateKey,
    parentFolderId,
  };
}

export function folderIdFromUrl(url: string | null | undefined) {
  const m =
    /^https:\/\/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]+)/.exec(
      url ?? "",
    );
  return m ? m[1] : null;
}
export const folderUrl = (id: string) =>
  `https://drive.google.com/drive/folders/${id}`;

const b64url = (v: string | Buffer) =>
  Buffer.from(v)
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

let cached: { key: string; token: string; exp: number } | null = null;

export async function driveToken(
  cfg: DriveConfig,
  fetcher: typeof fetch = fetch,
) {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.key === cfg.clientEmail && cached.exp - 60 > now)
    return cached.token;
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: cfg.clientEmail,
      scope: "https://www.googleapis.com/auth/drive",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const signature = b64url(
    createSign("RSA-SHA256").update(`${header}.${claims}`).sign(cfg.privateKey),
  );
  const r = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}`,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const data = (await r.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!r.ok || !data.access_token)
    throw new DriveError(
      `Google rechazó la cuenta de servicio (HTTP ${r.status}).`,
      r.status >= 500,
    );
  cached = {
    key: cfg.clientEmail,
    token: data.access_token,
    exp: now + (data.expires_in ?? 3600),
  };
  return data.access_token;
}

export class DriveError extends Error {
  retry: boolean;
  constructor(message: string, retry: boolean) {
    super(message);
    this.retry = retry;
  }
}

async function driveJson(
  token: string,
  url: string,
  init: RequestInit,
  fetcher: typeof fetch,
) {
  const r = await fetcher(url, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string>),
      authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(30000),
  });
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) {
    const msg =
      r.status === 404
        ? "La carpeta no existe o no está compartida con la cuenta del CRM."
        : r.status === 403
          ? "La cuenta del CRM no tiene permiso para escribir en esa carpeta."
          : `Error de Google Drive (HTTP ${r.status}).`;
    throw new DriveError(msg, r.status === 429 || r.status >= 500);
  }
  return data;
}

const API = "https://www.googleapis.com/drive/v3/files";

/** Finds the case folder created earlier for this case (tagged with appProperties) or creates it. */
export async function ensureCaseFolder(
  cfg: DriveConfig,
  caseId: string,
  name: string,
  fetcher: typeof fetch = fetch,
) {
  const token = await driveToken(cfg, fetcher);
  const q = `appProperties has { key='crm_case' and value='${caseId.replace(/[^0-9a-f-]/gi, "")}' } and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const found = await driveJson(
    token,
    `${API}?${new URLSearchParams({ q, fields: "files(id)", supportsAllDrives: "true", includeItemsFromAllDrives: "true", corpora: "allDrives", pageSize: "1" })}`,
    { method: "GET" },
    fetcher,
  );
  const existing = (found.files as { id: string }[] | undefined)?.[0]?.id;
  if (existing) return existing;
  const created = await driveJson(
    token,
    `${API}?supportsAllDrives=true&fields=id`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: name.slice(0, 200),
        mimeType: "application/vnd.google-apps.folder",
        parents: [cfg.parentFolderId],
        appProperties: { crm_case: caseId },
      }),
    },
    fetcher,
  );
  return String(created.id);
}

export async function uploadFile(
  cfg: DriveConfig,
  folderId: string,
  name: string,
  mime: string,
  bytes: Buffer,
  fetcher: typeof fetch = fetch,
) {
  if (!FOLDER_ID.test(folderId))
    throw new DriveError("Identificador de carpeta inválido.", false);
  const token = await driveToken(cfg, fetcher);
  const boundary = `porto${Date.now().toString(36)}`;
  const meta = JSON.stringify({
    name: name.slice(0, 200),
    parents: [folderId],
  });
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\ncontent-type: ${mime}\r\n\r\n`,
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const data = await driveJson(
    token,
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink",
    {
      method: "POST",
      headers: { "content-type": `multipart/related; boundary=${boundary}` },
      body,
    },
    fetcher,
  );
  const id = String(data.id);
  return {
    id,
    url:
      typeof data.webViewLink === "string"
        ? data.webViewLink
        : `https://drive.google.com/file/d/${id}/view`,
  };
}
