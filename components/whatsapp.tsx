"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Bell,
  Check,
  CheckCheck,
  CircleAlert,
  ExternalLink,
  MessageCircle,
  RefreshCw,
  Search,
  Send,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { waDemoSeed } from "@/lib/demo";
import type { Application, Profile } from "@/lib/domain";
import { whatsappNumber } from "@/lib/phone";
import {
  dayLabel,
  initials,
  listTime,
  safeDriveUrl,
  sameDay,
  sortInbox,
  windowClosesAt,
  windowOpen,
  type WaConversation,
  type WaMessage,
} from "@/lib/whatsapp";

const DEMO_KEY = "porto-demo-whatsapp-v1";
type DemoData = ReturnType<typeof waDemoSeed>;
type SendAction = "text" | "greeting" | "reopen";

function demoLoad(): DemoData {
  try {
    const saved = localStorage.getItem(DEMO_KEY);
    if (saved) return JSON.parse(saved) as DemoData;
  } catch {
    /* corrupt demo storage: reseed */
  }
  const fresh = waDemoSeed();
  localStorage.setItem(DEMO_KEY, JSON.stringify(fresh));
  return fresh;
}
const demoSave = (d: DemoData) =>
  localStorage.setItem(DEMO_KEY, JSON.stringify(d));

async function listConversations(demo: boolean): Promise<WaConversation[]> {
  if (demo) return demoLoad().conversations;
  const r = await supabase!
    .from("wa_conversations")
    .select("*")
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(300);
  if (r.error) throw Error(r.error.message);
  return (r.data ?? []) as WaConversation[];
}

async function listMessages(
  demo: boolean,
  applicationId: string,
): Promise<WaMessage[]> {
  if (demo)
    return demoLoad().messages.filter(
      (m) => m.application_id === applicationId,
    );
  const r = await supabase!
    .from("wa_messages")
    .select("*")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: true })
    .limit(500);
  if (r.error) throw Error(r.error.message);
  return (r.data ?? []) as WaMessage[];
}

async function recentMessages(demo: boolean): Promise<WaMessage[]> {
  if (demo) return demoLoad().messages;
  const r = await supabase!
    .from("wa_messages")
    .select(
      "id,conversation_id,application_id,direction,author,kind,body,status,created_at",
    )
    .order("created_at", { ascending: false })
    .limit(400);
  if (r.error) throw Error(r.error.message);
  return (r.data ?? []) as WaMessage[];
}

async function markRead(demo: boolean, c: WaConversation) {
  if (!c.unread_count) return;
  if (demo) {
    const d = demoLoad();
    d.conversations = d.conversations.map((x) =>
      x.id === c.id ? { ...x, unread_count: 0 } : x,
    );
    demoSave(d);
    return;
  }
  await supabase!.rpc("wa_mark_read", { p_conversation: c.id });
}

