"use client";
import { useState } from "react";
import { ArrowLeft, ExternalLink, Clock } from "lucide-react";
import {
  Application,
  Store,
  Profile,
  Audit,
  states,
  human,
} from "@/lib/domain";
import { sourceName } from "@/lib/sources";
import {
  needsFollowUp,
  dateTime,
  validDriveFolder,
  terminal,
} from "@/lib/workflow";
import EventViewer from "./event-viewer";
export type Mutate = (
  k: keyof Store,
  v: Record<string, unknown>,
  m?: "insert" | "update" | "upsert",
  match?: string,
) => Promise<boolean>;
export default function CaseDetail({
  app: a,
  store,
  profile,
  busy,
  mutate,
  back,
  guarantee,
  compact = false,
}: {
  app: Application;
  store: Store;
  profile: Profile;
  busy: boolean;
  mutate: Mutate;
  back?: () => void;
  guarantee: (id: string, value: string) => Promise<boolean>;
  compact?: boolean;
}) {
  const [tab, setTab] = useState("Ficha"),
    [note, setNote] = useState(""),
    [error, setError] = useState("");
  const admin = profile.role === "admin";
  const sensitive = store.sensitive.find((s) => s.application_id === a.id);
  const clearing = store.clearing.find((s) => s.application_id === a.id);
  const fieldName = (k: string) =>
    (
      ({
        full_name: "Nombre",
        phone: "Celular",
        rent_amount: "Alquiler",
        rent_currency: "Moneda",
        source_id: "Origen",
        assigned_user_id: "Responsable",
        stage: "Estado comercial",
        guarantee_stage: "Proceso de la garantía",
        requested_date: "Fecha de solicitud",
        drive_folder_url: "Carpeta de Drive",
        summary: "Comentarios",
        national_id: "Cédula",
        monthly_income: "Ingresos",
        rejection_reason: "Motivo del rechazo",
        body: "Nota de seguimiento",
        value: "Valor personalizado",
        guarantee_type: "Tipo de garantía",
      }) as Record<string, string>
    )[k] || human(k);
  const display = (k: string, v: unknown) =>
    v === null || v === undefined || v === ""
      ? "Sin informar"
      : k === "assigned_user_id"
        ? store.profiles.find((p) => p.id === v)?.full_name || String(v)
        : k === "source_id"
          ? store.sources.find((s) => s.id === v)?.name || String(v)
          : typeof v === "object"
            ? JSON.stringify(v)
            : [
                  "stage",
                  "guarantee_stage",
                  "guarantee_type",
                  "decision",
                  "result",
                  "rejection_reason",
                  "documentation",
                  "preapproval",
                  "completion",
                  "contact_status",
                ].includes(k)
              ? human(String(v))
              : String(v);
  const history: Audit[] = [
    ...store.audits.filter(
      (ev) => !ev.action.toLowerCase().startsWith("notes:"),
    ),
    ...store.notes.map((n) => ({
      id: "note-" + n.id,
      application_id: n.application_id,
      actor_id: n.author_id,
      actor_name: store.audits.find(
        (ev) =>
          (ev.changes as Record<string, { after?: unknown }> | undefined)?.id
            ?.after === n.id,
      )?.actor_name,
      action: "followup",
      created_at: n.created_at,
      changes: { body: { before: null, after: n.body } },
    })),
  ];
  return (
    <>
      {back && !compact && (
        <button className="text-button back" onClick={back}>
          <ArrowLeft size={16} />
          Volver a solicitudes
        </button>
      )}
      <div className="page-heading">
        <div>
          <h1>{a.full_name}</h1>
          <p>
            {a.phone} · {sourceName(a, store.sources)}
          </p>
        </div>
      </div>
      {needsFollowUp(a) && (
        <div className="followup-banner" role="status">
          <Clock size={17} />
          Hace 2 días o más que no se actualiza este cliente. Hacé un
          seguimiento o actualizá sus datos.
        </div>
      )}
      <div className="case-dates">
        <span>
          Ingreso al CRM<strong>{dateTime(a.created_at)}</strong>
        </span>
        <span>
          Fecha de solicitud
          <strong>{a.requested_date || "Sin informar"}</strong>
        </span>
        <span>
          Última actualización<strong>{dateTime(a.updated_at)}</strong>
        </span>
      </div>
      <div className="detail-tabs tabs">
        {["Ficha", "Historial y seguimientos"].map((t) => (
          <button
            key={t}
            className={tab === t ? "selected" : ""}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      {tab === "Ficha" ? (
        <>
          <section className="card padded">
            <h2>Datos del cliente</h2>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const url = String(f.get("drive") || "").trim();
                if (!validDriveFolder(url)) {
                  setError(
                    "Ingresá un enlace HTTPS de carpeta: drive.google.com/drive/folders/…",
                  );
                  return;
                }
                setError("");
                await mutate("applications", {
                  id: a.id,
                  full_name: String(f.get("name")).trim(),
                  phone: String(f.get("phone")).trim(),
                  rent_amount: f.get("rent") ? Number(f.get("rent")) : null,
                  rent_currency: f.get("currency") || null,
                  source_id: f.get("source_id") || null,
                  guarantee_type: f.get("type"),
                  requested_date: f.get("requested_date") || null,
                  drive_folder_url: url || null,
                  summary: f.get("summary"),
                });
              }}
            >
              <div className="form-grid">
                <label>
                  Nombre completo
                  <input
                    name="name"
                    required
                    defaultValue={a.full_name}
                    maxLength={200}
                  />
                </label>
                <label>
                  Celular
                  <input
                    name="phone"
                    required
                    defaultValue={a.phone}
                    minLength={3}
                    maxLength={40}
                  />
                </label>
                <label>
                  Alquiler mensual
                  <input
                    name="rent"
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue={a.rent_amount ?? ""}
                  />
                </label>
                <label>
                  Moneda
                  <select name="currency" defaultValue={a.rent_currency || ""}>
                    <option value="">Sin informar</option>
                    <option>UYU</option>
                    <option>USD</option>
                  </select>
                </label>
                <label>
                  Origen del cliente
                  <select name="source_id" defaultValue={a.source_id || ""}>
                    <option value="">Sin identificar</option>
                    {store.sources
                      .filter((s) => !s.archived || s.id === a.source_id)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Tipo de garantía
                  <select name="type" defaultValue={a.guarantee_type}>
                    {["tradicional", "universitaria", "rural", "otra"].map(
                      (t) => (
                        <option key={t} value={t}>
                          {human(t)}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <label>
                  Fecha de solicitud
                  <input
                    name="requested_date"
                    type="date"
                    defaultValue={a.requested_date || ""}
                  />
                </label>
              </div>
              <label>
                Carpeta de Google Drive
                <input
                  name="drive"
                  type="url"
                  maxLength={2048}
                  placeholder="https://drive.google.com/drive/folders/…"
                  defaultValue={a.drive_folder_url || ""}
                />
              </label>
              <p className="muted">
                Se guarda únicamente el enlace. Los archivos y permisos
                permanecen en Google Drive.
              </p>
              {a.drive_folder_url && validDriveFolder(a.drive_folder_url) && (
                <a
                  className="text-button drive-link"
                  href={a.drive_folder_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Abrir carpeta de documentación <ExternalLink size={15} />
                </a>
              )}
              <label>
                Comentarios del cliente
                <textarea
                  name="summary"
                  defaultValue={a.summary}
                  maxLength={10000}
                />
              </label>
              <button className="secondary" disabled={busy}>
                Guardar datos
              </button>
            </form>
            {admin && (
              <details className="extra-data">
                <summary>
                  Identificación e ingresos · Acceso restringido
                </summary>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    mutate(
                      "sensitive",
                      {
                        application_id: a.id,
                        national_id: f.get("ci"),
                        monthly_income: f.get("income")
                          ? Number(f.get("income"))
                          : null,
                      },
                      "upsert",
                      "application_id",
                    );
                  }}
                >
                  <div className="form-grid">
                    <label>
                      Cédula
                      <input
                        name="ci"
                        defaultValue={sensitive?.national_id || ""}
                      />
                    </label>
                    <label>
                      Ingresos declarados
                      <input
                        name="income"
                        type="number"
                        min="0"
                        step="0.01"
                        defaultValue={sensitive?.monthly_income ?? ""}
                      />
                    </label>
                  </div>
                  <button className="secondary" disabled={busy}>
                    Guardar identificación e ingresos
                  </button>
                </form>
              </details>
            )}
            {store.fields
              .filter((f) => !f.archived && (!f.sensitive || admin))
              .map((f) => (
                <form
                  className="extra-data"
                  key={f.id}
                  onSubmit={(e) => {
                    e.preventDefault();
                    mutate(
                      "values",
                      {
                        application_id: a.id,
                        field_id: f.id,
                        value: String(
                          new FormData(e.currentTarget).get("value"),
                        ),
                      },
                      "upsert",
                      "application_id",
                    );
                  }}
                >
                  <label>
                    {f.label}
                    {["select", "boolean"].includes(f.type) ? (
                      <select
                        name="value"
                        defaultValue={
                          store.values.find(
                            (v) =>
                              v.application_id === a.id && v.field_id === f.id,
                          )?.value || ""
                        }
                      >
                        <option value="">Sin informar</option>
                        {(f.type === "boolean" ? ["Sí", "No"] : f.options).map(
                          (v) => (
                            <option key={v}>{v}</option>
                          ),
                        )}
                      </select>
                    ) : (
                      <input
                        name="value"
                        type={f.type}
                        defaultValue={
                          store.values.find(
                            (v) =>
                              v.application_id === a.id && v.field_id === f.id,
                          )?.value || ""
                        }
                      />
                    )}
                  </label>
                  <button disabled={busy} className="secondary">
                    Guardar {f.label}
                  </button>
                </form>
              ))}
          </section>
          <section className="card padded">
            <h2>Estado comercial y proceso de la garantía</h2>
            <div className="form-grid">
              <label>
                Estado comercial
                <select
                  aria-label="Estado comercial"
                  disabled={busy}
                  value={a.stage}
                  onChange={(e) =>
                    mutate("applications", { id: a.id, stage: e.target.value })
                  }
                >
                  {states.stage.map((s) => (
                    <option key={s} value={s}>
                      {human(s)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Proceso de la garantía
                <select
                  aria-label="Proceso de la garantía"
                  disabled={busy || (!admin && terminal(a.guarantee_stage))}
                  value={a.guarantee_stage || "sin_contactar"}
                  onChange={(e) => guarantee(a.id, e.target.value)}
                >
                  {states.guarantee_stage.map((s) => (
                    <option key={s} value={s} disabled={!admin && terminal(s)}>
                      {human(s)}
                    </option>
                  ))}
                </select>
              </label>
              {admin && (
                <label>
                  Responsable
                  <select
                    aria-label="Asignar responsable"
                    value={a.assigned_user_id || ""}
                    disabled={busy}
                    onChange={(e) =>
                      mutate("applications", {
                        id: a.id,
                        assigned_user_id: e.target.value || null,
                      })
                    }
                  >
                    <option value="">Sin asignar</option>
                    {store.profiles
                      .filter((p) => p.active)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.full_name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
            </div>
            {a.guarantee_stage === "rechazada" && admin && (
              <p>
                Motivo del rechazo:{" "}
                {sensitive?.rejection_reason
                  ? human(sensitive.rejection_reason)
                  : "Sin informar en el registro anterior"}
              </p>
            )}
            {terminal(a.guarantee_stage) && (
              <p className="muted">
                Decisión formal: {a.decision_date || "Sin fecha"} ·{" "}
                {a.decision_reference || "Sin referencia"}
              </p>
            )}
            <p className="muted">
              Los dos procesos son independientes. Solo administración confirma
              aprobación o rechazo formal.
            </p>
            {admin && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  mutate("applications", { id: a.id, archived: !a.archived })
                }
              >
                {a.archived ? "Restaurar cliente" : "Archivar cliente"}
              </button>
            )}
          </section>
        </>
      ) : (
        <section className="card padded">
          <h2>Historial y seguimientos</h2>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await mutate(
                  "notes",
                  {
                    id: crypto.randomUUID(),
                    application_id: a.id,
                    author_id: profile.id,
                    body: note.trim(),
                    created_at: new Date().toISOString(),
                  },
                  "insert",
                )
              )
                setNote("");
            }}
          >
            <label>
              Nuevo seguimiento
              <textarea
                aria-label="Nueva nota"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                required
                maxLength={10000}
              />
            </label>
            <button className="primary" disabled={busy || !note.trim()}>
              Agregar nota
            </button>
          </form>
          {history
            .filter(
              (ev) =>
                ev.application_id === a.id &&
                (admin ||
                  !["admin", "clearing"].includes(ev.visibility || "case") ||
                  (ev.visibility === "clearing" && profile.can_clearing)),
            )
            .sort((x, y) => y.created_at.localeCompare(x.created_at))
            .map((ev) => (
              <article className="timeline" key={ev.id}>
                <strong>
                  {ev.action === "followup"
                    ? "Seguimiento"
                    : ev.action.includes("INSERT")
                      ? "Carga de datos"
                      : ev.action === "form_event"
                        ? "Recepción de formulario"
                        : "Modificación de datos"}
                </strong>
                <small>
                  {dateTime(ev.created_at)} ·{" "}
                  {ev.actor_name ||
                    store.profiles.find((p) => p.id === ev.actor_id)
                      ?.full_name ||
                    "Sistema / equipo"}
                </small>
                {ev.changes && typeof ev.changes === "object" ? (
                  <dl className="audit-changes">
                    {Object.entries(ev.changes as Record<string, unknown>)
                      .filter(
                        ([k]) =>
                          !["id", "application_id", "author_id"].includes(k),
                      )
                      .map(([k, v]) => {
                        const d = v as { before?: unknown; after?: unknown };
                        return (
                          <div key={k}>
                            <dt>{fieldName(k)}</dt>
                            <dd>
                              {ev.action === "followup"
                                ? String(d.after || "")
                                : d && typeof d === "object" && "after" in d
                                  ? `${display(k, d.before)} → ${display(k, d.after)}`
                                  : display(k, v)}
                            </dd>
                          </div>
                        );
                      })}
                  </dl>
                ) : null}
              </article>
            ))}
          <article className="timeline">
            <strong>Ingreso al CRM</strong>
            <small>{dateTime(a.created_at)}</small>
          </article>
          <details>
            <summary>Datos técnicos de origen y formulario</summary>
            <p>Origen del cliente: {sourceName(a, store.sources)}</p>
            <p>Medio de carga: {human(a.source)}</p>
            {admin && <EventViewer applicationId={a.id} />}
          </details>
          {(admin || profile.can_clearing) && (
            <details className="extra-data">
              <summary>Registro manual de Clearing</summary>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  mutate(
                    "clearing",
                    {
                      application_id: a.id,
                      result: f.get("result"),
                      detail: f.get("detail"),
                    },
                    "upsert",
                    "application_id",
                  );
                }}
              >
                <label>
                  Resultado
                  <select
                    name="result"
                    defaultValue={clearing?.result || "no_consultado"}
                  >
                    {states.clearing.map((v) => (
                      <option key={v} value={v}>
                        {human(v)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Referencia
                  <textarea
                    name="detail"
                    defaultValue={clearing?.detail || ""}
                  />
                </label>
                <button disabled={busy} className="secondary">
                  Guardar Clearing
                </button>
              </form>
            </details>
          )}
        </section>
      )}
    </>
  );
}
