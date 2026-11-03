import { z } from "zod";
export const states = {
  completion: ["parte_1_recibida", "completo", "carga_manual"],
  contact_status: ["no_contactado", "contactado"],
  stage: ["nuevo", "en_contacto", "finalizado"],
  guarantee_stage: [
    "sin_contactar",
    "documentacion_solicitada",
    "documentacion_recibida",
    "preaprobacion_cargada",
    "aprobada",
    "rechazada",
  ],
  preapproval: ["no_iniciada", "en_proceso", "preaprobado", "no_preaprobado"],
  documentation: [
    "no_solicitada",
    "solicitada",
    "pendiente_cliente",
    "recibida_incompleta",
    "completa",
  ],
  decision: ["no_presentada", "en_evaluacion", "aprobada", "rechazada"],
  clearing: ["no_consultado", "figura", "no_figura", "indeterminado"],
} as const;
export const labels: Record<string, string> = {
  completion: "Formulario",
  contact_status: "Contacto",
  stage: "Estado comercial",
  guarantee_stage: "Proceso de la garantía",
  preapproval: "Preaprobación interna",
  documentation: "Documentación",
  decision: "Decisión formal Porto",
  clearing: "Clearing",
};
export const human = (s: string) =>
  (
    ({
      comentario: "Comentario",
      comunicacion: "Comunicación",
      actualizacion: "Actualización",
      nuevo: "Nuevo cliente",
      en_contacto: "En contacto",
      finalizado: "Finalizado",
      sin_contactar: "Sin contactar",
      documentacion_solicitada: "Solicitada la documentación",
      documentacion_recibida: "Recibimos documentación",
      preaprobacion_cargada: "Cargada la preaprobación",
      ingresos_insuficientes: "Ingresos insuficientes",
      score_insuficiente: "Score insuficiente",
      documentacion_insuficiente: "Documentación insuficiente",
      clearing: "Estar en el Clearing",
    }) as Record<string, string>
  )[s] || s.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
export type Profile = {
  id: string;
  full_name: string;
  role: "admin" | "seller";
  active: boolean;
  can_clearing: boolean;
};
export type Application = {
  id: string;
  contact_id?: string;
  external_id?: string;
  full_name: string;
  phone: string;
  national_id?: string | null;
  rent_amount: number | null;
  rent_currency: string | null;
  guarantee_type: string;
  source: string; // capture channel; separate from commercial origin
  source_id?: string | null;
  assigned_user_id: string | null;
  created_at: string;
  updated_at: string;
  completion: string;
  contact_status: string;
  stage: string;
  guarantee_stage?: string;
  requested_date?: string | null;
  drive_folder_url?: string | null;
  preapproval: string;
  documentation: string;
  decision: string;
  decision_date?: string | null;
  decision_reference?: string | null;
  summary: string;
  archived: boolean;
  attribution: Record<string, string>;
};
export type Note = {
  id: string;
  application_id: string;
  author_id: string;
  body: string;
  kind?: "comentario" | "comunicacion" | "actualizacion";
  created_at: string;
};
export type Audit = {
  id: string;
  application_id: string;
  actor_id: string | null;
  action: string;
  created_at: string;
  changes?: unknown;
  visibility?: "case" | "admin" | "clearing";
  actor_name?: string | null;
};
export type Sensitive = {
  application_id: string;
  national_id: string;
  rejection_reason?: string | null;
  monthly_income: number | null;
};
export type Clearing = {
  application_id: string;
  result: string;
  detail: string;
};
export type Field = {
  id: string;
  label: string;
  type: "text" | "number" | "date" | "select" | "boolean";
  options: string[];
  sensitive: boolean;
  archived: boolean;
};
export type FieldValue = {
  application_id: string;
  field_id: string;
  value: string;
};
export type ClientSource = { id: string; name: string; archived: boolean };
export type Store = {
  sources: ClientSource[];
  applications: Application[];
  profiles: Profile[];
  notes: Note[];
  audits: Audit[];
  sensitive: Sensitive[];
  clearing: Clearing[];
  fields: Field[];
  values: FieldValue[];
};
const money = z.number().finite().nonnegative().max(1e12);
export const eventSchema = z
  .object({
    schema_version: z.literal(1),
    event_id: z.string().uuid(),
    solicitud_id: z.string().uuid(),
    step: z.union([z.literal(1), z.literal(2)]),
    sent_at: z.iso.datetime(),
    data: z
      .object({
        full_name: z.string().trim().min(1).max(200),
        phone: z.string().trim().min(3).max(40),
        rent_amount: money.nullable().optional(),
        rent_currency: z.enum(["UYU", "USD"]).nullable().optional(),
        national_id: z.string().max(40).optional(),
        monthly_income: money.nullable().optional(),
        button_origin: z.string().max(300).optional(),
        source_url: z.string().max(2000).optional(),
        utm_source: z.string().max(300).optional(),
        utm_medium: z.string().max(300).optional(),
        utm_campaign: z.string().max(300).optional(),
        utm_content: z.string().max(300).optional(),
        utm_term: z.string().max(300).optional(),
        gclid: z.string().max(500).optional(),
        gbraid: z.string().max(500).optional(),
        wbraid: z.string().max(500).optional(),
        fbclid: z.string().max(500).optional(),
        referrer: z.string().max(2000).optional(),
        landing_page: z.string().max(2000).optional(),
        form_id: z.string().max(300).optional(),
        button_id: z.string().max(300).optional(),
        consent_evidence: z.string().max(1000).optional(),
      })
      .strict(),
    extra: z
      .record(
        z.string().max(100),
        z.union([
          z.string().max(2000),
          z.number().finite(),
          z.boolean(),
          z.null(),
        ]),
      )
      .default({}),
  })
  .strict();
export function parseUyMoney(s: string): number {
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(s))
    throw Error("Importe inválido");
  return Number(s.replaceAll(".", "").replace(",", "."));
}
export function completionAfter(current: string, step: 1 | 2) {
  return current === "completo" || step === 2 ? "completo" : "parte_1_recibida";
}
export function visible(app: Application, p: Profile) {
  return p.active && (p.role === "admin" || app.assigned_user_id === p.id);
}
