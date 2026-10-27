"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
export default function UserCreator({ done }: { done: () => void }) {
  const [open, setOpen] = useState(false),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  if (!supabase)
    return (
      <p className="muted">
        En la demo se usan tres perfiles ficticios. Crear cuentas requiere
        conectar Supabase.
      </p>
    );
  return (
    <>
      <button className="primary" onClick={() => setOpen(!open)}>
        Crear usuario
      </button>
      {open && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const f = new FormData(e.currentTarget);
            const {
              data: { session },
            } = await supabase!.auth.getSession();
            try {
              const r = await fetch("/api/admin/users", {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  authorization: `Bearer ${session?.access_token}`,
                },
                body: JSON.stringify(Object.fromEntries(f)),
              });
              const data = await r.json();
              if (!r.ok) throw Error(data.error);
              setOpen(false);
              setMessage(
                "Cuenta creada. Entregá el acceso inicial por un canal seguro.",
              );
              done();
            } catch (e) {
              setMessage(e instanceof Error ? e.message : "No se pudo crear");
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="form-grid">
            <label>
              Nombre
              <input name="full_name" required minLength={2} maxLength={100} />
            </label>
            <label>
              Email de acceso
              <input name="email" type="email" required />
            </label>
            <label>
              Contraseña inicial
              <input
                name="password"
                type="password"
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                required
              />
            </label>
            <label>
              Rol
              <select name="role">
                <option value="seller">Vendedor</option>
                <option value="admin">Administrador</option>
              </select>
            </label>
          </div>
          <button className="secondary" disabled={busy}>
            Crear cuenta sin enviar notificación
          </button>
        </form>
      )}
      {message && <p role="status">{message}</p>}
    </>
  );
}
