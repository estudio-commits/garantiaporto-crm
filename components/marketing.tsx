import type { Application } from "@/lib/domain";
import EventViewer from "./event-viewer";
const names: Record<string, string> = {
  utm_source: "UTM · Fuente",
  utm_medium: "UTM · Medio",
  utm_campaign: "UTM · Campaña",
  utm_content: "UTM · Contenido",
  utm_term: "UTM · Término",
  button_origin: "Botón de registro",
  button_id: "ID del botón",
  source_url: "URL de registro",
  landing_page: "Página de llegada",
  referrer: "Página de referencia",
  form_id: "Formulario",
  gclid: "Google Click ID",
  gbraid: "Google GBRAID",
  wbraid: "Google WBRAID",
  fbclid: "Meta Click ID",
  consent_evidence: "Evidencia de consentimiento",
};
export default function Marketing({
  app,
  admin,
}: {
  app: Application;
  admin: boolean;
}) {
  const entries = Object.entries(app.attribution || {}).filter(
    ([k, v]) => k in names && v != null && v !== "",
  );
  return (
    <section className="card padded marketing-panel">
      <h2>Origen y atribución de marketing</h2>
      <p className="muted">
        Datos recibidos del formulario. Se conserva el primer valor informado de
        cada campo; los envíos posteriores quedan en los eventos originales.
      </p>
      {entries.length ? (
        <dl className="marketing-values">
          {entries.map(([k, v]) => (
            <div key={k}>
              <dt>{names[k]}</dt>
              <dd>{String(v)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p>No hay datos de marketing registrados para este cliente.</p>
      )}
      {admin && <EventViewer applicationId={app.id} />}
    </section>
  );
}
