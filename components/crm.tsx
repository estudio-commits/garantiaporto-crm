"use client";
import { useEffect, useState, useMemo, FormEvent } from "react";
import {
  LayoutDashboard,
  Columns3,
  Users,
  Search,
  Plus,
  ArrowUpRight,
  ArrowLeft,
  SlidersHorizontal,
  ChevronRight,
  ShieldCheck,
  LogOut,
  PanelLeftClose,
  Clock,
  FileCheck2,
  Inbox,
  MoreHorizontal,
  Check,
  Activity,
  Settings2,
  Link2,
  X,
  Download,
  RefreshCw,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import UserCreator from "./user-creator";
import CaseDetail from "./case-detail";
import Dialog from "./dialog";
import {
  demoMutation,
  needsFollowUp,
  todayUy,
  terminal,
  rejectionReasons,
} from "@/lib/workflow";
import Pipeline from "./pipeline";
import SourceManager from "./source-manager";
import ApprovalMetrics from "./approval-metrics";
import { sourceName, upgradeStore } from "@/lib/sources";
import { seed, adminId } from "@/lib/demo";
import {
  states,
  labels,
  human,
  visible,
  type Store,
  type Profile,
  type Application,
  type Field,
  type Note,
} from "@/lib/domain";
const empty: Store = {
  sources: [],
  applications: [],
  profiles: [],
  notes: [],
  audits: [],
  sensitive: [],
  clearing: [],
  fields: [],
  values: [],
};
const tables: Record<keyof Store, string> = {
  sources: "client_sources",
  applications: "applications",
  profiles: "profiles",
  notes: "notes",
  audits: "audit_log",
  sensitive: "application_sensitive",
  clearing: "clearing_records",
  fields: "custom_field_definitions",
  values: "custom_field_values",
};
const date = (s: string) =>
  new Intl.DateTimeFormat("es-UY", {
    day: "2-digit",
    month: "short",
    timeZone: "America/Montevideo",
  }).format(new Date(s));
const money = (a: Application) =>
  a.rent_amount === null
    ? "Sin informar"
    : new Intl.NumberFormat("es-UY", {
        style: "currency",
        currency: a.rent_currency || "UYU",
        maximumFractionDigits: 0,
      }).format(a.rent_amount) +
      (a.rent_currency ? "" : " (moneda sin informar)");
function Badge({ value }: { value: string }) {
  return (
    <span className={`badge ${value}`}>
      <i />
      {human(value)}
    </span>
  );
}
export default function CRM() {
  const demo = !supabase;
  const [store, setStore] = useState<Store>(empty),
    [profile, setProfile] = useState<Profile | null>(null),
    [ready, setReady] = useState(false),
    [page, setPage] = useState("Inicio"),
    [selected, setSelected] = useState<string | null>(null),
    [preview, setPreview] = useState<string | null>(null),
    [decisionTarget, setDecisionTarget] = useState<{
      id: string;
      stage: string;
    } | null>(null),
    [now, setNow] = useState(Date.now()),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("todos"),
    [showFilters, setShowFilters] = useState(false),
    [completion, setCompletion] = useState("todos"),
    [originFilter, setOriginFilter] = useState("todos"),
    [typeFilter, setTypeFilter] = useState("todos"),
    [owner, setOwner] = useState("todos"),
    [archived, setArchived] = useState(false),
    [sort, setSort] = useState("recent"),
    [pageNumber, setPageNumber] = useState(1),
    [modal, setModal] = useState<"lead" | "field" | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [integration, setIntegration] = useState<Record<string, unknown>[]>([]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  async function load() {
    if (!supabase) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setProfile(null);
      setReady(true);
      return;
    }
    const p = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();
    if (!p.data?.active) {
      setMessage(
        "Tu usuario no tiene un perfil activo. Contacta a administración.",
      );
      setProfile(null);
      setReady(true);
      return;
    }
    setProfile(p.data);
    const next = { ...empty };
    for (const k of Object.keys(tables) as (keyof Store)[]) {
      const r = await supabase.from(tables[k]).select("*");
      if (r.error) throw Error(r.error.message);
      (next[k] as unknown[]) = r.data || [];
    }
    setStore(next);
    setReady(true);
  }
  useEffect(() => {
    if (demo) {
      try {
        const saved = localStorage.getItem("porto-demo-v1");
        setStore(saved ? upgradeStore(JSON.parse(saved)) : seed());
      } catch {
        setStore(seed());
      }
      setProfile(seed().profiles[0]);
      setReady(true);
    } else {
      load().catch((e) => {
        setMessage(e.message);
        setReady(true);
      });
      const { data } = supabase!.auth.onAuthStateChange(() => {
        setTimeout(() => load().catch((e) => setMessage(e.message)), 0);
      });
      return () => data.subscription.unsubscribe();
    }
  }, []);
  useEffect(() => {
    if (demo && ready)
      localStorage.setItem("porto-demo-v1", JSON.stringify(store));
  }, [store, demo, ready]);
  useEffect(() => {
    setPageNumber(1);
  }, [search, filter, completion, owner, archived, originFilter, typeFilter]);
  async function mutate(
    k: keyof Store,
    value: Record<string, unknown>,
    mode: "insert" | "update" | "upsert" = "update",
    match = "id",
  ) {
    setBusy(true);
    setMessage("");
    try {
      if (supabase) {
        const q = supabase.from(tables[k]);
        const r =
          mode === "insert"
            ? await q.insert(value)
            : mode === "upsert"
              ? await q.upsert(value)
              : await q.update(value).eq(match, value[match]).select();
        if (r.error) throw Error(r.error.message);
        if (mode === "update" && (!r.data || r.data.length === 0))
          throw Error(
            "No se pudo guardar: el registro ya no está disponible o no tenés permiso.",
          );
        await load();
      } else {
        setStore(demoMutation(store, k, value, mode, match, profile!));
      }
      return true;
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "No se pudo guardar");
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function changeGuarantee(id: string, stage: string) {
    const a = store.applications.find((a) => a.id === id);
    if (!a || !profile) return false;
    if (terminal(stage)) {
      if (profile.role !== "admin") {
        setMessage("Solo administración puede confirmar decisiones formales.");
        return false;
      }
      setDecisionTarget({ id, stage });
      return false;
    }
    if (terminal(a.guarantee_stage) && profile.role !== "admin") {
      setMessage("Solo administración puede reabrir una decisión formal.");
      return false;
    }
    return mutate("applications", {
      id,
      guarantee_stage: stage,
      ...(terminal(a.guarantee_stage)
        ? {
            decision: "no_presentada",
            decision_date: null,
            decision_reference: null,
          }
        : {}),
    });
  }
  async function confirmDecision(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!decisionTarget || !profile) return;
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const reason = String(f.get("reason") || "");
      const date = String(f.get("date"));
      const reference = String(f.get("reference")).trim();
      if (
        !date ||
        !reference ||
        (decisionTarget.stage === "rechazada" &&
          !rejectionReasons.includes(
            reason as (typeof rejectionReasons)[number],
          ))
      )
        throw Error("Completá el respaldo y el motivo de rechazo.");
      if (supabase) {
        const r = await supabase.rpc("set_guarantee_decision", {
          a_id: decisionTarget.id,
          new_stage: decisionTarget.stage,
          reason: reason || null,
          confirmed_date: date,
          reference,
        });
        if (r.error) throw Error(r.error.message);
        await load();
      } else {
        let next = store;
        if (decisionTarget.stage === "rechazada")
          next = demoMutation(
            next,
            "sensitive",
            { application_id: decisionTarget.id, rejection_reason: reason },
            "upsert",
            "application_id",
            profile,
          );
        next = demoMutation(
          next,
          "applications",
          {
            id: decisionTarget.id,
            guarantee_stage: decisionTarget.stage,
            decision: decisionTarget.stage,
            decision_date: date,
            decision_reference: reference,
          },
          "update",
          "id",
          profile,
        );
        setStore(next);
      }
      setDecisionTarget(null);
      setMessage("");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setBusy(false);
    }
  }
  const allowed = store.applications.filter(
    (a) => profile && visible(a, profile),
  );
  const active = allowed.filter((a) => !a.archived);
  const list = allowed
    .filter((a) => a.archived === archived)
    .filter((a) =>
      `${a.full_name} ${a.phone}`.toLowerCase().includes(search.toLowerCase()),
    )
    .filter(
      (a) =>
        filter === "todos" ||
        (filter === "sin_asignar"
          ? a.assigned_user_id === null
          : a.stage === filter),
    )
    .filter((a) => completion === "todos" || a.completion === completion)
    .filter(
      (a) =>
        originFilter === "todos" || (a.source_id || "unknown") === originFilter,
    )
    .filter((a) => typeFilter === "todos" || a.guarantee_type === typeFilter)
    .filter((a) => owner === "todos" || a.assigned_user_id === owner)
    .sort((a, b) =>
      sort === "name"
        ? a.full_name.localeCompare(b.full_name)
        : b.created_at.localeCompare(a.created_at),
    );
  const current = allowed.find((a) => a.id === selected);
  const isAdmin = profile?.role === "admin";
  const navigate = (p: string) => {
    setPage(p);
    setSelected(null);
    setPreview(null);
    setFilter("todos");
    setSearch("");
    setCompletion("todos");
    setOriginFilter("todos");
    setTypeFilter("todos");
    setOwner("todos");
    setArchived(false);
  };
  async function addLead(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const now = new Date().toISOString();
    const a: Application = {
      id: crypto.randomUUID(),
      full_name: String(f.get("name")).trim(),
      phone: String(f.get("phone")).trim(),
      rent_amount: f.get("rent") ? Number(f.get("rent")) : null,
      rent_currency: f.get("rent") ? String(f.get("currency")) : null,
      guarantee_type: String(f.get("type")),
      assigned_user_id: isAdmin ? null : profile!.id,
      source: "manual",
      source_id: String(f.get("source_id")) || null,
      created_at: now,
      updated_at: now,
      completion: "carga_manual",
      contact_status: "no_contactado",
      stage: "nuevo",
      guarantee_stage: "sin_contactar",
      requested_date: String(f.get("requested_date") || "") || null,
      drive_folder_url: null,
      preapproval: "no_iniciada",
      documentation: "no_solicitada",
      decision: "no_presentada",
      summary: "",
      archived: false,
      attribution: {},
    };
    if (await mutate("applications", a, "insert")) {
      setModal(null);
      setSelected(a.id);
    }
  }
  if (!ready)
    return (
      <div className="loading">
        <ShieldCheck size={36} />
        <p>Preparando tu espacio de trabajo…</p>
      </div>
    );
  if (!profile) return <Login message={message} onMessage={setMessage} />;
  return (
    <div className="shell">
      <aside className="sidebar">
        <button
          className="brand official-brand"
          aria-label="Porto Seguro Corredores · Inicio"
          onClick={() => navigate("Inicio")}
        >
          <img
            className="brand-full"
            src="/brand/logo.svg"
            alt="Porto Seguro Corredores"
            width="180"
            height="40"
          />
          <img
            className="brand-compact"
            src="/brand/icon.svg"
            alt="Porto Seguro"
            width="36"
            height="36"
          />
        </button>
        <div className="workspace">
          <span className="workspace-icon">GP</span>
          <div>
            Gestión comercial<small>Espacio de trabajo</small>
          </div>
          <ChevronRight size={15} />
        </div>
        <span className="nav-caption">PRINCIPAL</span>
        <nav>
          {[
            ["Inicio", LayoutDashboard],
            ["Solicitudes", Inbox],
            ["Pipeline comercial", Columns3],
            ["Pipeline de garantía", FileCheck2],
            ...(isAdmin
              ? [
                  ["Equipo", Users],
                  ["Control de datos", Settings2],
                  ["Integraciones", Link2],
                ]
              : []),
          ].map(([name, Icon]) => {
            const I = Icon as typeof Inbox;
            return (
              <button
                key={String(name)}
                className={page === name ? "active" : ""}
                onClick={() => navigate(String(name))}
              >
                <I size={19} />
                {String(name)}
                {name === "Solicitudes" && (
                  <span className="nav-count">{active.length}</span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="security">
            <ShieldCheck size={19} />
            <div>
              Tu información, protegida
              <small>
                {demo ? "Entorno de demostración" : "Acceso privado por rol"}
              </small>
            </div>
          </div>
          <div className="user">
            <span className="avatar">{profile.full_name.slice(0, 1)}</span>
            <div>
              {profile.full_name}
              <small>{isAdmin ? "Administrador" : "Vendedor"}</small>
            </div>
            {!demo && (
              <button
                title="Cerrar sesión"
                onClick={() => supabase!.auth.signOut()}
              >
                <LogOut size={17} />
              </button>
            )}
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <span className="breadcrumb">
            Espacio de trabajo <ChevronRight size={14} />{" "}
            <strong>{current ? "Detalle de solicitud" : page}</strong>
          </span>
          <div className="top-actions">
            <span className="live-dot" />
            {demo ? "Demo · datos ficticios" : "Conectado"}
            <span className="mini-avatar">{profile.full_name[0]}</span>
          </div>
        </header>
        {demo && (
          <div className="demo-bar">
            <span>
              <strong>Demostración local</strong> · Datos ficticios guardados en
              este navegador. No es un sistema autenticado.
            </span>
            <select
              aria-label="Simular rol"
              value={profile.id}
              onChange={(e) => {
                setProfile(
                  store.profiles.find((p) => p.id === e.target.value)!,
                );
                setSelected(null);
                setPage("Inicio");
              }}
            >
              {store.profiles
                .filter((p) => p.active)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name}
                  </option>
                ))}
            </select>
          </div>
        )}
        <main>
          {message && (
            <div className="alert" role="alert">
              {message}
              <button onClick={() => setMessage("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {current ? (
            <CaseDetail
              key={current.id}
              app={current}
              store={store}
              profile={profile}
              busy={busy}
              mutate={mutate}
              back={() => setSelected(null)}
              guarantee={changeGuarantee}
            />
          ) : (
            <>
              {page !== "Inicio" && (
                <div className="page-heading">
                  <div>
                    <h1>{page}</h1>
                    <p>
                      {page === "Solicitudes"
                        ? "Todas tus solicitudes, organizadas en un solo lugar."
                        : page.startsWith("Pipeline")
                          ? "Seguí cada oportunidad a lo largo del proceso comercial."
                          : page === "Control de datos"
                            ? "Administrá los orígenes y los campos de tus solicitudes."
                            : page === "Equipo"
                              ? "Administrá accesos y responsabilidades."
                              : "Seguimiento de la recepción de formularios."}
                    </p>
                  </div>
                  {(page === "Solicitudes" || page.startsWith("Pipeline")) && (
                    <button
                      className="primary"
                      onClick={() => setModal("lead")}
                    >
                      <Plus size={18} />
                      Nueva solicitud
                    </button>
                  )}
                </div>
              )}
              {page.startsWith("Pipeline") && (
                <Pipeline
                  applications={active}
                  store={store}
                  busy={busy}
                  kind={
                    page === "Pipeline comercial" ? "commercial" : "guarantee"
                  }
                  admin={isAdmin}
                  now={now}
                  move={
                    page === "Pipeline comercial"
                      ? (id, stage) => mutate("applications", { id, stage })
                      : changeGuarantee
                  }
                  open={setPreview}
                />
              )}
              {page === "Inicio" && (
                <>
                  <div className="overview-line">
                    <h2>Resumen de actividad</h2>
                    <button
                      className="primary"
                      onClick={() => setModal("lead")}
                    >
                      <Plus size={18} />
                      Nueva solicitud
                    </button>
                  </div>
                  <div className="stats">
                    {[
                      {
                        label: "Solicitudes activas",
                        count: active.length,
                        icon: Inbox,
                        sub: "Tu cartera de oportunidades",
                        color: "blue",
                      },
                      {
                        label: "Sin contactar",
                        count: active.filter(
                          (a) => a.guarantee_stage === "sin_contactar",
                        ).length,
                        icon: Users,
                        sub: "El próximo paso empieza acá",
                        color: "orange",
                      },
                      {
                        label: "En preaprobación",
                        count: active.filter(
                          (a) => a.guarantee_stage === "preaprobacion_cargada",
                        ).length,
                        icon: FileCheck2,
                        sub: "Evaluación interna en curso",
                        color: "purple",
                      },
                      {
                        label: "Esperando documentación",
                        count: active.filter(
                          (a) =>
                            a.guarantee_stage === "documentacion_solicitada",
                        ).length,
                        icon: Clock,
                        sub: "Casos para seguir acompañando",
                        color: "green",
                      },
                    ].map((s) => (
                      <div className="stat" key={s.label}>
                        <div className="stat-top">
                          {s.label}
                          <span className={`stat-icon ${s.color}`}>
                            <s.icon size={19} />
                          </span>
                        </div>
                        <strong>{s.count.toString().padStart(2, "0")}</strong>
                        <small>{s.sub}</small>
                      </div>
                    ))}
                  </div>
                  <div className="attention">
                    <span className="attention-icon">
                      <Activity size={22} />
                    </span>
                    <div>
                      <strong>
                        {isAdmin
                          ? `${active.filter((a) => !a.assigned_user_id).length} solicitudes esperan un responsable`
                          : "Tu seguimiento hace la diferencia"}
                      </strong>
                      <p>
                        {isAdmin
                          ? "Asigná las nuevas solicitudes para que tu equipo pueda dar el siguiente paso."
                          : "Revisá tus solicitudes pendientes y registrá cada avance."}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setPage("Solicitudes");
                        setFilter(isAdmin ? "sin_asignar" : "nuevo");
                      }}
                    >
                      Revisar solicitudes <ArrowUpRight size={17} />
                    </button>
                  </div>
                </>
              )}
              {page === "Solicitudes" && (
                <section className="card table-card">
                  <div className="section-heading">
                    <div>
                      <h2>
                        Todas las solicitudes{" "}
                        <span className="count">{list.length}</span>
                      </h2>
                      <p>Nuevas, en proceso y finalizadas.</p>
                    </div>
                  </div>
                  <div className="table-tools">
                    <div className="tabs">
                      {[
                        ["todos", "Todas"],
                        ["nuevo", "Nuevas"],
                        ["en_contacto", "En contacto"],
                        ["finalizado", "Finalizados"],
                        ...(isAdmin ? [["sin_asignar", "Sin asignar"]] : []),
                      ].map(([v, l]) => (
                        <button
                          key={v}
                          className={filter === v ? "selected" : ""}
                          onClick={() => setFilter(v)}
                        >
                          {l}
                        </button>
                      ))}
                    </div>
                    <div className="search-tools">
                      <label className="search">
                        <Search size={16} />
                        <input
                          aria-label="Buscar solicitudes"
                          placeholder="Buscar nombre o celular…"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                      </label>
                      <button
                        className="secondary"
                        onClick={() => setShowFilters(!showFilters)}
                      >
                        <SlidersHorizontal size={16} />
                        Filtros
                      </button>
                    </div>
                  </div>
                  {showFilters && (
                    <div className="filters">
                      <label>
                        Origen
                        <select
                          value={originFilter}
                          onChange={(e) => setOriginFilter(e.target.value)}
                        >
                          <option value="todos">Todos los orígenes</option>
                          {store.sources.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name}
                            </option>
                          ))}
                          <option value="unknown">Sin identificar</option>
                        </select>
                      </label>
                      <label>
                        Tipo de garantía
                        <select
                          value={typeFilter}
                          onChange={(e) => setTypeFilter(e.target.value)}
                        >
                          <option value="todos">Todos los tipos</option>
                          {[
                            "tradicional",
                            "universitaria",
                            "rural",
                            "otra",
                          ].map((t) => (
                            <option key={t} value={t}>
                              {human(t)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Formulario
                        <select
                          value={completion}
                          onChange={(e) => setCompletion(e.target.value)}
                        >
                          <option value="todos">Todos</option>
                          {states.completion.map((s) => (
                            <option key={s} value={s}>
                              {human(s)}
                            </option>
                          ))}
                        </select>
                      </label>
                      {isAdmin && (
                        <label>
                          Responsable
                          <select
                            value={owner}
                            onChange={(e) => setOwner(e.target.value)}
                          >
                            <option value="todos">Todos</option>
                            {store.profiles.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.full_name}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      <label>
                        Orden
                        <select
                          value={sort}
                          onChange={(e) => setSort(e.target.value)}
                        >
                          <option value="recent">Más recientes</option>
                          <option value="name">Nombre A–Z</option>
                        </select>
                      </label>
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          checked={archived}
                          onChange={(e) => setArchived(e.target.checked)}
                        />
                        Archivadas
                      </label>
                    </div>
                  )}
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>CLIENTE / INGRESO</th>
                          <th>ALQUILER MENSUAL</th>
                          <th>ORIGEN</th>
                          <th>ESTADO COMERCIAL</th>
                          <th>PROCESO DE GARANTÍA</th>
                          <th>RESPONSABLE</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {list
                          .slice((pageNumber - 1) * 8, pageNumber * 8)
                          .map((a, i) => (
                            <tr key={a.id} onClick={() => setSelected(a.id)}>
                              <td>
                                <div className="client-cell">
                                  <span className={`avatar pastel-${i % 4}`}>
                                    {a.full_name
                                      .split(" ")
                                      .map((n) => n[0])
                                      .slice(0, 2)
                                      .join("")}
                                  </span>
                                  <div>
                                    <button
                                      className="client-name"
                                      onClick={() => setSelected(a.id)}
                                    >
                                      {a.full_name}
                                    </button>
                                    <small>
                                      {a.phone}{" "}
                                      <span>· {date(a.created_at)}</span>
                                      {needsFollowUp(a, now) && (
                                        <span className="followup-chip">
                                          Seguimiento pendiente · 48 h
                                        </span>
                                      )}
                                    </small>
                                  </div>
                                </div>
                              </td>
                              <td>
                                <strong className="rent">{money(a)}</strong>
                                <small>{human(a.guarantee_type)}</small>
                              </td>
                              <td>
                                <span className="source-label">
                                  {sourceName(a, store.sources)}
                                </span>
                              </td>
                              <td>
                                <Badge value={a.stage} />
                              </td>
                              <td>
                                <Badge
                                  value={a.guarantee_stage || "sin_contactar"}
                                />
                              </td>
                              <td>
                                {isAdmin ? (
                                  a.assigned_user_id ? (
                                    <span className="owner">
                                      <span className="owner-dot" />
                                      {store.profiles
                                        .find(
                                          (p) => p.id === a.assigned_user_id,
                                        )
                                        ?.full_name.split(" · ")[0] ||
                                        "Responsable"}
                                    </span>
                                  ) : (
                                    <span className="unassigned">
                                      Sin asignar
                                    </span>
                                  )
                                ) : (
                                  <span className="owner">
                                    {profile.full_name}
                                  </span>
                                )}
                              </td>
                              <td>
                                <ChevronRight size={17} />
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                    {list.length === 0 && (
                      <div className="empty">
                        <Inbox size={30} />
                        <h3>No hay solicitudes para esta vista</h3>
                        <p>Probá otros filtros o creá una nueva solicitud.</p>
                      </div>
                    )}
                  </div>
                  <div className="table-footer">
                    <span>
                      {list.length
                        ? `${(pageNumber - 1) * 8 + 1}–${Math.min(pageNumber * 8, list.length)}`
                        : "0"}{" "}
                      de {list.length} solicitudes
                    </span>
                    <div>
                      <button
                        disabled={pageNumber === 1}
                        onClick={() => setPageNumber((n) => n - 1)}
                      >
                        Anterior
                      </button>
                      <span>{pageNumber}</span>
                      <button
                        disabled={pageNumber * 8 >= list.length}
                        onClick={() => setPageNumber((n) => n + 1)}
                      >
                        Siguiente
                      </button>
                    </div>
                  </div>
                </section>
              )}
              {page === "Inicio" && (
                <ApprovalMetrics
                  applications={active}
                  sources={store.sources}
                />
              )}
              {page === "Inicio" && (
                <div className="bottom-note">
                  <ShieldCheck size={15} />
                  La preaprobación interna no implica aprobación formal de Porto
                  Seguro.
                </div>
              )}
              {page === "Equipo" && isAdmin && (
                <section className="card padded">
                  <h2>Personas y permisos</h2>
                  <p className="muted">
                    Creá cuentas privadas y gestioná los permisos de tu equipo.
                    No hay registro público.
                  </p>
                  <UserCreator
                    done={() => load().catch((e) => setMessage(e.message))}
                  />
                  {store.profiles.map((p) => (
                    <div className="team-row" key={p.id}>
                      <span className="avatar">{p.full_name[0]}</span>
                      <div className="grow">
                        <strong>{p.full_name}</strong>
                        <small>
                          {human(
                            p.role === "admin" ? "administrador" : "vendedor",
                          )}
                        </small>
                      </div>
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          disabled={p.role === "admin" || busy}
                          checked={p.can_clearing}
                          onChange={(e) =>
                            mutate("profiles", {
                              id: p.id,
                              can_clearing: e.target.checked,
                            })
                          }
                        />
                        Permiso de Clearing
                      </label>
                      <button
                        className="secondary"
                        disabled={p.id === profile.id || busy}
                        onClick={() =>
                          mutate("profiles", { id: p.id, active: !p.active })
                        }
                      >
                        {p.active ? "Desactivar" : "Activar"}
                      </button>
                    </div>
                  ))}
                </section>
              )}
              {page === "Control de datos" && isAdmin && (
                <SourceManager
                  sources={store.sources}
                  busy={busy}
                  save={(v, m) => mutate("sources", v, m)}
                />
              )}
              {page === "Control de datos" && isAdmin && (
                <section className="card padded">
                  <div className="section-heading">
                    <h2>Campos personalizados</h2>
                    <button
                      className="primary"
                      onClick={() => setModal("field")}
                    >
                      <Plus size={16} />
                      Crear campo
                    </button>
                  </div>
                  {store.fields.length === 0 && (
                    <div className="empty">
                      <Settings2 />
                      <h3>Una ficha que se adapta a tu equipo</h3>
                      <p>
                        Agregá campos de texto, números, fechas, opciones o
                        sí/no.
                      </p>
                    </div>
                  )}
                  {store.fields.map((f) => (
                    <div className="team-row" key={f.id}>
                      <div className="grow">
                        <strong>{f.label}</strong>
                        <small>
                          {f.type} ·{" "}
                          {f.sensitive
                            ? "Solo administración"
                            : "Visible en solicitudes asignadas"}
                        </small>
                      </div>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() =>
                          mutate("fields", { id: f.id, archived: !f.archived })
                        }
                      >
                        {f.archived ? "Restaurar" : "Archivar"}
                      </button>
                    </div>
                  ))}
                </section>
              )}
              {page === "Integraciones" && isAdmin && (
                <section className="card padded">
                  <span className="badge parte_1_recibida">
                    Conexión con la web pendiente
                  </span>
                  <h2>Recepción de eventos</h2>
                  <p>
                    El receptor está implementado y deshabilitado por defecto.
                    La web, sus correos y Google Ads permanecen sin cambios.
                  </p>
                  <p className="muted">
                    Los eventos de prueba se envían con firma al endpoint
                    /api/integration/events. Ver docs/INTEGRATION.md.
                  </p>
                  <button
                    className="secondary"
                    onClick={async () => {
                      if (!supabase) {
                        setMessage(
                          "La demo no recibe eventos externos. Usá el simulador documentado contra un backend de pruebas.",
                        );
                        return;
                      }
                      const r = await supabase
                        .from("integration_attempts")
                        .select("id,status,code,created_at")
                        .order("created_at", { ascending: false })
                        .limit(50);
                      if (r.error) setMessage(r.error.message);
                      else setIntegration(r.data || []);
                    }}
                  >
                    <RefreshCw size={16} />
                    Consultar entregas
                  </button>
                  {integration.map((r, i) => (
                    <div className="team-row" key={i}>
                      {String(r.status)} · {String(r.code || "OK")} ·{" "}
                      {date(String(r.created_at))}
                    </div>
                  ))}
                </section>
              )}
            </>
          )}
        </main>
        <footer>
          © {new Date().getFullYear()} Garantía Porto{" "}
          <span>CRM · Gestión de solicitudes</span>
        </footer>
      </div>
      {preview && allowed.find((a) => a.id === preview) && (
        <Dialog
          title="Vista previa del cliente"
          drawer
          close={() => setPreview(null)}
        >
          <CaseDetail
            key={preview}
            compact
            app={allowed.find((a) => a.id === preview)!}
            store={store}
            profile={profile}
            busy={busy}
            mutate={mutate}
            guarantee={changeGuarantee}
          />
        </Dialog>
      )}
      {decisionTarget && (
        <Dialog
          title={
            decisionTarget.stage === "rechazada"
              ? "Confirmar rechazo"
              : "Confirmar aprobación"
          }
          close={() => setDecisionTarget(null)}
        >
          <form onSubmit={confirmDecision}>
            <p className="muted">
              Registrá la decisión formal confirmada por Porto Seguro. No
              modifica el estado comercial.
            </p>
            {decisionTarget.stage === "rechazada" && (
              <label>
                Motivo del rechazo
                <select name="reason" required defaultValue="">
                  <option value="" disabled>
                    Seleccionar motivo
                  </option>
                  {rejectionReasons.map((r) => (
                    <option key={r} value={r}>
                      {human(r)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Fecha de decisión
              <input
                name="date"
                type="date"
                required
                defaultValue={todayUy()}
              />
            </label>
            <label>
              Referencia o respaldo
              <textarea name="reference" required maxLength={2000} />
            </label>
            {message && <p role="alert">{message}</p>}
            <button className="primary" disabled={busy}>
              Confirmar decisión
            </button>
          </form>
        </Dialog>
      )}
      {modal && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={modal === "lead" ? "Nueva solicitud" : "Nuevo campo"}
          >
            <div className="section-heading">
              <h2>{modal === "lead" ? "Nueva solicitud" : "Nuevo campo"}</h2>
              <button aria-label="Cerrar" onClick={() => setModal(null)}>
                <X />
              </button>
            </div>
            {modal === "lead" ? (
              <form onSubmit={addLead}>
                <p className="muted">
                  Comenzá con lo esencial. Podés completar los demás datos
                  después.
                </p>
                <label>
                  Fecha de solicitud
                  <input
                    name="requested_date"
                    type="date"
                    defaultValue={todayUy()}
                  />
                </label>
                <label>
                  Nombre completo
                  <input name="name" required maxLength={200} />
                </label>
                <label>
                  Celular
                  <input name="phone" required minLength={3} maxLength={40} />
                </label>
                <div className="form-grid">
                  <label>
                    Alquiler mensual
                    <input name="rent" type="number" min="0" step="0.01" />
                  </label>
                  <label>
                    Moneda
                    <select name="currency">
                      <option>UYU</option>
                      <option>USD</option>
                    </select>
                  </label>
                </div>
                <label>
                  Origen del cliente
                  <select name="source_id" required defaultValue="">
                    <option value="" disabled>
                      Seleccionar origen
                    </option>
                    {store.sources
                      .filter((o) => !o.archived)
                      .map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Tipo de garantía
                  <select name="type">
                    <option value="tradicional">Tradicional</option>
                    <option value="universitaria">Universitaria</option>
                    <option value="rural">Rural</option>
                    <option value="otra">Otra</option>
                  </select>
                </label>
                <button className="primary wide" disabled={busy}>
                  Crear solicitud
                </button>
              </form>
            ) : (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const d = new FormData(e.currentTarget);
                  if (
                    await mutate(
                      "fields",
                      {
                        id: crypto.randomUUID(),
                        label: d.get("label"),
                        type: d.get("type"),
                        options: String(d.get("options"))
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                        sensitive: d.get("sensitive") === "on",
                        archived: false,
                      },
                      "insert",
                    )
                  )
                    setModal(null);
                }}
              >
                <label>
                  Etiqueta
                  <input name="label" required maxLength={100} />
                </label>
                <label>
                  Tipo
                  <select name="type">
                    <option value="text">Texto</option>
                    <option value="number">Número</option>
                    <option value="date">Fecha</option>
                    <option value="select">Selector</option>
                    <option value="boolean">Sí / No</option>
                  </select>
                </label>
                <label>
                  Opciones (para selector, separadas por coma)
                  <input name="options" />
                </label>
                <label className="checkbox">
                  <input type="checkbox" name="sensitive" />
                  Información sensible: solo administración
                </label>
                <button className="primary wide" disabled={busy}>
                  Guardar campo
                </button>
              </form>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
export function Login({
  message,
  onMessage,
}: {
  message: string;
  onMessage: (s: string) => void;
}) {
  const [reset, setReset] = useState(false),
    [recovery, setRecovery] = useState(false),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const { data } = supabase!.auth.onAuthStateChange((e) => {
      if (e === "PASSWORD_RECOVERY") setRecovery(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  return (
    <div className="login">
      <div className="login-art">
        <img
          src="/brand/logo-white.svg"
          alt="Porto Seguro Corredores"
          width="260"
          height="60"
        />
        <h1>
          Cada solicitud.
          <br />
          Una nueva oportunidad.
        </h1>
        <p>
          El espacio de tu equipo para acompañar a quienes buscan su próximo
          hogar.
        </p>
      </div>
      <form
        className="login-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const f = new FormData(e.currentTarget);
          const email = String(f.get("email"));
          const r = recovery
            ? await supabase!.auth.updateUser({
                password: String(f.get("password")),
              })
            : reset
              ? await supabase!.auth.resetPasswordForEmail(email, {
                  redirectTo: window.location.origin + "/login",
                })
              : await supabase!.auth.signInWithPassword({
                  email,
                  password: String(f.get("password")),
                });
          onMessage(
            r.error
              ? "No se pudo completar la operación. Verificá los datos o contactá a administración."
              : reset
                ? "Si la cuenta existe, recibirás las instrucciones de recuperación."
                : recovery
                  ? "Contraseña actualizada."
                  : "",
          );
          setBusy(false);
          if (!r.error && !reset) window.location.assign("/");
        }}
      >
        <div className="eyebrow">GARANTÍA PORTO</div>
        <h1>
          {recovery
            ? "Nueva contraseña"
            : reset
              ? "Recuperá tu acceso"
              : "Bienvenido a tu CRM"}
        </h1>
        <p className="muted">Acceso exclusivo para el equipo autorizado.</p>
        {message && <p role="alert">{message}</p>}
        {!recovery && (
          <label>
            Email
            <input type="email" name="email" autoComplete="username" required />
          </label>
        )}
        {(!reset || recovery) && (
          <label>
            Contraseña
            <input
              type="password"
              name="password"
              minLength={12}
              autoComplete={recovery ? "new-password" : "current-password"}
              required
            />
          </label>
        )}
        <button className="primary wide" disabled={busy}>
          {recovery
            ? "Guardar contraseña"
            : reset
              ? "Enviar instrucciones"
              : "Ingresar al panel"}
        </button>
        {!recovery && (
          <button
            type="button"
            className="text-button"
            onClick={() => setReset(!reset)}
          >
            {reset ? "Volver al acceso" : "Olvidé mi contraseña"}
          </button>
        )}
      </form>
    </div>
  );
}
