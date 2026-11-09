"use client";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";
import { whatsappNumber } from "@/lib/phone";

type Settings = {
  auto_greeting: boolean;
  auto_reply_enabled: boolean;
  auto_reply_text: string;
  greeting_template: string;
  reopen_template: string;
  template_language: string;
  bot_enabled: boolean;
  bot_test_mode: boolean;
  bot_test_numbers: string[];
  handoff_name: string;
  hours_start: string;
  hours_end: string;
};

/** Admin-only WhatsApp switches. Writes go through RLS (wa_settings_admin). */
export default function WhatsAppSettings() {
  const [s, setS] = useState<Settings | null>(null),
    [numbers, setNumbers] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!supabase) return;
    supabase
      .from("wa_settings")
      .select("*")
      .eq("id", 1)
      .single()
      .then(({ data, error }) => {
        if (error) setMessage(error.message);
        else {
          setS(data as Settings);
          setNumbers((data as Settings).bot_test_numbers.join(", "));
        }
      });
  }, []);
  if (!supabase)
    return (
      <section className="card padded">
        <h2>WhatsApp</h2>
        <p className="muted">
          La configuración de WhatsApp y del asistente requiere conectar
          Supabase. En la demo no se envían mensajes.
        </p>
      </section>
    );
  if (!s)
    return (
      <section className="card padded">
        <h2>WhatsApp</h2>
        <p className="muted">{message || "Cargando…"}</p>
      </section>
    );
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) =>
    setS({ ...s, [k]: v });
  async function save(e: FormEvent) {
    e.preventDefault();
    const parsed = numbers
      .split(/[,;\n]/)
      .map((n) => n.trim())
      .filter(Boolean)
      .map((n) => whatsappNumber(n));
    if (parsed.some((n) => !n)) {
      setMessage("Hay un número de prueba con formato inválido.");
      return;
    }
    setBusy(true);
    setMessage("");
    const { error } = await supabase!
      .from("wa_settings")
      .update({
        auto_greeting: s!.auto_greeting,
        auto_reply_enabled: s!.auto_reply_enabled,
        auto_reply_text: s!.auto_reply_text,
        bot_enabled: s!.bot_enabled,
        bot_test_mode: s!.bot_test_mode,
        bot_test_numbers: [...new Set(parsed as string[])],
        handoff_name: s!.handoff_name,
        hours_start: s!.hours_start,
        hours_end: s!.hours_end,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);
    setBusy(false);
    setMessage(error ? error.message : "Configuración guardada.");
  }
  return (
    <section className="card padded wa-settings">
      <h2>WhatsApp</h2>
      <form onSubmit={save}>
        <fieldset>
          <legend>Mensajes automáticos</legend>
          <label className="check">
            <input
              type="checkbox"
              checked={s.auto_greeting}
              onChange={(e) => set("auto_greeting", e.target.checked)}
            />
            Enviar el saludo (<code>{s.greeting_template}</code>) a los casos
            web con consentimiento
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={s.auto_reply_enabled}
              onChange={(e) => set("auto_reply_enabled", e.target.checked)}
            />
            Respuesta automática fija cuando el asistente no responde
          </label>
          <label>
            Texto de la respuesta automática
            <textarea
              value={s.auto_reply_text}
              maxLength={1000}
              rows={2}
              onChange={(e) => set("auto_reply_text", e.target.value)}
            />
          </label>
        </fieldset>
        <fieldset>
          <legend>Asistente con IA</legend>
          <label className="check">
            <input
              type="checkbox"
              checked={s.bot_enabled}
              onChange={(e) => set("bot_enabled", e.target.checked)}
            />
            Asistente activado
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={s.bot_test_mode}
              onChange={(e) => set("bot_test_mode", e.target.checked)}
            />
            Modo prueba: responder solo a los números de abajo
          </label>
          <label>
            Números de prueba (separados por coma)
            <input
              value={numbers}
              placeholder="099 123 456, 098 765 432"
              onChange={(e) => setNumbers(e.target.value)}
            />
          </label>
          <label>
            Persona que atiende las derivaciones
            <input
              value={s.handoff_name}
              maxLength={100}
              onChange={(e) => set("handoff_name", e.target.value)}
            />
          </label>
          <div className="form-grid">
            <label>
              Atención desde
              <input
                type="time"
                value={s.hours_start.slice(0, 5)}
                onChange={(e) => set("hours_start", e.target.value)}
              />
            </label>
            <label>
              hasta
              <input
                type="time"
                value={s.hours_end.slice(0, 5)}
                onChange={(e) => set("hours_end", e.target.value)}
              />
            </label>
          </div>
          <p className="muted">
            Días de atención: lunes a viernes. El asistente responde siempre;
            fuera de horario avisa cuándo vuelve el equipo.
          </p>
        </fieldset>
        {message && <p role="status">{message}</p>}
        <button className="primary" disabled={busy}>
          Guardar configuración
        </button>
      </form>
    </section>
  );
}
