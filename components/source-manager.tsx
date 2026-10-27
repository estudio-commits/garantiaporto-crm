"use client";
import { useState } from "react";
import type { ClientSource } from "@/lib/domain";
export default function SourceManager({
  sources,
  busy,
  save,
}: {
  sources: ClientSource[];
  busy: boolean;
  save: (
    v: Record<string, unknown>,
    m: "insert" | "update",
  ) => Promise<boolean>;
}) {
  const [message, setMessage] = useState("");
  async function submit(form: HTMLFormElement, id?: string) {
    const name = String(new FormData(form).get("name")).trim();
    if (!name) return;
    if (
      sources.some(
        (s) =>
          s.id !== id &&
          s.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
      )
    ) {
      setMessage("Ya existe un origen con ese nombre.");
      return;
    }
    setMessage("");
    const ok = await save(
      {
        id: id || crypto.randomUUID(),
        name,
        ...(!id ? { archived: false } : {}),
      },
      id ? "update" : "insert",
    );
    if (ok && !id) form.reset();
  }
  return (
    <section className="card padded">
      <h2>Orígenes de clientes</h2>
      <p className="muted">
        Identificá de dónde llega cada solicitud. Archivar un origen conserva
        los casos y estadísticas existentes.
      </p>
      <form
        className="source-create"
        onSubmit={(e) => {
          e.preventDefault();
          submit(e.currentTarget);
        }}
      >
        <label>
          Nuevo origen
          <input
            name="name"
            placeholder="Ej. Referidos"
            required
            maxLength={100}
          />
        </label>
        <button className="primary" disabled={busy}>
          Agregar origen
        </button>
      </form>
      {message && <p role="alert">{message}</p>}
      {sources.map((s) => (
        <div className="source-row" key={s.id}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(e.currentTarget, s.id);
            }}
          >
            <input
              aria-label={`Nombre del origen ${s.name}`}
              name="name"
              defaultValue={s.name}
              required
              maxLength={100}
            />
            <button className="secondary" disabled={busy}>
              Guardar nombre
            </button>
          </form>
          <span className="muted">{s.archived ? "Archivado" : "Activo"}</span>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => save({ id: s.id, archived: !s.archived }, "update")}
          >
            {s.archived ? "Reactivar" : "Archivar"}
          </button>
        </div>
      ))}
    </section>
  );
}
