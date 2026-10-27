import type { Application, ClientSource } from "@/lib/domain";
import { human } from "@/lib/domain";
import { approvalGroups, sourceName } from "@/lib/sources";
export default function ApprovalMetrics({
  applications,
  sources,
}: {
  applications: Application[];
  sources: ClientSource[];
}) {
  return (
    <section className="approval-section">
      <div className="overview-line">
        <h2>Aprobaciones formales</h2>
        <span>Solicitudes activas · Todo el período</span>
      </div>
      <p className="muted">
        Tasa = aprobadas ÷ (aprobadas + rechazadas). Los casos sin decisión y la
        preaprobación interna no cuentan como aprobaciones.
      </p>
      <div className="approval-grid">
        {[
          {
            title: "Por origen",
            groups: approvalGroups(applications, (a) => sourceName(a, sources)),
          },
          {
            title: "Por tipo de garantía",
            groups: approvalGroups(applications, (a) =>
              human(a.guarantee_type),
            ),
          },
        ].map(({ title, groups }) => (
          <div className="card padded" key={title}>
            <h3>{title}</h3>
            {groups.length === 0 && (
              <p className="muted">Todavía no hay solicitudes.</p>
            )}
            {groups.map((g) => (
              <div className="metric-row" key={g.label}>
                <div>
                  <strong>{g.label}</strong>
                  <small>
                    {g.approved} aprobadas / {g.decided} decisiones · {g.total}{" "}
                    solicitudes
                  </small>
                </div>
                <b>
                  {g.rate === null
                    ? "Sin decisiones"
                    : `${Math.round(g.rate * 100)}%`}
                </b>
                <div className="metric-track">
                  <span style={{ width: `${(g.rate || 0) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
