import {
  defaultSources,
  WEB_SOURCE_ID,
  REAL_ESTATE_SOURCE_ID,
} from "./sources";
import type { Store, Application } from "./domain";
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
