"use client";
import { useState } from "react";
import type { Application, Store } from "@/lib/domain";
import { human, states } from "@/lib/domain";
import { groupedStats, summarize, rejectionStages } from "@/lib/analytics";
import { sourceName } from "@/lib/sources";
import { rejectionReasons, uyDay } from "@/lib/workflow";
const percent = (n: number | null) =>
  n === null ? "Sin datos" : `${Math.round(n * 100)}%`;
export default function Statistics({
  applications,
  store,
  admin,
  now,
}: {
  applications: Application[];
  store: Store;
  admin: boolean;
  now: number;
}) {
  const [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const invalid = Boolean(from && to && from > to);
  const apps = invalid
    ? []
    : applications.filter(
        (a) =>
          (!from || uyDay(a.created_at) >= from) &&
          (!to || uyDay(a.created_at) <= to),
      );
  const summary = summarize(apps, store.notes, now);
  const dates = (s: string) =>
    (!from || uyDay(s) >= from) && (!to || uyDay(s) <= to);
  const team = store.profiles.map((p) => ({
    p,
    ...summarize(
      apps.filter((a) => a.assigned_user_id === p.id),
      store.notes,
      now,
    ),
    comments: store.notes.filter(
      (n) =>
        n.author_id === p.id &&
        dates(n.created_at) &&
        applications.some((a) => a.id === n.application_id),
    ).length,
  }));
  return (
    <div className="statistics">
      <section className="card padded">
        <div className="form-grid">
          <label>
            Ingreso desde
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            Ingreso hasta
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </div>
        {invalid && (
          <p role="alert">
            La fecha inicial debe ser anterior o igual a la final.
          </p>
        )}
        <p className="muted">
          Por fecha de ingreso, incluidos archivados. Resultados actuales de{" "}
          {apps.length} solicitudes
          {admin ? " del equipo" : " asignadas a vos"}. Fechas de Uruguay.
        </p>
      </section>
      <div className="stats">
        {[
          ["Solicitudes", summary.total],
          ["Aprobadas", summary.approved],
          ["Rechazadas", summary.rejected],
          ["Con seguimiento pendiente", summary.overdue],
        ].map(([label, n]) => (
          <div className="stat" key={label}>
            <span>{label}</span>
            <strong>{n}</strong>
          </div>
        ))}
      </div>
      <section className="card padded">
        <h2>Origen de las mejores oportunidades</h2>
        <p className="muted">
          Aprobación = aprobadas / decisiones. Conversión = aprobadas /
          solicitudes. Los casos abiertos todavía pueden cambiar el resultado.
          Compará también el volumen de cada grupo.
        </p>
        <GroupTable
          title="Por origen"
          rows={groupedStats(
            apps,
            (a) => sourceName(a, store.sources),
            store.notes,
            now,
          )}
        />
        <GroupTable
          title="Por campaña y fuente UTM"
          rows={groupedStats(
            apps,
            (a) =>
              `${a.attribution?.utm_source || "Sin UTM"} · ${a.attribution?.utm_campaign || "Sin campaña"}`,
            store.notes,
            now,
          )}
        />
        <GroupTable
          title="Por tipo de garantía"
          rows={groupedStats(
            apps,
            (a) => human(a.guarantee_type),
            store.notes,
            now,
          )}
        />
        <p className="muted">
          Para decidir inversión, cruzá conversión y volumen con el gasto de
          cada campaña. Costo por lead, costo por aprobación y rentabilidad
          quedan pendientes de incorporar inversión e ingresos reales; no se
          estiman a partir del alquiler.
        </p>
      </section>
      <section className="card padded">
        <h2>Dónde se detiene la gestión</h2>
        <p className="muted">
          Distribución actual, no un embudo de pasos completados: una solicitud
          puede saltar etapas.
        </p>
        <div className="stage-metrics">
          {states.guarantee_stage.map((stage) => {
            const n = apps.filter((a) => a.guarantee_stage === stage).length;
            return (
              <div className="metric-row" key={stage}>
                <span>{human(stage)}</span>
                <strong>{n}</strong>
                <div className="metric-track">
                  <span
                    style={{
                      width: `${apps.length ? (n / apps.length) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <p>
          {
            apps.filter(
              (a) =>
                a.stage === "finalizado" &&
                !["aprobada", "rechazada"].includes(a.guarantee_stage || ""),
            ).length
          }{" "}
          cierres comerciales sin decisión formal. No equivalen automáticamente
          a clientes perdidos.
        </p>
        <h3>Etapa previa al rechazo</h3>
        <p className="muted">
          Última etapa registrada antes de cada rechazo actual; las solicitudes
          sin esa trazabilidad se muestran por separado.
        </p>
        {rejectionStages(apps, store.audits).length ? (
          <div className="stage-metrics">
            {rejectionStages(apps, store.audits).map((r) => (
              <div className="metric-row" key={r.stage}>
                <span>{human(r.stage)}</span>
                <strong>{r.count}</strong>
              </div>
            ))}
          </div>
        ) : (
          <p>No hay rechazos en este período.</p>
        )}
        {admin && (
          <>
            <h3>Motivos de rechazo</h3>
            <div className="stage-metrics">
              {[...rejectionReasons, "sin_informar"].map((reason) => (
                <div className="metric-row" key={reason}>
                  <span>{human(reason)}</span>
                  <strong>
                    {
                      apps.filter(
                        (a) =>
                          a.guarantee_stage === "rechazada" &&
                          (store.sensitive.find(
                            (s) => s.application_id === a.id,
                          )?.rejection_reason || "sin_informar") === reason,
                      ).length
                    }
                  </strong>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
      <section className="card padded">
        <h2>Rendimiento de gestión</h2>
        <p className="muted">
          Cartera agrupada por responsable actual. Los comentarios se atribuyen
          a su autor y se cuentan por su propia fecha en el período elegido,
          aunque el cliente haya cambiado de vendedor. Tiempo de respuesta:
          mediana entre ingreso y primera nota de tipo Comunicación registrada;
          no mide mensajes externos que aún no estén integrados.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Responsable</th>
                <th>Cartera</th>
                <th>Aprobadas / decisiones</th>
                <th>Seguimientos pendientes</th>
                <th>Comentarios en período</th>
                <th>Primera comunicación</th>
              </tr>
            </thead>
            <tbody>
              {team.map((r) => (
                <tr key={r.p.id}>
                  <td>{r.p.full_name}</td>
                  <td>{r.total}</td>
                  <td>
                    {r.approved} / {r.approved + r.rejected}
                  </td>
                  <td>{r.overdue}</td>
                  <td>{r.comments}</td>
                  <td>
                    {r.medianResponse === null
                      ? "Sin comunicaciones"
                      : `${r.medianResponse.toFixed(1)} h · ${r.responseSample} casos`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted">
          Sin responsable: {apps.filter((a) => !a.assigned_user_id).length}{" "}
          solicitudes. La calidad y antigüedad de la cartera afectan la tasa de
          cada vendedor; no es un ranking de productividad por sí sola.
        </p>
      </section>
    </div>
  );
}
function GroupTable({
  title,
  rows,
}: {
  title: string;
  rows: ReturnType<typeof groupedStats>;
}) {
  return (
    <>
      <h3>{title}</h3>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Grupo</th>
              <th>Solicitudes</th>
              <th>Pendientes</th>
              <th>Aprobadas</th>
              <th>Rechazadas</th>
              <th>Aprobación</th>
              <th>Conversión</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td>{r.label}</td>
                <td>{r.total}</td>
                <td>{r.pending}</td>
                <td>{r.approved}</td>
                <td>{r.rejected}</td>
                <td>
                  {percent(r.approvalRate)}{" "}
                  <small>
                    {r.approved} / {r.approved + r.rejected}
                  </small>
                </td>
                <td>
                  {percent(r.conversion)}{" "}
                  <small>
                    {r.approved} / {r.total}
                  </small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p>No hay solicitudes para este período.</p>}
      </div>
    </>
  );
}
