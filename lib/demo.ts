import {
  defaultSources,
  WEB_SOURCE_ID,
  REAL_ESTATE_SOURCE_ID,
} from "./sources";
import type { Store, Application } from "./domain";
import type { WaConversation, WaMessage } from "./whatsapp";
export const adminId = "00000000-0000-4000-8000-000000000001",
  sellerId = "00000000-0000-4000-8000-000000000002",
  otherId = "00000000-0000-4000-8000-000000000003";
export function seed(): Store {
  const names = [
    "Lucía Ejemplo",
    "Mateo Prueba",
    "Sofía Ficticia",
    "Bruno Demostración",
    "Valentina Ejemplo",
    "Tomás Prueba",
    "Emma Ficticia",
    "Santiago Demo",
    "Clara Ejemplo",
    "Nicolás Prueba",
    "Martina Demo",
    "Joaquín Ficticio",
  ];
  const applications: Application[] = names.map((full_name, i) => ({
    id: `10000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    full_name,
    national_id: `000000${i % 10}0`, // Synthetic examples only, no identity verification.
    phone: `000 000 ${String(i + 1).padStart(3, "0")}`,
    rent_amount: [28000, 35000, 22000, 42000, 31000, 18000][i % 6],
    rent_currency: "UYU",
    guarantee_type:
      i % 4 === 0 ? "universitaria" : i % 5 === 0 ? "rural" : "tradicional",
    source: i % 3 === 0 ? "manual" : "web",
    source_id: i % 3 === 0 ? REAL_ESTATE_SOURCE_ID : WEB_SOURCE_ID,
    assigned_user_id: i < 3 ? null : i % 2 ? sellerId : otherId,
    created_at: new Date(Date.now() - i * 8 * 3600000).toISOString(),
    updated_at: new Date(Date.now() - i * 8 * 3600000).toISOString(),
    completion: i % 3 === 0 ? "parte_1_recibida" : "completo",
    contact_status: i < 4 ? "no_contactado" : "contactado",
    stage: i < 4 ? "nuevo" : i < 9 ? "en_contacto" : "finalizado",
    guarantee_stage:
      i < 4
        ? "sin_contactar"
        : i < 7
          ? "documentacion_solicitada"
          : i < 9
            ? "documentacion_recibida"
            : "preaprobacion_cargada",
    requested_date: new Date(Date.now() - i * 8 * 3600000)
      .toISOString()
      .slice(0, 10),
    drive_folder_url: null,
    preapproval: i > 6 ? "preaprobado" : i > 3 ? "en_proceso" : "no_iniciada",
    documentation: i > 6 ? "pendiente_cliente" : "no_solicitada",
    decision: "no_presentada",
    summary: i === 0 ? "Solicitud ficticia para explorar el panel." : "",
    archived: false,
    attribution: { utm_source: "demo", utm_campaign: "Campaña ficticia" },
  }));
  return {
    applications,
    sources: defaultSources(),
    profiles: [
      {
        id: adminId,
        full_name: "Administración Demo",
        role: "admin",
        active: true,
        can_clearing: true,
      },
      {
        id: sellerId,
        full_name: "Ana · Vendedora Demo",
        role: "seller",
        active: true,
        can_clearing: false,
      },
      {
        id: otherId,
        full_name: "Diego · Vendedor Demo",
        role: "seller",
        active: true,
        can_clearing: true,
      },
    ],
    notes: [],
    audits: [],
    sensitive: [],
    clearing: [],
    fields: [],
    values: [],
  };
}

// Fictitious WhatsApp conversations for the local demo (stored separately under porto-demo-whatsapp-v1).
export function waDemoSeed(now = Date.now()): {
  conversations: WaConversation[];
  messages: WaMessage[];
} {
  const iso = (minutesAgo: number) =>
    new Date(now - minutesAgo * 60000).toISOString();
  const conv = (
    n: number,
    app: string,
    inbound: number | null,
    unread: number,
  ): WaConversation => ({
    id: `70000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    wa_id: `5989900000${n}`,
    application_id: app,
    profile_name: null,
    last_inbound_at: inbound === null ? null : iso(inbound),
    last_message_at: iso(inbound ?? 60 * 30),
    unread_count: unread,
    needs_human: false,
    bot_paused: false,
    created_at: iso(60 * 72),
  });
  const conversations = [
    conv(1, "10000000-0000-4000-8000-000000000004", 12, 1),
    conv(2, "10000000-0000-4000-8000-000000000005", 60 * 30, 0),
  ];
  let k = 0;
  const msg = (
    c: WaConversation,
    direction: "in" | "out",
    author: WaMessage["author"],
    body: string,
    minutesAgo: number,
    kind = "text",
    status: WaMessage["status"] = direction === "in" ? "received" : "read",
  ): WaMessage => ({
    id: `71000000-0000-4000-8000-${String(++k).padStart(12, "0")}`,
    conversation_id: c.id,
    application_id: c.application_id,
    wamid: `wamid.demo.${k}`,
    direction,
    author,
    author_id: null,
    kind,
    body,
    media: null,
    status,
    error: null,
    created_at: iso(minutesAgo),
    status_at: null,
  });
  const [a, b] = conversations;
  return {
    conversations,
    messages: [
      msg(
        a,
        "out",
        "system",
        "Plantilla: saludo_solicitud",
        60 * 26,
        "template",
      ),
      msg(
        a,
        "in",
        "customer",
        "Hola, gracias. ¿Qué documentos tengo que mandar?",
        40,
      ),
      msg(a, "out", "human", "Hola Bruno, te paso la lista en un momento.", 35),
      {
        ...msg(
          a,
          "in",
          "customer",
          "recibo_sueldo_octubre.pdf",
          20,
          "document",
        ),
        media: {
          id: "demo-media-1",
          mime_type: "application/pdf",
          filename: "recibo_sueldo_octubre.pdf",
          drive_url:
            "https://drive.google.com/drive/folders/demo-carpeta-ficticia",
        },
        media_status: "stored",
      },
      msg(a, "in", "customer", "Perfecto, quedo atento.", 12),
      msg(
        b,
        "out",
        "system",
        "Plantilla: saludo_solicitud",
        60 * 31,
        "template",
      ),
      msg(b, "in", "customer", "Hola, ¿me pueden llamar mañana?", 60 * 30),
    ],
  };
}
