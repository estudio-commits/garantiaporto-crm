"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bot,
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  FolderOpen,
  Globe,
  MessageCircle,
  RefreshCw,
} from "lucide-react";
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
type Attempt = { status: string; code: string | null; created_at: string };
type Health = "ok" | "warn" | "off";
type Status = { health: Health; headline: string; detail: string };

const WEEK = 7 * 24 * 3600 * 1000;
/** 59899123456 → 099 123 456 (Uruguayan mobiles); other numbers stay as stored. */
export function localNumber(n: string) {
  const m = /^598(9\d)(\d{3})(\d{3})$/.exec(n);
  return m ? `0${m[1]} ${m[2]} ${m[3]}` : `+${n}`;
}
const joinNumbers = (l: string[]) => l.map(localNumber).join(", ");

export function ago(iso: string, now = Date.now()) {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (m < 1) return "recién";
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "hace 1 día" : `hace ${d} días`;
}
const when = (s: string) =>
  new Intl.DateTimeFormat("es-UY", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Montevideo",
  }).format(new Date(s));

/** Accessible on/off switch. The label says what the option does; the state text says what is happening now. */
function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`int-switch ${checked ? "on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="int-knob" />
    </button>
  );
}

function Option({
  title,
  description,
  checked,
  onChange,
  on,
  off,
  children,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  on: string;
  off: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="int-option">
      <div className="int-option-head">
        <div>
          <strong>{title}</strong>
          <p>{description}</p>
          <span className={`int-state ${checked ? "on" : ""}`}>
            {checked ? `Activado: ${on}` : `Desactivado: ${off}`}
          </span>
        </div>
        <Switch checked={checked} onChange={onChange} label={title} />
      </div>
      {checked && children && <div className="int-option-body">{children}</div>}
    </div>
  );
}

function StatusCard({
  icon: Icon,
  title,
  status,
}: {
  icon: typeof Globe;
  title: string;
  status: Status | null;
}) {
  const S = !status
    ? CircleDashed
    : status.health === "ok"
      ? CheckCircle2
      : status.health === "warn"
        ? CircleAlert
        : CircleDashed;
  return (
    <article
      className={`int-status ${status?.health ?? "loading"}`}
      aria-label={title}
    >
      <div className="int-status-title">
        <Icon size={18} />
        {title}
      </div>
      <div className="int-status-line">
        <S size={16} />
        <strong>{status?.headline ?? "Consultando…"}</strong>
      </div>
      {status?.detail && <small>{status.detail}</small>}
    </article>
  );
}

export default function Integrations({ demo }: { demo: boolean }) {
  const [saved, setSaved] = useState<Settings | null>(null),
    [s, setS] = useState<Settings | null>(null),
    [numbers, setNumbers] = useState(""),
    [attempts, setAttempts] = useState<Attempt[] | null>(null),
    [lastWebhook, setLastWebhook] = useState<string | null | undefined>(
      undefined,
    ),
    [folders, setFolders] = useState<
      { status: string; created_at: string; error: string | null }[] | null
    >(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    const [st, at, wh, fq] = await Promise.all([
      supabase.from("wa_settings").select("*").eq("id", 1).single(),
      supabase
        .from("integration_attempts")
        .select("status,code,created_at")
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("wa_webhook_events")
        .select("received_at")
        .order("received_at", { ascending: false })
        .limit(1),
      supabase
        .from("drive_folder_queue")
        .select("status,created_at,error")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    if (st.data) {
      setSaved(st.data as Settings);
      setS(st.data as Settings);
      setNumbers(joinNumbers((st.data as Settings).bot_test_numbers));
    } else if (st.error) setMessage(st.error.message);
    setAttempts((at.data as Attempt[]) ?? []);
    setLastWebhook((wh.data?.[0]?.received_at as string | undefined) ?? null);
    setFolders(
      (fq.data as {
        status: string;
        created_at: string;
        error: string | null;
      }[]) ?? [],
    );
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const now = Date.now();
  const web: Status | null = useMemo(() => {
    if (demo)
      return {
        health: "off",
        headline: "Demostración",
        detail: "La demo no recibe formularios reales.",
      };
    if (!attempts) return null;
    const ok = attempts.find((a) => a.status === "processed");
    const errors = attempts.filter(
      (a) => a.status !== "processed" && now - Date.parse(a.created_at) < WEEK,
    ).length;
    if (!ok)
      return {
        health: "off",
        headline: "Sin formularios recibidos",
        detail:
          "Todavía no llegó ninguna solicitud desde garantiaporto.com.uy.",
      };
    const recent = now - Date.parse(ok.created_at) < WEEK;
    return {
      health: errors ? "warn" : recent ? "ok" : "warn",
      headline: recent ? "Conectado" : "Sin solicitudes esta semana",
      detail: `Última solicitud recibida ${ago(ok.created_at, now)}${errors ? ` · ${errors} con error en 7 días` : ""}.`,
    };
  }, [attempts, demo, now]);
  const wa: Status | null = useMemo(() => {
    if (demo)
      return {
        health: "off",
        headline: "Demostración",
        detail: "Las conversaciones de la demo son ficticias.",
      };
    if (lastWebhook === undefined) return null;
    if (!lastWebhook)
      return {
        health: "off",
        headline: "Sin mensajes recibidos",
        detail: "Todavía no llegó ningún mensaje al número.",
      };
    const recent = now - Date.parse(lastWebhook) < WEEK;
    return {
      health: recent ? "ok" : "warn",
      headline: recent ? "Conectado" : "Sin mensajes esta semana",
      detail: `Último mensaje recibido ${ago(lastWebhook, now)}.`,
    };
  }, [lastWebhook, demo, now]);
  const drive: Status | null = useMemo(() => {
    if (demo)
      return {
        health: "off",
        headline: "Demostración",
        detail: "La demo no crea carpetas.",
      };
    if (!folders) return null;
    const done = folders.find((f) => f.status === "done");
    const failed = folders.filter(
      (f) => f.status === "failed" || (f.status === "pending" && f.error),
    ).length;
    if (failed)
      return {
        health: "warn",
        headline: `${failed} carpeta${failed > 1 ? "s" : ""} con error`,
        detail:
          "Revisá que la carpeta Solicitudes esté compartida con la cuenta del CRM.",
      };
    if (!done)
      return {
        health: "off",
        headline: "Sin carpetas creadas",
        detail: "Se crean automáticamente con cada solicitud nueva.",
      };
    return {
      health: "ok",
      headline: "Conectado",
      detail: `Última carpeta creada ${ago(done.created_at, now)}.`,
    };
  }, [folders, demo, now]);
  const bot: Status | null = useMemo(() => {
    if (demo)
      return {
        health: "off",
        headline: "Demostración",
        detail: "El asistente no responde en la demo.",
      };
    if (!saved) return null;
    if (!saved.bot_enabled)
      return {
        health: "off",
        headline: "Apagado",
        detail: "Los mensajes los responde el equipo.",
      };
    if (saved.bot_test_mode)
      return {
        health: "warn",
        headline: "Modo prueba",
        detail: `Responde solo a ${saved.bot_test_numbers.length} número${saved.bot_test_numbers.length === 1 ? "" : "s"} de prueba.`,
      };
    return {
      health: "ok",
      headline: "Respondiendo a clientes",
      detail: `Deriva a ${saved.handoff_name} cuando hace falta.`,
    };
  }, [saved, demo]);

  const dirty =
    !!s &&
    !!saved &&
    (JSON.stringify({ ...s, bot_test_numbers: [] }) !==
      JSON.stringify({ ...saved, bot_test_numbers: [] }) ||
      numbers !== joinNumbers(saved.bot_test_numbers));
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) =>
    s && setS({ ...s, [k]: v });

  async function save() {
    if (!s) return;
    const parsed = numbers
      .split(/[,;\n]/)
      .map((n) => n.trim())
      .filter(Boolean)
      .map((n) => whatsappNumber(n));
    if (parsed.some((n) => !n)) {
      setMessage(
        "Hay un número de prueba con formato inválido. Usá, por ejemplo, 099 123 456.",
      );
      return;
    }
    if (s.bot_enabled && s.bot_test_mode && !parsed.length) {
      setMessage(
        "Agregá al menos un número de prueba, o desactivá el modo prueba.",
      );
      return;
    }
    setBusy(true);
    setMessage("");
    const { error } = await supabase!
      .from("wa_settings")
      .update({
        auto_greeting: s.auto_greeting,
        auto_reply_enabled: s.auto_reply_enabled,
        auto_reply_text: s.auto_reply_text,
        bot_enabled: s.bot_enabled,
        bot_test_mode: s.bot_test_mode,
        bot_test_numbers: [...new Set(parsed as string[])],
        handoff_name: s.handoff_name,
        hours_start: s.hours_start,
        hours_end: s.hours_end,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);
    setBusy(false);
    if (error) setMessage(error.message);
    else {
      setMessage("Cambios guardados.");
      await load();
    }
  }

  return (
    <div className="int-page">
      <section className="card padded">
        <div className="int-section-head">
          <h2>Estado de las conexiones</h2>
          {!demo && (
            <button
              className="icon-button"
              aria-label="Actualizar estado"
              onClick={load}
            >
              <RefreshCw size={16} />
            </button>
          )}
        </div>
        <div className="int-status-grid">
          <StatusCard icon={Globe} title="Formulario web" status={web} />
          <StatusCard icon={MessageCircle} title="WhatsApp" status={wa} />
          <StatusCard icon={FolderOpen} title="Google Drive" status={drive} />
          <StatusCard icon={Bot} title="Asistente con IA" status={bot} />
        </div>
        {!demo && attempts && attempts.length > 0 && (
          <details className="int-details">
            <summary>
              Ver las últimas solicitudes recibidas desde la web
            </summary>
            <table className="int-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Resultado</th>
                </tr>
              </thead>
              <tbody>
                {attempts.slice(0, 15).map((a, i) => (
                  <tr key={i}>
                    <td>{when(a.created_at)}</td>
                    <td>
                      {a.status === "processed"
                        ? "Recibida"
                        : `Error${a.code ? ` (${a.code})` : ""}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
      </section>

      {demo ? (
        <section className="card padded">
          <h2>WhatsApp</h2>
          <p className="muted">
            La configuración de WhatsApp y del asistente requiere conectar
            Supabase. En la demo no se envían mensajes.
          </p>
        </section>
      ) : !s ? (
        <section className="card padded">
          <p className="muted">{message || "Cargando configuración…"}</p>
        </section>
      ) : (
        <>
          <section className="card padded">
            <h2>Mensajes automáticos de WhatsApp</h2>
            <Option
              title="Saludo al recibir una solicitud web"
              description={`Cuando entra una solicitud desde la web con consentimiento de WhatsApp, se envía la plantilla «${s.greeting_template}».`}
              checked={s.auto_greeting}
              onChange={(v) => set("auto_greeting", v)}
              on="el saludo sale solo."
              off="el saludo se envía a mano desde la ficha del cliente."
            />
            <Option
              title="Respuesta fija cuando no responde el asistente"
              description="Si alguien escribe por primera vez (o después de 12 h sin hablar) y el asistente no le responde, recibe este texto."
              checked={s.auto_reply_enabled}
              onChange={(v) => set("auto_reply_enabled", v)}
              on="se envía el texto de abajo."
              off="no se envía nada hasta que responda el equipo."
            >
              <textarea
                aria-label="Texto de la respuesta fija"
                value={s.auto_reply_text}
                maxLength={1000}
                rows={2}
                onChange={(e) => set("auto_reply_text", e.target.value)}
              />
            </Option>
          </section>

          <section className="card padded">
            <h2>Asistente con IA</h2>
            <Option
              title="Asistente"
              description={`Responde las preguntas frecuentes, envía la lista de documentos, carga los datos del cliente y deriva a ${s.handoff_name}.`}
              checked={s.bot_enabled}
              onChange={(v) => set("bot_enabled", v)}
              on="responde los mensajes de WhatsApp."
              off="todos los mensajes los responde el equipo."
            />
            {s.bot_enabled && (
              <Option
                title="Modo prueba"
                description="Mientras está activado, el asistente solo responde a los números de prueba. Los clientes reciben la respuesta fija (si está activada)."
                checked={s.bot_test_mode}
                onChange={(v) => set("bot_test_mode", v)}
                on="solo responde a los números de abajo."
                off="responde a todos los clientes."
              >
                <input
                  aria-label="Números de prueba"
                  value={numbers}
                  placeholder="099 123 456, 098 765 432"
                  onChange={(e) => setNumbers(e.target.value)}
                />
                <small>Separá los números con comas.</small>
              </Option>
            )}
            <div className="int-option">
              <div className="int-option-head">
                <div>
                  <strong>Atención humana</strong>
                  <p>
                    A quién deriva el asistente y en qué horario (lunes a
                    viernes). Fuera de horario avisa cuándo vuelve el equipo.
                  </p>
                </div>
              </div>
              <div className="int-inline">
                <span>
                  Persona
                  <input
                    aria-label="Persona que atiende"
                    value={s.handoff_name}
                    maxLength={100}
                    onChange={(e) => set("handoff_name", e.target.value)}
                  />
                </span>
                <span>
                  Desde
                  <input
                    aria-label="Atención desde"
                    type="time"
                    value={s.hours_start.slice(0, 5)}
                    onChange={(e) => set("hours_start", e.target.value)}
                  />
                </span>
                <span>
                  Hasta
                  <input
                    aria-label="Atención hasta"
                    type="time"
                    value={s.hours_end.slice(0, 5)}
                    onChange={(e) => set("hours_end", e.target.value)}
                  />
                </span>
              </div>
            </div>
          </section>

          {(dirty || message) && (
            <div className="int-savebar" role="status">
              <span>{message || "Tenés cambios sin guardar."}</span>
              {dirty && (
                <div>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => {
                      setS(saved);
                      setNumbers(
                        saved ? joinNumbers(saved.bot_test_numbers) : "",
                      );
                      setMessage("");
                    }}
                  >
                    Descartar
                  </button>
                  <button className="primary" disabled={busy} onClick={save}>
                    Guardar cambios
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
