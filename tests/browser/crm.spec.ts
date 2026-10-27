import { test, expect } from "@playwright/test";
const nav = (page: import("@playwright/test").Page, name: string) =>
  page.locator("nav").getByRole("button", { name, exact: true });
test("manual case dates, Drive link and follow-ups persist and seller stays isolated", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Nueva solicitud", exact: true })
    .click();
  await page.getByLabel("Nombre completo").fill("Caso Ficticio Navegador");
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
  await page.getByLabel("Nueva nota").fill("Seguimiento ficticio");
  await page.getByRole("button", { name: "Agregar nota", exact: true }).click();
  await expect(
    page.getByText("Seguimiento ficticio", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".audit-changes").filter({ hasText: "Responsable" }),
  ).toHaveCount(1);
  await expect(
    page.locator(".audit-changes").filter({ hasText: "Carpeta de Drive" }),
  ).toHaveCount(1);
  await page.reload();
  await page
    .getByLabel("Simular rol")
    .selectOption({ label: "Ana · Vendedora Demo" });
  await expect(nav(page, "Equipo")).toHaveCount(0);
  await page
    .locator("nav")
    .getByRole("button", { name: /^Solicitudes/ })
    .click();
  await page.getByLabel("Buscar solicitudes").fill("Caso Ficticio");
  await page
    .getByRole("button", { name: "Caso Ficticio Navegador", exact: true })
    .click();
  await expect(page.getByLabel("Asignar responsable")).toHaveCount(0);
});
test("two pipelines are independent, drag persists and preview stays on board", async ({
  page,
}) => {
  await page.goto("/");
  await nav(page, "Pipeline comercial").click();
  await expect(page.getByRole("region", { name: /^Etapa / })).toHaveCount(3);
  const card = page.getByRole("article", {
    name: "Solicitud Lucía Ejemplo",
    exact: true,
  });
  await card.dragTo(
    page.getByRole("region", { name: "Etapa En contacto", exact: true }),
    { sourcePosition: { x: 220, y: 20 }, targetPosition: { x: 100, y: 20 } },
  );
  await expect(
    page
      .getByRole("region", { name: "Etapa En contacto", exact: true })
      .getByRole("article", { name: "Solicitud Lucía Ejemplo", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Lucía Ejemplo", exact: true })
    .click();
  const drawer = page.getByRole("dialog", { name: "Vista previa del cliente" });
  await expect(drawer).toBeVisible();
  await expect(
    drawer.getByLabel("Estado comercial", { exact: true }),
  ).toHaveValue("en_contacto");
  await expect(
    drawer.getByLabel("Proceso de la garantía", { exact: true }),
  ).toHaveValue("sin_contactar");
  await drawer.getByRole("button", { name: "Cerrar vista previa" }).click();
  await nav(page, "Pipeline de garantía").click();
  await expect(page.getByRole("region", { name: /^Etapa / })).toHaveCount(6);
  await page
    .getByLabel("Etapa de Lucía Ejemplo", { exact: true })
    .selectOption("documentacion_recibida");
  await page.reload();
  await nav(page, "Pipeline de garantía").click();
  await page
    .getByRole("button", { name: "Lucía Ejemplo", exact: true })
    .click();
  await expect(
    page.getByLabel("Estado comercial", { exact: true }),
  ).toHaveValue("en_contacto");
  await expect(
    page.getByLabel("Proceso de la garantía", { exact: true }),
  ).toHaveValue("documentacion_recibida");
});
test("rejection requires reason and evidence; it never finalizes the commercial process", async ({
  page,
}) => {
  await page.goto("/");
  await nav(page, "Pipeline de garantía").click();
  await page
    .getByLabel("Etapa de Lucía Ejemplo", { exact: true })
    .selectOption("rechazada");
  const dialog = page.getByRole("dialog", { name: "Confirmar rechazo" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Confirmar decisión" }).click();
  await expect(dialog).toBeVisible();
  await dialog
    .getByLabel("Motivo del rechazo")
    .selectOption("ingresos_insuficientes");
  await dialog
    .getByLabel("Referencia o respaldo")
    .fill("Referencia ficticia de decisión");
  await dialog.getByRole("button", { name: "Confirmar decisión" }).click();
  await expect(dialog).toHaveCount(0);
  await page
    .getByRole("button", { name: "Lucía Ejemplo", exact: true })
    .click();
  await expect(
    page.getByLabel("Estado comercial", { exact: true }),
  ).toHaveValue("nuevo");
  await expect(
    page.getByText("Motivo del rechazo: Ingresos insuficientes"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cerrar vista previa" }).click();
  await page
    .getByLabel("Simular rol")
    .selectOption({ label: "Ana · Vendedora Demo" });
  await nav(page, "Pipeline de garantía").click();
  const sel = page.getByLabel("Etapa de Bruno Demostración", { exact: true });
  await expect(sel.locator('option[value="aprobada"]')).toHaveJSProperty(
    "disabled",
    true,
  );
});
test("follow-up banner resets on meaningful edits and newest card goes first", async ({
  page,
}) => {
  await page.goto("/");
  await nav(page, "Pipeline de garantía").click();
  const card = page.getByRole("article", {
    name: "Solicitud Santiago Demo",
    exact: true,
  });
  await expect(card).toContainText("48 h sin cambios");
  await page
    .getByRole("button", { name: "Santiago Demo", exact: true })
    .click();
  const d = page.getByRole("dialog", { name: "Vista previa del cliente" });
  await expect(d.locator(".followup-banner")).toBeVisible();
  await d.getByRole("button", { name: "Guardar datos", exact: true }).click();
  await expect(d.locator(".followup-banner")).toBeVisible();
  await d.getByLabel("Celular", { exact: true }).fill("000777777");
  await d.getByRole("button", { name: "Guardar datos", exact: true }).click();
  await expect(d.locator(".followup-banner")).toHaveCount(0);
  await d
    .getByRole("button", { name: "Historial y seguimientos", exact: true })
    .click();
  await expect(d.locator(".audit-changes")).toContainText(["Celular"]);
  await d.getByRole("button", { name: "Cerrar vista previa" }).click();
  const column = page.getByRole("region", {
    name: "Etapa Recibimos documentación",
    exact: true,
  });
  await expect(column.getByRole("article").first()).toHaveAttribute(
    "aria-label",
    "Solicitud Santiago Demo",
  );
  await page.screenshot({ path: "/tmp/porto-garantia-v3.png", fullPage: true });
});
test("mobile pipeline preview, source management and disabled integration", async ({
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
  await nav(page, "Pipeline comercial").click();
  await page
    .getByRole("button", { name: "Lucía Ejemplo", exact: true })
    .click();
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
