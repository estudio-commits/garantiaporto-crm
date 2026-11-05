"use client";
import { useRef, useState } from "react";
import { Search, GripVertical, Plus } from "lucide-react";
import { Application, Store, states, human } from "@/lib/domain";
import {
  formatCI,
  dateOnly,
  terminal,
  pendingIssuance,
  compareScheduledFollowUp,
} from "@/lib/workflow";
import { sourceName } from "@/lib/sources";
import FollowUp from "./follow-up";
export default function Pipeline({
  kind,
  admin,
  now,
  applications,
  store,
  busy,
  move,
  open,
  comment,
  stageFilter,
  setStageFilter,
}: {
  kind: "commercial" | "guarantee";
  admin: boolean;
  now: number;
  applications: Application[];
  store: Store;
  busy: boolean;
  move: (id: string, stage: string) => Promise<boolean>;
  open: (id: string) => void;
  comment: (id: string) => void;
  stageFilter: string;
  setStageFilter: (stage: string) => void;
}) {
  const [search, setSearch] = useState(""),
    [source, setSource] = useState("all"),
    [type, setType] = useState("all"),
    [over, setOver] = useState<string | null>(null),
    [status, setStatus] = useState("");
  const [order, setOrder] = useState("updated_at");
  const field = kind === "commercial" ? "stage" : "guarantee_stage";
  const moving = useRef(false);
  const [pending, setPending] = useState<Application | null>(null);
  const stages = kind === "commercial" ? states.stage : states.guarantee_stage;
  const filtered = applications
    .map((a) => (pending?.id === a.id ? pending : a))
    .filter(
      (a) =>
        `${a.full_name} ${a.phone} ${a.national_id || ""} ${formatCI(a.national_id)}`
          .toLowerCase()
          .includes(search.toLowerCase()) &&
        (source === "all" || (a.source_id || "unknown") === source) &&
        (type === "all" || a.guarantee_type === type) &&
        (stageFilter === "all" ||
          (stageFilter === "emisiones_pendientes"
            ? pendingIssuance(a)
            : a[field] === stageFilter)),
    );
  async function change(id: string, stage: string) {
    const a = applications.find((a) => a.id === id);
    if (!a || busy || moving.current || a[field] === stage) return;
    if (
      kind === "guarantee" &&
      !admin &&
      (terminal(stage) || terminal(a.guarantee_stage))
    )
      return;
    moving.current = true;
    setOver(null);
    // Formal decisions still wait for their evidence dialog before changing columns.
    const previewMove =
      (kind === "commercial" &&
        !(stage === "finalizado" && !terminal(a.guarantee_stage))) ||
      (kind === "guarantee" && !terminal(stage) && !a.issued_date);
    if (previewMove) {
      setPending({
        ...a,
        [field]: stage,
        updated_at: new Date().toISOString(),
      });
      setStatus(`Guardando movimiento de ${a.full_name}…`);
    }
    try {
      const ok = await move(id, stage);
      setStatus(
        ok
          ? `${a.full_name}: ${human(stage)}`
          : "Movimiento pendiente de confirmación o no guardado. Conserva su etapa anterior.",
      );
    } catch {
      setStatus(
        "No se pudo guardar el movimiento. La tarjeta volvió a su etapa anterior.",
      );
    } finally {
      setPending(null);
      moving.current = false;
    }
  }
  return (
    <>
      <div className="pipeline-tools">
        <label className="search">
          <Search size={16} />
          <input
            aria-label="Buscar en pipeline"
            placeholder="Nombre, cédula o celular…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label>
          Origen
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="all">Todos los orígenes</option>
            {store.sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            <option value="unknown">Sin identificar</option>
          </select>
        </label>
        <label>
          Garantía
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="all">Todos los tipos</option>
            {["tradicional", "universitaria", "rural", "otra"].map((t) => (
              <option key={t} value={t}>
                {human(t)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Ordenar por
          <select value={order} onChange={(e) => setOrder(e.target.value)}>
            <option value="updated_at">Última modificación</option>
            <option value="created_at">Fecha de ingreso</option>
          </select>
        </label>
        <label>
          Etapa
          <select
            aria-label="Filtrar etapa"
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
          >
            <option value="all">Todas las etapas</option>
            {kind === "guarantee" && (
              <option value="emisiones_pendientes">Emisiones pendientes</option>
            )}
            {stages.map((s) => (
              <option key={s} value={s}>
                {human(s)}
              </option>
            ))}
          </select>
        </label>
        <span className="muted">{filtered.length} solicitudes</span>
      </div>
      <p className="pipeline-hint">
        Abrí una tarjeta para ver la ficha o arrastrala para cambiar de etapa.
      </p>
      <div className="sr-only" role="status">
        {status}
      </div>
      <div
        className="pipeline-board"
        aria-label={
          kind === "commercial" ? "Pipeline comercial" : "Pipeline de garantía"
        }
      >
        {stages.map((stage) => {
          const rows = filtered
            .filter((a) => a[field] === stage)
            .sort(
              (a, b) =>
                compareScheduledFollowUp(a, b, now) ||
                (order === "created_at"
                  ? (b.requested_date || b.created_at).slice(0, 10)
                  : b.updated_at
                ).localeCompare(
                  order === "created_at"
                    ? (a.requested_date || a.created_at).slice(0, 10)
                    : a.updated_at,
                ) ||
                b.created_at.localeCompare(a.created_at) ||
                a.id.localeCompare(b.id),
            );
          return (
            <section
              key={stage}
              aria-label={`Etapa ${human(stage)}`}
              className={`pipeline-column ${over === stage ? "drag-over" : ""}`}
              onDragOver={(e) => {
                if (!busy && !moving.current) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setOver(stage);
                }
              }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                change(e.dataTransfer.getData("text/plain"), stage);
              }}
            >
              <div className={`column-heading ${stage}`}>
                <span />
                <h2>{human(stage)}</h2>
                <b>{rows.length}</b>
              </div>
              <div className="pipeline-cards">
                {rows.map((a) => (
                  <article
                    className="pipeline-card"
                    key={a.id}
                    draggable={
                      !busy &&
                      !pending &&
                      (kind === "commercial" ||
                        admin ||
                        !terminal(a.guarantee_stage))
                    }
                    onClick={(e) => {
                      if (
                        !(e.target as HTMLElement).closest(
                          "button,select,label",
                        )
                      )
                        open(a.id);
                    }}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", a.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => setOver(null)}
                    aria-label={`Solicitud ${a.full_name}`}
                    aria-busy={pending?.id === a.id}
                  >
                    <div className="pipeline-card-top">
                      <span className="guarantee-tag">
                        {human(a.guarantee_type)}
                      </span>
                      <GripVertical size={16} aria-hidden="true" />
                    </div>
                    {pending?.id === a.id && (
                      <small role="status">Guardando…</small>
                    )}
                    <button
                      className="pipeline-client"
                      onClick={() => open(a.id)}
                    >
                      {a.full_name}
                    </button>
                    <small aria-label="Cédula">{formatCI(a.national_id)}</small>
                    <small aria-label="Fecha de ingreso">
                      Ingreso: {dateOnly(a.requested_date || a.created_at)}
                    </small>
                    <small>
                      Última actualización: {dateOnly(a.updated_at)}
                    </small>
                    {a.issued_date && (
                      <span className="badge aprobada">
                        Emitida · {a.issued_date}
                      </span>
                    )}
                    <FollowUp app={a} notes={store.notes} now={now} />
                    <div className="pipeline-source">
                      {sourceName(a, store.sources)}
                    </div>
                    <strong className="pipeline-rent">
                      {a.rent_amount === null
                        ? "Alquiler sin informar"
                        : `${a.rent_currency || "Moneda sin informar"} ${a.rent_amount.toLocaleString("es-UY")}`}
                    </strong>
                    <div className="pipeline-owner">
                      Usuario:{" "}
                      {store.profiles.find((p) => p.id === a.assigned_user_id)
                        ?.full_name || "Sin asignar"}
                    </div>
                    <button
                      className="secondary add-comment"
                      disabled={busy}
                      onClick={() => comment(a.id)}
                    >
                      <Plus size={15} /> Agregar comentario
                    </button>
                  </article>
                ))}
                {!rows.length && (
                  <p className="column-empty">Sin solicitudes en esta etapa</p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
