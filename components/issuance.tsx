"use client";
import { useState } from "react";
import type { Application } from "@/lib/domain";
import { todayUy, validateIssuance } from "@/lib/workflow";
import type { Mutate } from "./case-detail";
export default function Issuance({
  app,
  admin,
  busy,
  mutate,
}: {
  app: Application;
  admin: boolean;
  busy: boolean;
  mutate: Mutate;
}) {
  const [action, setAction] = useState<"edit" | "cancel" | null>(null);
  const [error, setError] = useState("");
  if (app.guarantee_stage !== "aprobada") return null;
  return (
    <section className="card padded">
      <h2>Emisión de la garantía</h2>
      {app.issued_date ? (
        <p>
          Emitida el <strong>{app.issued_date}</strong> · Referencia:{" "}
          {app.issued_reference}
        </p>
      ) : (
        <p>Garantía aprobada, pendiente de emisión.</p>
      )}
      {admin ? (
        <>
          {!action && (
            <div className="form-grid">
              <button
                className="secondary"
                disabled={busy}
                onClick={() => {
                  setError("");
                  setAction("edit");
                }}
              >
                {app.issued_date ? "Corregir emisión" : "Marcar como emitida"}
              </button>
              {app.issued_date && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    setError("");
                    setAction("cancel");
                  }}
                >
                  Anular registro de emisión
                </button>
              )}
            </div>
          )}
          {action === "edit" && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const values = {
                  issued_date: String(f.get("date")),
                  issued_reference: String(f.get("reference")).trim(),
                };
                try {
                  validateIssuance({ ...app, ...values }, app, {
                    role: "admin",
                  });
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : "Revisá los datos.",
                  );
                  return;
                }
                if (await mutate("applications", { id: app.id, ...values })) {
                  setAction(null);
                  setError("");
                } else
                  setError(
                    "No se pudo guardar la emisión. Revisá el mensaje del panel y reintentá.",
                  );
              }}
            >
              <label>
                Fecha de emisión
                <input
                  type="date"
                  name="date"
                  required
                  defaultValue={app.issued_date || todayUy()}
                />
              </label>
              <label>
                Referencia de emisión
                <input
                  name="reference"
                  required
                  maxLength={2000}
                  defaultValue={app.issued_reference || ""}
                  placeholder="Número de póliza o referencia confirmada"
                />
              </label>
              <p className="muted">
                Registrá una emisión ya confirmada. Esta acción no emite una
                póliza en Porto Seguro.
              </p>
              <button className="primary" disabled={busy}>
                Guardar emisión
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => setAction(null)}
              >
                Cancelar
              </button>
            </form>
          )}
          {action === "cancel" && (
            <div>
              <p>
                Se quitará el registro del CRM y volverá a emisiones pendientes.
                El historial conservará los datos anteriores. Esto no anula la
                póliza en Porto Seguro.
              </p>
              <button
                className="secondary"
                disabled={busy}
                onClick={async () => {
                  if (
                    await mutate("applications", {
                      id: app.id,
                      issued_date: null,
                      issued_reference: null,
                    })
                  ) {
                    setAction(null);
                    setError("");
                  } else setError("No se pudo anular el registro.");
                }}
              >
                Confirmar anulación del registro
              </button>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => setAction(null)}
              >
                Volver
              </button>
            </div>
          )}
          {error && <p role="alert">{error}</p>}
        </>
      ) : (
        <p className="muted">
          Administración registra y corrige las emisiones.
        </p>
      )}
    </section>
  );
}
