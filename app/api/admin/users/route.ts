import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
const schema = z
  .object({
    full_name: z.string().trim().min(2).max(100),
    email: z.email(),
    password: z.string().min(12).max(128),
    role: z.enum(["admin", "seller"]),
  })
  .strict();
export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    return Response.json({ error: "Backend sin configurar" }, { status: 503 });
  const bearer = req.headers.get("authorization");
  if (!bearer?.startsWith("Bearer "))
    return Response.json({ error: "Sin autorización" }, { status: 401 });
  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
  } = await db.auth.getUser(bearer.slice(7));
  if (!user)
    return Response.json({ error: "Sin autorización" }, { status: 401 });
  const { data: p } = await db
    .from("profiles")
    .select("role,active")
    .eq("id", user.id)
    .single();
  if (!p?.active || p.role !== "admin")
    return Response.json({ error: "Acceso denegado" }, { status: 403 });
  if (Number(req.headers.get("content-length") || 0) > 4096)
    return Response.json(
      { error: "Solicitud demasiado grande" },
      { status: 413 },
    );
  let input;
  try {
    input = schema.safeParse(await req.json());
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  if (!input.success)
    return Response.json(
      { error: "Verificá nombre, email y contraseña (mínimo 12 caracteres)" },
      { status: 422 },
    );
  const { full_name, email, password, role } = input.data;
  const created = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error)
    return Response.json(
      {
        error: "No se pudo crear la cuenta; verificá que no exista previamente",
      },
      { status: 409 },
    );
  const result = await db
    .from("profiles")
    .insert({ id: created.data.user.id, full_name, role });
  if (result.error) {
    await db.auth.admin.deleteUser(created.data.user.id);
    return Response.json(
      { error: "No se pudo crear el perfil" },
      { status: 500 },
    );
  }
  await db
    .from("audit_log")
    .insert({
      actor_id: user.id,
      action: "user_created",
      changes: { user_id: created.data.user.id, role },
    });
  return Response.json({ id: created.data.user.id }, { status: 201 });
}
