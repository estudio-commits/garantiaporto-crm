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
  MessageSquareDot,
  Mic,
  Paperclip,
  RefreshCw,
  Search,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { webmToOggOpus } from "@/lib/ogg-opus";
import {
  DEFAULT_HOURS,
  responseTurns,
  type BusinessHours,
  type ResponseTurn,
} from "@/lib/analytics";
import { supabase } from "@/lib/supabase";
import { waDemoSeed } from "@/lib/demo";
import type { Application, Profile } from "@/lib/domain";
import { whatsappNumber } from "@/lib/phone";
import {
  CAPTION_MAX,
  SEND_MEDIA,
  SEND_MEDIA_ACCEPT,
  SEND_MEDIA_MAX_BYTES,
  UNSUPPORTED_GENERIC,
  dayLabel,
  sendMime,
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

/** Marks a chat as unread for the whole team, like WhatsApp's "Marcar como no leído". */
async function markUnread(demo: boolean, c: WaConversation) {
  if (demo) {
    const d = demoLoad();
    d.conversations = d.conversations.map((x) =>
      x.id === c.id ? { ...x, unread_count: Math.max(1, x.unread_count) } : x,
    );
    demoSave(d);
    return;
  }
  const r = await supabase!.rpc("wa_mark_unread", { p_conversation: c.id });
  if (r.error) throw Error("No se pudo marcar como no leído.");
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

const fileSize = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toLocaleString("es-UY", { maximumFractionDigits: 1 })} MB`;

/** Photos are re-encoded in the browser (max 2048 px, JPEG) so they fit what the CRM can send. */
async function shrinkImage(file: File): Promise<File> {
  if (file.size <= 1.5 * 1024 * 1024) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.fillStyle = "#fff"; // transparent PNG areas become white, not black
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((ok) =>
      canvas.toBlob(ok, "image/jpeg", 0.85),
    );
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]*$/, "") + ".jpg", {
      type: "image/jpeg",
    });
  } catch {
    return file;
  }
}

/** Checks a file chosen to send; returns the file to send or a message for the user. */
async function prepareAttachment(
  chosen: File,
): Promise<{ file: File } | { error: string }> {
  const mime = sendMime(chosen.type);
  if (!SEND_MEDIA[mime])
    return {
      error:
        "Solo se pueden enviar fotos (JPG o PNG), PDF, videos MP4 y audios (MP3, M4A, AAC u OGG).",
    };
  // Same bytes, with the type name WhatsApp expects (e.g. audio/x-m4a → audio/mp4).
  const file =
    mime === chosen.type
      ? chosen
      : new File([chosen], chosen.name, { type: mime });
  const ready = SEND_MEDIA[mime]!.kind === "image" ? await shrinkImage(file) : file;
  if (ready.size > SEND_MEDIA_MAX_BYTES)
    return {
      error:
        SEND_MEDIA[mime]!.kind === "video"
          ? "El video supera los 4 MB que se pueden enviar desde el CRM. Recortalo o envialo desde el celular de la empresa."
          : "El archivo supera los 4 MB que se pueden enviar desde el CRM.",
    };
  return { file: ready };
}

const VOICE_MAX_SECONDS = 600;
// Opus in WebM (Chrome, Edge, recent Safari) is repackaged as Ogg; Firefox records Ogg directly.
const RECORDER_TYPES = [
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

/** A finished recording → the file to send: Ogg/Opus voice note when possible. */
async function voiceNoteFile(blob: Blob): Promise<File> {
  const type = sendMime(blob.type);
  if (type === "audio/webm") {
    const ogg = webmToOggOpus(new Uint8Array(await blob.arrayBuffer()));
    if (!ogg) throw Error("No se pudo preparar la nota de voz. Probá grabarla de nuevo.");
    return new File([ogg], "Nota de voz.ogg", { type: "audio/ogg" });
  }
  if (type === "audio/ogg" || type === "audio/mp4")
    return new File([blob], `Nota de voz.${type === "audio/ogg" ? "ogg" : "m4a"}`, {
      type,
    });
  throw Error("Este navegador graba en un formato que WhatsApp no admite. Probá con Chrome.");
}

type Recording = {
  recorder: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
  started: number;
};

/** Records a voice note with the computer's microphone. */
function useVoiceRecorder(onRecorded: (file: File) => void, onError: (msg: string) => void) {
  const rec = useRef<Recording | null>(null);
  const [seconds, setSeconds] = useState<number | null>(null);
  const finish = useCallback(
    async (send: boolean) => {
      const r = rec.current;
      if (!r) return;
      rec.current = null;
      setSeconds(null);
      if (r.recorder.state !== "inactive")
        await new Promise<void>((ok) => {
          r.recorder.onstop = () => ok();
          r.recorder.stop();
        });
      r.stream.getTracks().forEach((t) => t.stop());
      if (!send) return;
      if (Date.now() - r.started < 1000)
        return onError("La nota de voz es muy corta. Mantené la grabación al menos un segundo.");
      try {
        const file = await voiceNoteFile(
          new Blob(r.chunks, { type: r.recorder.mimeType || r.chunks[0]?.type }),
        );
        if (file.size > SEND_MEDIA_MAX_BYTES)
          return onError("La nota de voz supera los 4 MB que se pueden enviar desde el CRM.");
        onRecorded(file);
      } catch (e) {
        onError(e instanceof Error ? e.message : "No se pudo preparar la nota de voz.");
      }
    },
    [onRecorded, onError],
  );
  const active = seconds !== null;
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      const r = rec.current;
      if (!r) return;
      const s = Math.floor((Date.now() - r.started) / 1000);
      setSeconds(s);
      if (s >= VOICE_MAX_SECONDS) finish(true);
    }, 250);
    return () => clearInterval(t);
  }, [active, finish]);
  // Leaving the chat while recording releases the microphone.
  useEffect(
    () => () => {
      const r = rec.current;
      rec.current = null;
      if (r && r.recorder.state !== "inactive") r.recorder.stop();
      r?.stream.getTracks().forEach((t) => t.stop());
    },
    [],
  );
  async function start() {
    if (rec.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined")
      return onError("Este navegador no permite grabar audio. Probá con Chrome.");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      return onError(
        name === "NotAllowedError" || name === "SecurityError"
          ? "Permití el uso del micrófono en el navegador para grabar notas de voz."
          : name === "NotFoundError"
            ? "No se encontró un micrófono en este equipo."
            : `No se pudo usar el micrófono${name ? ` (${name})` : ""}. Revisá que no lo esté usando otro programa.`,
      );
    }
    const mimeType = RECORDER_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: 32000,
    });
    const r: Recording = { recorder, stream, chunks: [], started: Date.now() };
    recorder.ondataavailable = (e) => {
      if (e.data.size) r.chunks.push(e.data);
    };
    recorder.start(1000);
    rec.current = r;
    setSeconds(0);
  }
  return { seconds, start, stop: finish };
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

async function sendFile(
  demo: boolean,
  app: Application,
  profile: Profile,
  file: File,
  caption: string,
) {
  const kind = SEND_MEDIA[sendMime(file.type)]?.kind ?? "document";
  if (demo) {
    const d = demoLoad();
    const c = d.conversations.find((x) => x.application_id === app.id);
    if (!c || !windowOpen(c.last_inbound_at))
      throw Error(
        "Pasaron más de 24 h desde el último mensaje del cliente. Enviá la plantilla para retomar la conversación.",
      );
    const now = new Date().toISOString();
    d.messages.push({
      id: crypto.randomUUID(),
      conversation_id: c.id,
      application_id: app.id,
      wamid: null,
      direction: "out",
      author: "human",
      author_id: profile.id,
      kind,
      body: caption,
      media: {
        id: "demo",
        mime_type: file.type,
        filename: file.name,
        ...(file.type === "audio/ogg" ? { voice: true } : {}),
      },
      status: "sent",
      error: null,
      created_at: now,
      status_at: null,
    });
    d.conversations = d.conversations.map((x) =>
      x.id === c.id ? { ...x, last_message_at: now, unread_count: 0 } : x,
    );
    demoSave(d);
    return;
  }
  const form = new FormData();
  form.append("application_id", app.id);
  form.append("file", file, file.name);
  if (caption) form.append("caption", caption);
  const r = await fetch("/api/whatsapp/send-media", {
    method: "POST",
    headers: await authHeader(),
    body: form,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok)
    throw Error(
      data.error ||
        (r.status === 413
          ? "El archivo supera los 4 MB que se pueden enviar desde el CRM."
          : "No se pudo enviar el archivo."),
    );
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
  onSent,
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
  /** A team message went out: the case history, stage and alerts changed in the database. */
  onSent?: () => void;
}) {
  const [messages, setMessages] = useState<WaMessage[]>([]),
    [conversation, setConversation] = useState<WaConversation | null>(null),
    [text, setText] = useState(""),
    [attachment, setAttachment] = useState<File | null>(null),
    [consent, setConsent] = useState(false),
    // Consent ticked here is stored on the case by the server, so it is asked only once.
    [savedConsent, setSavedConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [now, setNow] = useState(Date.now());
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // A closed chat must not mark itself read late (e.g. right after "Marcar como no leído").
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const autoFiled = useRef(false);
  const load = useCallback(async () => {
    try {
      const [convs, msgs] = await Promise.all([
        listConversations(demo),
        listMessages(demo, app.id),
      ]);
      const c = convs.find((x) => x.application_id === app.id) ?? null;
      // Files still waiting for Drive are filed when someone opens the chat, once per visit.
      if (
        !demo &&
        !autoFiled.current &&
        msgs.some(
          (m) =>
            m.media_status === "failed" ||
            (m.media_status === "pending" &&
              Date.now() - Date.parse(m.created_at) > 60000) ||
            (m.media_status === "processing" &&
              Date.now() - Date.parse(m.created_at) > 120000),
        )
      ) {
        autoFiled.current = true;
        fileCaseMedia(app.id).then(() => load());
      }
      setConversation(c);
      setMessages(msgs);
      setNow(Date.now());
      if (c?.unread_count && alive.current) {
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
  // Anyone who already talked with us (wrote to the number, or got a template) gets the
  // "reopen" template; the initial greeting is only for clients we never contacted.
  const greeted =
    !!conversation?.last_inbound_at ||
    messages.some(
      (m) =>
        m.direction === "in" ||
        (m.direction === "out" && m.kind === "template"),
    );
  const hasConsent =
    !!app.wa_consent ||
    !!String(app.attribution?.consent_evidence ?? "").trim() ||
    !!conversation?.last_inbound_at ||
    savedConsent;

  const sendVoice = useCallback(
    async (file: File) => {
      setBusy(true);
      setError("");
      try {
        await sendFile(demo, app, profile, file, "");
        await load();
        onChange?.();
        onSent?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo enviar la nota de voz.");
      } finally {
        setBusy(false);
      }
    },
    [demo, app, profile, load, onChange, onSent],
  );
  const voice = useVoiceRecorder(sendVoice, setError);
  const recording = voice.seconds !== null;

  // The recording bar or a chosen file takes room: keep the latest messages in view.
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [recording, attachment]);

  async function attach(file: File | undefined) {
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    setError("");
    const ready = await prepareAttachment(file);
    if ("error" in ready) {
      setAttachment(null);
      setError(ready.error);
    } else setAttachment(ready.file);
  }

  async function send(action: SendAction) {
    setBusy(true);
    setError("");
    try {
      if (action === "text" && attachment) {
        const audio = SEND_MEDIA[attachment.type]?.kind === "audio";
        if (!audio && text.trim().length > CAPTION_MAX)
          throw Error(
            `El texto que acompaña el archivo admite hasta ${CAPTION_MAX} caracteres. Envialo como mensaje aparte.`,
          );
        await sendFile(demo, app, profile, attachment, audio ? "" : text.trim());
        setAttachment(null);
        // WhatsApp audio carries no text: the text goes right after, as its own message.
        if (audio && text.trim())
          await sendMessage(demo, app, profile, "text", text.trim(), false);
      } else
        await sendMessage(demo, app, profile, action, text.trim(), consent);
      if (action === "text") setText("");
      if (consent) {
        setSavedConsent(true);
        onConsent?.();
      }
      setConsent(false);
      await load();
      onChange?.();
      onSent?.();
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
              aria-label={`${authorLabel(m)}: ${m.kind === "unsupported" ? "Mensaje no compatible" : m.body || (m.media ? mediaText(m) : "")}`}
            >
              {m.direction === "out" && (
                <small className={`wa-author ${m.author}`}>
                  {authorLabel(m)}
                </small>
              )}
              {m.kind === "unsupported" ? (
                <Unsupported message={m} />
              ) : (
                <p>{m.media ? mediaText(m) : m.body}</p>
              )}
              {m.media_status && (
                <MediaState message={m} demo={demo} retried={load} />
              )}
              {m.media?.id && !demo && (
                <button
                  className="link-button wa-open"
                  onClick={() => openMedia(m.id)}
                >
                  {m.kind === "audio"
                    ? "Escuchar audio"
                    : m.kind === "video"
                      ? "Ver video"
                      : "Ver archivo"}
                </button>
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
            if (!busy && (text.trim() || attachment)) send("text");
          }}
        >
          {recording && (
            <div
              className="wa-recording"
              role="status"
              aria-label="Grabación de nota de voz"
            >
              <span className="wa-rec-dot" aria-hidden="true" />
              <span>
                Grabando nota de voz <b>{clock(voice.seconds ?? 0)}</b>
              </span>
              <button
                type="button"
                className="icon-button"
                aria-label="Cancelar nota de voz"
                onClick={() => voice.stop(false)}
              >
                <Trash2 size={16} />
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => voice.stop(true)}
              >
                <Send size={16} /> Enviar nota de voz
              </button>
            </div>
          )}
          {attachment && (
            <div className="wa-attachment">
              <span>
                {SEND_MEDIA[attachment.type]?.kind === "image"
                  ? "🖼️"
                  : SEND_MEDIA[attachment.type]?.kind === "video"
                    ? "🎬"
                    : SEND_MEDIA[attachment.type]?.kind === "audio"
                      ? "🎵"
                      : "📎"}{" "}
                {attachment.name}{" "}
                <small className="muted">{fileSize(attachment.size)}</small>
              </span>
              <button
                type="button"
                className="icon-button"
                aria-label="Quitar archivo"
                onClick={() => setAttachment(null)}
              >
                <X size={16} />
              </button>
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            hidden
            accept={SEND_MEDIA_ACCEPT}
            aria-label="Archivo para enviar"
            onChange={(e) => attach(e.target.files?.[0])}
          />
          <button
            type="button"
            className="icon-button wa-clip"
            aria-label="Adjuntar foto, PDF, video o audio"
            title="Adjuntar foto, PDF, video o audio (hasta 4 MB)"
            disabled={busy || !valid || recording}
            onClick={() => fileRef.current?.click()}
          >
            <Paperclip size={18} />
          </button>
          <button
            type="button"
            className="icon-button wa-clip"
            aria-label="Grabar nota de voz"
            title="Grabar nota de voz"
            disabled={busy || !valid || recording || !!attachment}
            onClick={() => voice.start()}
          >
            <Mic size={18} />
          </button>
          <textarea
            aria-label="Mensaje de WhatsApp"
            value={text}
            maxLength={4096}
            rows={2}
            disabled={recording}
            placeholder={
              attachment
                ? SEND_MEDIA[attachment.type]?.kind === "audio"
                  ? "Texto (opcional, se envía aparte del audio)…"
                  : "Agregá un texto (opcional)…"
                : "Escribí tu respuesta…"
            }
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!busy && (text.trim() || attachment)) send("text");
              }
            }}
          />
          <button
            className="primary"
            disabled={busy || recording || (!text.trim() && !attachment) || !valid}
          >
            <Send size={16} /> {busy && attachment ? "Enviando…" : "Enviar"}
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

/**
 * WhatsApp data for the response-time statistics: client turns since a date and the attention hours.
 * Null when the database does not offer it yet (migration 026 not applied).
 */
export async function loadResponseData(
  demo: boolean,
  since: string,
): Promise<{ turns: ResponseTurn[]; hours: BusinessHours } | null> {
  if (demo)
    return {
      turns: responseTurns(
        demoLoad().messages.filter((m) => m.created_at >= since),
      ),
      hours: DEFAULT_HOURS,
    };
  const [turns, hours] = await Promise.all([
    supabase!.rpc("wa_response_turns", { p_since: since }),
    supabase!.rpc("wa_business_hours"),
  ]);
  if (turns.error) return null;
  const h = (hours.data as
    | { hours_start: string; hours_end: string; business_days: number[] }[]
    | null)?.[0];
  return {
    turns: (turns.data ?? []) as ResponseTurn[],
    hours: h
      ? {
          start: h.hours_start.slice(0, 5),
          end: h.hours_end.slice(0, 5),
          days: h.business_days,
        }
      : DEFAULT_HOURS,
  };
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
  onSent,
}: {
  applications: Application[];
  profile: Profile;
  demo: boolean;
  /** Opens the client's full case file. */
  open: (applicationId: string) => void;
  onConsent?: (applicationId: string) => void;
  /** A team message went out from this case's chat. */
  onSent?: (applicationId: string) => void;
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
                          ? `${m.direction === "out" ? (m.author === "bot" ? "Asistente: " : m.author === "system" ? "" : "Vos: ") : ""}${m.kind === "unsupported" ? "⚠️ Mensaje no compatible" : m.body || mediaText(m)}`
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
              {current && (
                <button
                  className="secondary"
                  aria-label="Marcar como no leído"
                  title="Marcar como no leído"
                  onClick={async () => {
                    // Close the chat first: an open chat marks itself read.
                    setSelected(null);
                    try {
                      await markUnread(demo, current);
                      setConvs((l) =>
                        l.map((x) =>
                          x.id === current.id
                            ? { ...x, unread_count: Math.max(1, x.unread_count) }
                            : x,
                        ),
                      );
                      await load();
                    } catch (e) {
                      setError(
                        e instanceof Error ? e.message : "No se pudo marcar como no leído.",
                      );
                    }
                  }}
                >
                  <MessageSquareDot size={14} />
                  <span className="wa-hide-sm">No leído</span>
                </button>
              )}
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
              onSent={() => onSent?.(app.id)}
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

async function authHeader() {
  const {
    data: { session },
  } = await supabase!.auth.getSession();
  return { authorization: `Bearer ${session?.access_token}` };
}

/** Asks the server to file this case's pending or failed WhatsApp documents in Drive now. */
async function fileCaseMedia(applicationId: string) {
  await fetch("/api/whatsapp/media", {
    method: "POST",
    headers: { "content-type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ application_id: applicationId }),
  }).catch(() => undefined);
}

/** Opens a file from the chat, straight from WhatsApp (works even if it is not in Drive). */
async function openMedia(messageId: string) {
  const tab = window.open("", "_blank");
  const r = await fetch(
    `/api/whatsapp/media?id=${encodeURIComponent(messageId)}`,
    { headers: await authHeader() },
  ).catch(() => null);
  if (!r?.ok) {
    tab?.close();
    const data = await r?.json().catch(() => ({}));
    alert(data?.error || "No se pudo abrir el archivo.");
    return;
  }
  const url = URL.createObjectURL(await r.blob());
  if (tab) tab.location.href = url;
  else window.location.href = url;
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** Something WhatsApp did not hand over to the CRM, with what to do about it. */
function Unsupported({ message: m }: { message: WaMessage }) {
  return (
    <>
      <p>⚠️ WhatsApp no le pasa este mensaje al CRM.</p>
      <small className="wa-unsupported">
        Suele ser una foto o video «ver una vez», una encuesta, un evento, o un
        mensaje editado o eliminado. Si hace falta, pedile al cliente que lo
        reenvíe como foto o PDF común.
        {m.body && m.body !== UNSUPPORTED_GENERIC && (
          <span className="wa-detail">{m.body}</span>
        )}
      </small>
    </>
  );
}

/** A file in the chat, by kind: WhatsApp voice notes and videos carry no file name. */
function mediaText(m: WaMessage) {
  const name = m.media?.filename;
  switch (m.kind) {
    case "audio":
      return m.direction === "out" && !m.media?.voice
        ? `🎵 ${name || "Audio"}`
        : "🎤 Nota de voz";
    case "video":
      return `🎬 Video${m.body ? `: ${m.body}` : ""}`;
    case "sticker":
      return "Sticker";
    case "image":
      return `🖼️ ${m.body || name || "Imagen"}`;
    default:
      return `📎 ${name || m.body || "Documento"}${name && m.body && m.body !== name ? ` · ${m.body}` : ""}`;
  }
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
      {(m.media_status === "failed" ||
        m.media_status === "pending" ||
        m.media_status === "processing") &&
        !demo &&
        m.application_id && (
          <>
            {" · "}
            <button
              className="link-button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await fileCaseMedia(m.application_id!);
                setBusy(false);
                retried();
              }}
            >
              {busy ? "Guardando…" : "Guardar ahora"}
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
