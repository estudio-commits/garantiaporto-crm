import { driveConfig } from "@/lib/drive";
import { processCaseFolders, serviceClient } from "@/lib/whatsapp-server";

export const runtime = "nodejs";
export const maxDuration = 60;

// Called by the CRM right after a user creates a case, so its Drive folder appears without
// waiting for the cron. Any active user may trigger it; it only processes the server-side queue.
export async function POST(req: Request) {
  const db = serviceClient();
  const drive = driveConfig();
  if (!db || !drive.enabled)
    return Response.json({ skipped: "drive disabled" }, { status: 503 });
  const bearer = req.headers.get("authorization");
  if (!bearer?.startsWith("Bearer "))
    return Response.json({ error: "Sin autorización" }, { status: 401 });
  const {
    data: { user },
  } = await db.auth.getUser(bearer.slice(7));
  if (!user)
    return Response.json({ error: "Sin autorización" }, { status: 401 });
  const { data: p } = await db
    .from("profiles")
    .select("active")
    .eq("id", user.id)
    .single();
  if (!p?.active)
    return Response.json({ error: "Acceso denegado" }, { status: 403 });
  const r = await processCaseFolders(db, drive, 5).catch(() => null);
  return Response.json(r ?? { error: "Drive no disponible" }, {
    status: r ? 200 : 503,
  });
}
