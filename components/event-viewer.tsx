"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
type Event = {
  event_id: string;
  step: number;
  sent_at: string;
  received_at: string;
  payload: unknown;
  discrepancy: boolean;
  out_of_order: boolean;
};
export default function EventViewer({
  applicationId,
}: {
  applicationId: string;
}) {
  const [events, setEvents] = useState<Event[]>([]),
    [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    if (supabase)
      supabase
        .from("form_events")
        .select(
          "event_id,step,sent_at,received_at,payload,discrepancy,out_of_order",
        )
        .eq("application_id", applicationId)
        .order("received_at")
        .then(({ data, error }) => {
          if (active) {
            setEvents(data || []);
            if (error) setMessage("No se pudieron consultar los eventos.");
          }
        });
    return () => {
      active = false;
    };
  }, [applicationId]);
  return (
    <section className="card padded">
      <h2>Eventos originales · Acceso restringido</h2>
      <p className="muted">
        Los valores recibidos se conservan separados de las correcciones del
        caso.
      </p>
      {message && <p role="alert">{message}</p>}
      {events.length === 0 && (
        <p className="muted">
          No hay eventos de formulario registrados para esta solicitud.
        </p>
      )}
      {events.map((e) => (
        <details className="timeline" key={e.event_id}>
          <summary>
            Parte {e.step}
            {e.discrepancy ? " · Discrepancia para revisión" : ""}
            {e.out_of_order ? " · Recibida fuera de orden" : ""}
          </summary>
          <small>{e.received_at}</small>
          <pre>{JSON.stringify(e.payload, null, 2)}</pre>
        </details>
      ))}
    </section>
  );
}