async function sendMessage(
  demo: boolean,
  app: Application,
  profile: Profile,
  action: SendAction,
  body: string,
  consent: boolean,
) {
  if (demo) {
    const d = demoLoad();
    const now = new Date().toISOString();
    let c = d.conversations.find((x) => x.application_id === app.id);
    if (!c) {
      c = {
        id: crypto.randomUUID(),
        wa_id: whatsappNumber(app.phone) ?? "59899000000",
        application_id: app.id,
        profile_name: null,
        last_inbound_at: null,
        last_message_at: now,
        unread_count: 0,
        needs_human: false,
        bot_paused: false,
        created_at: now,
      };
      d.conversations.push(c);
    }
    if (action === "text" && !windowOpen(c.last_inbound_at))
      throw Error(
        "Pasaron más de 24 h desde el último mensaje del cliente. Enviá la plantilla para retomar la conversación.",
      );
    d.messages.push({
      id: crypto.randomUUID(),
      conversation_id: c.id,
      application_id: app.id,
      wamid: null,
      direction: "out",
      author: "human",
      author_id: profile.id,
      kind: action === "text" ? "text" : "template",
      body:
        action === "text"
          ? body
          : `Plantilla: ${action === "greeting" ? "saludo_solicitud" : "retomar_conversacion"}`,
      media: null,
      status: "sent",
      error: null,
      created_at: now,
      status_at: null,
    });
    d.conversations = d.conversations.map((x) =>
      x.id === c!.id ? { ...x, last_message_at: now, unread_count: 0 } : x,
    );
    demoSave(d);
    return;
  }
  const {
    data: { session },
  } = await supabase!.auth.getSession();
  const r = await fetch("/api/whatsapp/send", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session?.access_token}`,
    },
    body: JSON.stringify({
      application_id: app.id,
      action,
      ...(action === "text" ? { body } : {}),
      ...(consent ? { consent: true } : {}),
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(data.error || "No se pudo enviar el mensaje.");
}

const time = (s: string) =>
  new Intl.DateTimeFormat("es-UY", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Montevideo",
  }).format(new Date(s));

const statusLabel: Record<WaMessage["status"], string> = {
  received: "",
  sent: "Enviado",
  delivered: "Entregado",
  read: "Leído",
  failed: "No enviado",
};
const authorLabel = (m: WaMessage) =>
  m.author === "customer"
    ? "Cliente"
    : m.author === "human"
      ? "Equipo"
      : m.author === "bot"
        ? "Asistente"
        : "Automático";

const hour = (s: string) =>
  new Intl.DateTimeFormat("es-UY", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Montevideo",
  }).format(new Date(s));

function Ticks({ status }: { status: WaMessage["status"] }) {
  if (status === "failed")
    return <CircleAlert size={14} className="wa-tick failed" />;
  if (status === "sent") return <Check size={14} className="wa-tick" />;
  if (status === "delivered")
    return <CheckCheck size={14} className="wa-tick" />;
  if (status === "read")
    return <CheckCheck size={14} className="wa-tick read" />;
  return null;
}

export function WhatsAppPanel({
  app,
  profile,
  demo,
  embedded = false,
  onChange,
  onConsent,
}: {
  app: Application;
  profile: Profile;
  demo: boolean;
  /** Rendered inside the inbox, which shows its own header with the client's name. */
  embedded?: boolean;
  /** Called after messages are read or sent, so the inbox list can refresh. */
  onChange?: () => void;
  /** Stores the consent ticked here on the case, so the client file reflects it. */
  onConsent?: () => void;
}) {
  const [messages, setMessages] = useState<WaMessage[]>([]),
    [conversation, setConversation] = useState<WaConversation | null>(null),
    [text, setText] = useState(""),
    [consent, setConsent] = useState(false),
    // Consent ticked here is stored on the case by the server, so it is asked only once.
    [savedConsent, setSavedConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [now, setNow] = useState(Date.now());
  const endRef = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => {
    try {
      const [convs, msgs] = await Promise.all([
        listConversations(demo),
        listMessages(demo, app.id),
      ]);
      const c = convs.find((x) => x.application_id === app.id) ?? null;
      setConversation(c);
      setMessages(msgs);
      setNow(Date.now());
      if (c?.unread_count) {
        await markRead(demo, c);
        onChange?.();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar WhatsApp.");
    }
  }, [demo, app.id, onChange]);
  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages.length]);

  const open = windowOpen(conversation?.last_inbound_at, now);
  const closes = windowClosesAt(conversation?.last_inbound_at);
  // Demo phones are fictitious placeholders; real mode requires a WhatsApp-capable number.
  const valid = demo || !!whatsappNumber(app.phone);
  const greeted = messages.some(
    (m) => m.direction === "out" && m.kind === "template",
  );
  const hasConsent =
    !!app.wa_consent ||
    !!String(app.attribution?.consent_evidence ?? "").trim() ||
    !!conversation?.last_inbound_at ||
    savedConsent;

  async function send(action: SendAction) {
    setBusy(true);
    setError("");
    try {
      await sendMessage(demo, app, profile, action, text.trim(), consent);
      if (action === "text") setText("");
      if (consent) {
        setSavedConsent(true);
        onConsent?.();
      }
      setConsent(false);
      await load();
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo enviar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className={embedded ? "wa-panel embedded" : "card padded wa-panel"}
      aria-label="Conversación de WhatsApp"
    >
      <div className="wa-head">
        {!embedded && (
          <h2>
            <MessageCircle size={18} /> WhatsApp
          </h2>
        )}
        <span className={open ? "wa-window open" : "wa-window"}>
          {open && closes
            ? `Ventana abierta hasta ${time(closes.toISOString())}`
            : conversation?.last_inbound_at
              ? "Ventana cerrada: solo plantilla"
              : "Sin mensajes del cliente"}
        </span>
        <button
          className="icon-button"
          aria-label="Actualizar conversación"
          onClick={load}
        >
          <RefreshCw size={16} />
        </button>
      </div>
      {conversation && (
        <BotStatus conversation={conversation} demo={demo} changed={load} />
      )}
      {!valid && (
        <p className="alert" role="alert">
          El celular del caso no tiene un formato válido para WhatsApp.
          Corregilo en la ficha para poder escribirle.
        </p>
      )}
      <div className="wa-thread" role="log" aria-label="Mensajes">
        {messages.length === 0 && (
          <p className="wa-empty">Todavía no hay mensajes con este cliente.</p>
        )}
        {messages.map((m, i) => (
          <div key={m.id} className="wa-row">
            {(i === 0 ||
              !sameDay(messages[i - 1]!.created_at, m.created_at)) && (
              <div className="wa-day">
                <span>{dayLabel(m.created_at, now)}</span>
              </div>
            )}
            <article
              className={`wa-bubble ${m.direction} ${m.status === "failed" ? "failed" : ""}`}
              aria-label={`${authorLabel(m)}: ${m.body}`}
            >
              {m.direction === "out" && (
                <small className={`wa-author ${m.author}`}>
                  {authorLabel(m)}
                </small>
              )}
              <p>
                {m.media ? "📎 " : ""}
                {m.body || (m.media ? "Archivo adjunto" : "")}
              </p>
              {m.media_status && (
                <MediaState message={m} demo={demo} retried={load} />
              )}
              <small className="wa-status" title={time(m.created_at)}>
                {hour(m.created_at)}
                {m.direction === "out" && (
                  <>
                    <Ticks status={m.status} />
                    <span className="sr-only wa-status-text">
                      {statusLabel[m.status]}
                    </span>
                  </>
                )}
              </small>
              {m.direction === "out" && m.error && (
                <small className="wa-error">{m.error}</small>
              )}
            </article>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {open ? (
        <form
          className="wa-compose"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) send("text");
          }}
        >
          <textarea
            aria-label="Mensaje de WhatsApp"
            value={text}
            maxLength={4096}
            rows={2}
            placeholder="Escribí tu respuesta…"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (text.trim()) send("text");
              }
            }}
          />
          <button className="primary" disabled={busy || !text.trim() || !valid}>
            <Send size={16} /> Enviar
          </button>
        </form>
      ) : (
        <div className="wa-template">
          <p className="muted">
            WhatsApp solo permite escribir libremente dentro de las 24 h
            posteriores al último mensaje del cliente. Fuera de ese plazo hay
            que enviar una plantilla aprobada.
          </p>
          {!hasConsent && (
            <label className="check">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              El cliente aceptó que lo contactemos por WhatsApp. Queda guardado
              en la ficha y no se vuelve a pedir.
            </label>
          )}
          <button
            className="secondary"
            disabled={busy || !valid || (!hasConsent && !consent)}
            onClick={() => send(greeted ? "reopen" : "greeting")}
          >
            <Send size={16} />
            {greeted
              ? "Enviar plantilla para retomar"
              : "Enviar saludo inicial"}
          </button>
        </div>
      )}
    </section>
  );
}

/** Polls the visible conversations; drives the menu badge, tab title and optional notifications. */
export function useWhatsAppUnread(demo: boolean, active: boolean) {
  const [unread, setUnread] = useState(0);
  const previous = useRef(0);
  useEffect(() => {
    if (!active) return;
    let stop = false;
    const tick = async () => {
      try {
        const convs = await listConversations(demo);
        if (stop) return;
        const total = convs.reduce((s, c) => s + (c.unread_count || 0), 0);
        if (
          total > previous.current &&
          typeof Notification !== "undefined" &&
          Notification.permission === "granted" &&
          document.visibilityState !== "visible"
        )
          new Notification("Nuevo mensaje de WhatsApp", {
            body: "Tenés mensajes sin leer en el CRM.",
            tag: "porto-whatsapp",
          });
        previous.current = total;
        setUnread(total);
      } catch {
        /* keep last value; the inbox shows the error */
      }
    };
    tick();
    const t = setInterval(tick, 15000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [demo, active]);
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\) /, "");
    document.title = unread ? `(${unread}) ${base}` : base;
  }, [unread]);
  return unread;
}

type InboxFilter = "todas" | "no_leidas" | "atencion";

export function WhatsAppInbox({
  applications,
  profile,
  demo,
  open,
  onConsent,
}: {
  applications: Application[];
  profile: Profile;
  demo: boolean;
  /** Opens the client's full case file. */
  open: (applicationId: string) => void;
  onConsent?: (applicationId: string) => void;
}) {
  const [convs, setConvs] = useState<WaConversation[]>([]),
    [last, setLast] = useState<Map<string, WaMessage>>(new Map()),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState<InboxFilter>("todas"),
    [now, setNow] = useState(Date.now()),
    [permission, setPermission] = useState<string>(
      typeof Notification === "undefined"
        ? "unsupported"
        : Notification.permission,
    );
  const byId = useMemo(
    () => new Map(applications.map((a) => [a.id, a])),
    [applications],
  );
  const load = useCallback(async () => {
    try {
      const [c, recent] = await Promise.all([
        listConversations(demo),
        recentMessages(demo),
      ]);
      const map = new Map<string, WaMessage>();
      for (const m of recent) {
        const prev = map.get(m.conversation_id);
        if (!prev || prev.created_at < m.created_at)
          map.set(m.conversation_id, m);
      }
      setConvs(c);
      setLast(map);
      setNow(Date.now());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar WhatsApp.");
    }
  }, [demo]);
  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  const visible = convs.filter(
    (c) => c.application_id && byId.has(c.application_id),
  );
  const unreadCount = visible.filter((c) => c.unread_count > 0).length;
  const attentionCount = visible.filter((c) => c.needs_human).length;
  const q = query.trim().toLowerCase();
  const digits = q.replace(/\D/g, "");
  const rows = sortInbox(
    visible.filter((c) => {
      if (filter === "no_leidas" && !c.unread_count) return false;
      if (filter === "atencion" && !c.needs_human) return false;
      if (!q) return true;
      const a = byId.get(c.application_id!)!;
      return (
        a.full_name.toLowerCase().includes(q) ||
        (digits.length >= 3 &&
          (c.wa_id.includes(digits) ||
            a.phone.replace(/\D/g, "").includes(digits)))
      );
    }),
  );
  const current = convs.find((c) => c.application_id === selected);
  const app = selected ? byId.get(selected) : undefined;

  function choose(c: WaConversation) {
    setSelected(c.application_id);
    // Clear the badge at once; the chat marks the conversation read on the server.
    setConvs((l) =>
      l.map((x) => (x.id === c.id ? { ...x, unread_count: 0 } : x)),
    );
  }

  return (
    <section
      className={`card wa-app ${app ? "has-chat" : ""}`}
      aria-label="Bandeja de WhatsApp"
    >
      <aside className="wa-side">
        <div className="wa-side-head">
          <h2>Chats</h2>
          {permission === "default" && (
            <button
              className="icon-button"
              title="Activar avisos en este dispositivo"
              aria-label="Activar avisos en este dispositivo"
              onClick={async () =>
                setPermission(await Notification.requestPermission())
              }
            >
              <Bell size={16} />
            </button>
          )}
        </div>
        <div className="wa-search">
          <Search size={15} />
          <input
            aria-label="Buscar conversación"
            placeholder="Buscar por nombre o celular"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="wa-filters" role="group" aria-label="Filtrar chats">
          {(
            [
              ["todas", "Todos", 0],
              ["no_leidas", "No leídos", unreadCount],
              ["atencion", "Requieren atención", attentionCount],
            ] as const
          ).map(([k, label, n]) => (
            <button
              key={k}
              className={filter === k ? "active" : ""}
              aria-pressed={filter === k}
              onClick={() => setFilter(k)}
            >
              {label}
              {n > 0 && <span>{n}</span>}
            </button>
          ))}
        </div>
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        <ul className="wa-list">
          {rows.length === 0 && (
            <li className="wa-empty">
              {visible.length === 0
                ? "Todavía no hay conversaciones de WhatsApp."
                : "No hay chats con ese filtro."}
            </li>
          )}
          {rows.map((c) => {
            const a = byId.get(c.application_id!)!;
            const m = last.get(c.id);
            const unread = c.unread_count > 0;
            return (
              <li key={c.id}>
                <button
                  className={`${unread ? "unread" : ""} ${selected === a.id ? "selected" : ""}`}
                  aria-label={`Abrir conversación con ${a.full_name}${unread ? ` (${c.unread_count} sin leer)` : ""}`}
                  aria-current={selected === a.id ? "true" : undefined}
                  onClick={() => choose(c)}
                >
                  <span className="wa-avatar" aria-hidden>
                    {initials(a.full_name)}
                  </span>
                  <span className="wa-item">
                    <span className="wa-item-top">
                      <span className="wa-name">{a.full_name}</span>
                      <span className="wa-time">
                        {c.last_message_at
                          ? listTime(c.last_message_at, now)
                          : ""}
                      </span>
                    </span>
                    <span className="wa-item-bottom">
                      <span className="wa-preview">
                        {m?.direction === "out" && <Ticks status={m.status} />}
                        {m
                          ? `${m.direction === "out" ? (m.author === "bot" ? "Asistente: " : m.author === "system" ? "" : "Vos: ") : ""}${m.body || "📎 Archivo adjunto"}`
                          : "Sin mensajes"}
                      </span>
                      {c.needs_human && (
                        <span className="wa-flag" title="Requiere atención">
                          Atención
                        </span>
                      )}
                      {unread && (
                        <span className="wa-unread" aria-hidden>
                          {c.unread_count}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>
      <div className="wa-main">
        {app ? (
          <>
            <header className="wa-chat-head">
              <button
                className="icon-button wa-back"
                aria-label="Volver a los chats"
                onClick={() => setSelected(null)}
              >
                <ArrowLeft size={16} />
              </button>
              <span className="wa-avatar" aria-hidden>
                {initials(app.full_name)}
              </span>
              <div className="wa-chat-title">
                <strong>{app.full_name}</strong>
                <small>
                  {app.phone}
                  {current?.profile_name &&
                  current.profile_name !== app.full_name
                    ? ` · en WhatsApp: ${current.profile_name}`
                    : ""}
                </small>
              </div>
              <button
                className="secondary"
                aria-label="Ver ficha"
                onClick={() => open(app.id)}
              >
                <ExternalLink size={14} />
                <span className="wa-hide-sm">Ver ficha</span>
              </button>
            </header>
            <WhatsAppPanel
              key={app.id}
              app={app}
              profile={profile}
              demo={demo}
              embedded
              onChange={load}
              onConsent={() => onConsent?.(app.id)}
            />
          </>
        ) : (
          <div className="wa-placeholder">
            <MessageCircle size={40} />
            <p>Elegí un chat para ver la conversación.</p>
            <small>Los chats con mensajes sin leer aparecen primero.</small>
          </div>
        )}
      </div>
    </section>
  );
}

const mediaLabel: Record<string, string> = {
  pending: "Guardando en Drive…",
  processing: "Guardando en Drive…",
  stored: "Guardado en la carpeta del caso",
  rejected: "No se guardó",
  failed: "No se pudo guardar en Drive",
};

function MediaState({
  message: m,
  demo,
  retried,
}: {
  message: WaMessage;
  demo: boolean;
  retried: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const link = safeDriveUrl(m.media?.drive_url);
  return (
    <small className={`wa-media ${m.media_status}`}>
      {mediaLabel[m.media_status ?? ""] ?? ""}
      {m.media_error ? ` · ${m.media_error}` : ""}
      {link && (
        <>
          {" · "}
          <a href={link} target="_blank" rel="noopener noreferrer">
            Ver en Drive
          </a>
        </>
      )}
      {m.media_status === "failed" && !demo && (
        <>
          {" · "}
          <button
            className="link-button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await supabase!.rpc("wa_retry_media", { p_message: m.id });
              setBusy(false);
              retried();
            }}
          >
            Reintentar
          </button>
        </>
      )}
    </small>
  );
}

async function setBot(demo: boolean, c: WaConversation, paused: boolean) {
  if (demo) {
    const d = demoLoad();
    d.conversations = d.conversations.map((x) =>
      x.id === c.id
        ? {
            ...x,
            bot_paused: paused,
            needs_human: paused ? x.needs_human : false,
            handoff_reason: paused ? x.handoff_reason : null,
          }
        : x,
    );
    demoSave(d);
    return;
  }
  const r = await supabase!.rpc("wa_set_bot", {
    p_conversation: c.id,
    p_paused: paused,
  });
  if (r.error) throw Error(r.error.message);
}

/** Shows whether the assistant answers this chat and lets the team pause or resume it. */
function BotStatus({
  conversation: c,
  demo,
  changed,
}: {
  conversation: WaConversation;
  demo: boolean;
  changed: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const toggle = async (paused: boolean) => {
    setBusy(true);
    try {
      await setBot(demo, c, paused);
      changed();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className={`wa-bot ${c.needs_human ? "attention" : c.bot_paused ? "paused" : "active"}`}
      role="status"
    >
      <span>
        {c.needs_human
          ? `Requiere atención${c.handoff_reason ? `: ${c.handoff_reason}` : ""}. El asistente está pausado.`
          : c.bot_paused
            ? "El asistente está pausado: responde el equipo."
            : "El asistente responde automáticamente (si está activado en Integraciones)."}
      </span>
      <button
        className="link-button"
        disabled={busy}
        onClick={() => toggle(!c.bot_paused)}
      >
        {c.bot_paused ? "Reactivar asistente" : "Pausar asistente"}
      </button>
    </div>
  );
}
