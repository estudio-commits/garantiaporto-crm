import { test, expect, type Page } from "@playwright/test";
const nav = (page: Page, name: string) =>
  page.locator("nav").getByRole("button", { name, exact: true });
async function pipeline(page: Page, guarantee = false) {
  await nav(page, "Pipeline").click();
  await page
    .getByRole("button", {
      name: guarantee ? "Gestión de garantía" : "Gestión comercial",
      exact: true,
    })
    .click();
}
const client = (page: Page, name = "Lucía Ejemplo") =>
  page.getByRole("button", { name, exact: true });
test("home contains only three shortcuts, unified navigation and filtered destinations", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "¿Querés cargar una nueva solicitud?" }),
  ).toBeVisible();
  await expect(page.locator(".home-shortcut")).toHaveCount(3);
  await expect(page.locator(".new-leads")).toContainText("4 nuevas");
  await expect(
    page
      .locator("nav button")
      .evaluateAll((nodes) =>
        nodes.slice(0, 4).map((n) => n.textContent?.replace(/\d+$/, "")),
      ),
  ).resolves.toEqual([
    "Inicio",
    "Pipeline",
    "Lista de clientes",
    "Estadísticas",
  ]);
  await page
    .getByRole("button", { name: "Ir a solicitudes", exact: true })
    .click();
  await expect(page.getByRole("region", { name: /^Etapa / })).toHaveCount(3);
  await nav(page, "Inicio").click();
  await page.getByRole("button", { name: "Ir a preaprobaciones" }).click();
  await expect(page.getByLabel("Filtrar etapa")).toHaveValue(
    "documentacion_recibida",
  );
  await expect(page.getByRole("article", { name: /^Solicitud / })).toHaveCount(
    2,
  );
  await nav(page, "Inicio").click();
  await page.getByRole("button", { name: "Ir a emisiones" }).click();
  await expect(page.getByLabel("Filtrar etapa")).toHaveValue("aprobada");
});
test("manual identity, Drive, dates and typed comments persist with seller isolation", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Nueva solicitud", exact: true })
    .click();
  await page.getByLabel("Nombre completo").fill("Caso Ficticio Navegador");
  await page.getByLabel("Cédula de identidad").fill("000.000-0");
  await page.getByLabel("Celular", { exact: true }).fill("000999888");
  await page
    .getByLabel("Origen del cliente")
    .selectOption({ label: "Negocio inmobiliario" });
  await page
    .getByLabel("Fecha de solicitud", { exact: true })
    .fill("2026-10-20");
  await page
    .getByRole("button", { name: "Crear solicitud", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Caso Ficticio Navegador", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Cédula de identidad")).toHaveValue("000.000-0");
  await expect(page.locator(".case-dates")).toContainText("2026-10-20");
  await page
    .getByLabel("Asignar responsable")
    .selectOption({ label: "Ana · Vendedora Demo" });
  await page
    .getByLabel("Carpeta de Google Drive")
    .fill("https://drive.google.com/drive/folders/demo-folder");
  await page
    .getByRole("button", { name: "Guardar datos", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Abrir carpeta de documentación" }),
  ).toHaveAttribute(
    "href",
    "https://drive.google.com/drive/folders/demo-folder",
  );
  await page
    .getByRole("button", { name: "Historial y seguimientos", exact: true })
    .click();
  await page.getByLabel("Tipo de comentario").selectOption("comunicacion");
  await expect(page.getByLabel("Texto del comentario")).toHaveValue(
    "Seguimiento #1",
  );
  await page.getByLabel("Texto del comentario").fill("Comunicación ficticia");
  await page
    .getByRole("button", { name: "Guardar comentario", exact: true })
    .click();
  await expect(
    page.getByText("Comunicación ficticia", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByLabel("Simular rol")
    .selectOption({ label: "Ana · Vendedora Demo" });
  await expect(nav(page, "Equipo")).toHaveCount(0);
  await page
    .locator("nav")
    .getByRole("button", { name: /^Lista de clientes/ })
    .click();
  await page.getByLabel("Buscar solicitudes").fill("000.000-0");
  await client(page, "Caso Ficticio Navegador").click();
  await expect(page.getByLabel("Asignar responsable")).toHaveCount(0);
  await expect(page.getByLabel("Cédula de identidad")).toHaveValue("000.000-0");
});
test("independent boards drag, preview and full card content without move selector", async ({
  page,
}) => {
  await page.goto("/");
  await pipeline(page);
  const card = page.getByRole("article", {
    name: "Solicitud Lucía Ejemplo",
    exact: true,
  });
  await expect(card).toContainText("Tipo de garantía: Universitaria");
  await expect(card).toContainText("Cédula: 0.000.000-0");
  await expect(card).toContainText("Ingreso:");
  await expect(card.locator("select")).toHaveCount(0);
  await card.dragTo(
    page.getByRole("region", { name: "Etapa En contacto", exact: true }),
    { sourcePosition: { x: 220, y: 20 }, targetPosition: { x: 100, y: 20 } },
  );
  await client(page).click();
  const drawer = page.getByRole("dialog", { name: "Vista previa del cliente" });
  await expect(
    drawer.getByLabel("Estado comercial", { exact: true }),
  ).toHaveValue("en_contacto");
  await expect(
    drawer.getByLabel("Proceso de la garantía", { exact: true }),
  ).toHaveValue("sin_contactar");
  await drawer
    .getByLabel("Proceso de la garantía", { exact: true })
    .selectOption("documentacion_recibida");
  await drawer.getByRole("button", { name: "Cerrar vista previa" }).click();
  await page
    .getByRole("button", { name: "Gestión de garantía", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", {
        name: "Etapa Recibimos documentación",
        exact: true,
      })
      .getByRole("article", { name: "Solicitud Lucía Ejemplo", exact: true }),
  ).toBeVisible();
  await page.reload();
  await pipeline(page, true);
  await client(page).click();
  await expect(
    page.getByLabel("Estado comercial", { exact: true }),
  ).toHaveValue("en_contacto");
  await expect(
    page.getByLabel("Proceso de la garantía", { exact: true }),
  ).toHaveValue("documentacion_recibida");
});
test("rejection requires reason and evidence and preserves commercial stage", async ({
  page,
}) => {
  await page.goto("/");
  await pipeline(page, true);
  await client(page).click();
  await page
    .getByLabel("Proceso de la garantía", { exact: true })
    .selectOption("rechazada");
  const dialog = page.getByRole("dialog", { name: "Confirmar rechazo" });
  await dialog.getByRole("button", { name: "Confirmar decisión" }).click();
  await expect(dialog).toBeVisible();
  await dialog
    .getByLabel("Motivo del rechazo")
    .selectOption("ingresos_insuficientes");
  await dialog.getByLabel("Referencia o respaldo").fill("Referencia ficticia");
  await dialog.getByRole("button", { name: "Confirmar decisión" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByLabel("Estado comercial", { exact: true }),
  ).toHaveValue("nuevo");
  await expect(
    page.getByText("Motivo del rechazo: Ingresos insuficientes"),
  ).toBeVisible();
  await expect(page.locator(".followup-banner")).toHaveCount(0);
  await page.getByRole("button", { name: "Cerrar vista previa" }).click();
  await page
    .getByLabel("Simular rol")
    .selectOption({ label: "Ana · Vendedora Demo" });
  await pipeline(page, true);
  await client(page, "Bruno Demostración").click();
  await expect(
    page
      .getByLabel("Proceso de la garantía", { exact: true })
      .locator('option[value="aprobada"]'),
  ).toHaveJSProperty("disabled", true);
});
test("daily alert survives data edits, new comment clears it and moves card first", async ({
  page,
}) => {
  await page.goto("/");
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(localStorage.getItem("porto-demo-v1"))),
    )
    .toBe(true);
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("porto-demo-v1")!);
    const a = s.applications.find(
      (a: { full_name: string }) => a.full_name === "Santiago Demo",
    );
    a.created_at = "2020-01-01T00:00:00Z";
    a.updated_at = a.created_at;
    localStorage.setItem("porto-demo-v1", JSON.stringify(s));
  });
  await page.reload();
  await pipeline(page, true);
  const card = page.getByRole("article", {
    name: "Solicitud Santiago Demo",
    exact: true,
  });
  await expect(card).toContainText("Seguimiento urgente");
  await client(page, "Santiago Demo").click();
  const d = page.getByRole("dialog", { name: "Vista previa del cliente" });
  await d.getByLabel("Celular", { exact: true }).fill("000777777");
  await d.getByRole("button", { name: "Guardar datos", exact: true }).click();
  await expect(d.locator(".followup-banner")).toBeVisible();
  await d.getByRole("button", { name: "Cerrar vista previa" }).click();
  await card.getByRole("button", { name: "Agregar comentario" }).click();
  const comment = page.getByRole("dialog", { name: "Agregar comentario" });
  await expect(comment.getByLabel("Texto del comentario")).toHaveValue(
    "A la espera de...",
  );
  await comment.getByLabel("Tipo de comentario").selectOption("actualizacion");
  await expect(comment.getByLabel("Texto del comentario")).toHaveValue(
    "Solicitando más documentación",
  );
  await comment.getByRole("button", { name: "Guardar comentario" }).click();
  await expect(comment).toHaveCount(0);
  await expect(card.locator(".followup-chip")).toHaveCount(0);
  await expect(
    page
      .getByRole("region", {
        name: "Etapa Recibimos documentación",
        exact: true,
      })
      .getByRole("article")
      .first(),
  ).toHaveAttribute("aria-label", "Solicitud Santiago Demo");
  await client(page, "Santiago Demo").click();
  await d.getByRole("button", { name: "Historial y seguimientos" }).click();
  await expect(
    d.getByText("Solicitando más documentación", { exact: true }),
  ).toBeVisible();
});
test("marketing tab and statistics provide attribution, cohort filters and seller scope", async ({
  page,
}) => {
  await page.goto("/");
  await pipeline(page);
  await client(page).click();
  await page.getByRole("button", { name: "Marketing", exact: true }).click();
  await expect(page.locator(".marketing-values")).toContainText(
    "Campaña ficticia",
  );
  await page.getByRole("button", { name: "Cerrar vista previa" }).click();
  await nav(page, "Estadísticas").click();
  await expect(
    page.getByRole("heading", { name: "Rendimiento de gestión" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Motivos de rechazo" }),
  ).toBeVisible();
  await page.getByLabel("Ingreso desde").fill("2099-01-01");
  await expect(
    page.getByText("No hay solicitudes para este período."),
  ).toHaveCount(3);
  await page
    .getByLabel("Simular rol")
    .selectOption({ label: "Ana · Vendedora Demo" });
  await nav(page, "Estadísticas").click();
  await expect(
    page.getByRole("heading", { name: "Motivos de rechazo" }),
  ).toHaveCount(0);
});
test("mobile preview, source management and disabled integration", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await nav(page, "Control de datos").click();
  await page
    .getByLabel("Nuevo origen", { exact: true })
    .fill("Referidos ficticios");
  await page.getByRole("button", { name: "Agregar origen" }).click();
  await expect(
    page.getByLabel("Nombre del origen Referidos ficticios"),
  ).toBeVisible();
  await pipeline(page);
  await client(page).click();
  await expect(
    page.getByRole("dialog", { name: "Vista previa del cliente" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    (await request.post("/api/integration/events", { data: {} })).status(),
  ).toBe(503);
});
