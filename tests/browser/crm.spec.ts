import { test, expect } from "@playwright/test";
test("manual case persists, notes are appended, seller demo isolates assigned cases", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Resumen de actividad" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Nueva solicitud", exact: true })
    .click();
  await page.getByLabel("Nombre completo").fill("Caso Ficticio Navegador");
  await page.getByLabel("Celular", { exact: true }).fill("000999888");
  await page
    .getByLabel("Origen del cliente")
    .selectOption({ label: "Negocio inmobiliario" });
  await page
    .getByRole("button", { name: "Crear solicitud", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Caso Ficticio Navegador", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Asignar responsable")
    .selectOption({ label: "Ana · Vendedora Demo" });
  await page.getByRole("button", { name: "Seguimiento", exact: true }).click();
  await page.getByLabel("Nueva nota").fill("Seguimiento ficticio de prueba");
  await page.getByRole("button", { name: "Agregar nota" }).click();
  await expect(
    page.getByText("Seguimiento ficticio de prueba", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByLabel("Simular rol")
    .selectOption({ label: "Ana · Vendedora Demo" });
  await expect(
    page.getByRole("button", { name: "Equipo", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Solicitudes", exact: false })
    .first()
    .click();
  await page.getByLabel("Buscar solicitudes").fill("Caso Ficticio");
  await page.getByRole("button", { name: "Caso Ficticio Navegador" }).click();
  await expect(
    page.getByRole("heading", { name: "Clearing · Registro manual" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Asignar responsable")).toHaveCount(0);
});
test("mobile layout and disabled integration", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Nueva solicitud", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.getByRole("button", {name:"Pipeline",exact:true}).click();
  await expect(page.getByLabel("Etapa de Lucía Ejemplo", {exact:true})).toBeVisible();
  await page.getByLabel("Etapa de Lucía Ejemplo", {exact:true}).selectOption("en_preaprobacion");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  const r = await request.post("/api/integration/events", { data: {} });
  expect(r.status()).toBe(503);
});

test("pipeline drag, accessible stage selector and list stay synchronized after reload", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Resumen de actividad" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Cada solicitud, un nuevo comienzo." }),
  ).toHaveCount(0);
  await expect(page.getByRole("table")).toHaveCount(0);
  await page.evaluate(()=>document.fonts.ready);
  expect(await page.evaluate(()=>document.fonts.check('14px Roobert'))).toBeTruthy();
  await expect(page.locator('.brand-full')).toBeVisible();
  expect(await page.locator('.brand-full').evaluate((img:HTMLImageElement)=>img.naturalWidth>0)).toBeTruthy();
  await page.screenshot({path:'/tmp/porto-inicio-v2.png',fullPage:true});

  await page.getByRole("button", { name: "Pipeline", exact: true }).click();
  const card = page.getByRole("article", {
    name: "Solicitud Lucía Ejemplo",
    exact: true,
  });
  await expect(card).toContainText("Negocio inmobiliario");
  await expect(card).toContainText("Universitaria");
  await card.dragTo(
    page.getByRole("region", { name: "Etapa En preaprobación", exact: true }),
    { sourcePosition: { x: 220, y: 20 }, targetPosition: { x: 100, y: 20 } },
  );
  await expect(
    page
      .getByRole("region", { name: "Etapa En preaprobación", exact: true })
      .getByRole("article", { name: "Solicitud Lucía Ejemplo", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Etapa de Lucía Ejemplo", { exact: true })
    .selectOption("finalizado");
  await page
    .getByRole("button", { name: /^Solicitudes/ })
    .first()
    .click();
  await page.getByLabel("Buscar solicitudes").fill("Lucía");
  await expect(
    page.getByRole("row").filter({
      has: page.getByRole("button", { name: "Lucía Ejemplo", exact: true }),
    }),
  ).toContainText("Finalizado");
  await expect(
    page.getByRole("columnheader", { name: "ORIGEN", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Pipeline", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Etapa Finalizado", exact: true })
      .getByRole("article", { name: "Solicitud Lucía Ejemplo", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "/tmp/porto-pipeline-v2.png", fullPage: true });
});

test("admin can add an origin and use it on a rural request without changing capture channel", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Control de datos", exact: true })
    .click();
  await page
    .getByLabel("Nuevo origen", { exact: true })
    .fill("Referidos de prueba");
  await page
    .getByRole("button", { name: "Agregar origen", exact: true })
    .click();
  await expect(
    page.getByLabel("Nombre del origen Referidos de prueba"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /^Solicitudes/ })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Nueva solicitud", exact: true })
    .click();
  await page.getByLabel("Nombre completo").fill("Cliente Rural Ficticio");
  await page.getByLabel("Celular", { exact: true }).fill("000888");
  await page
    .getByLabel("Origen del cliente")
    .selectOption({ label: "Referidos de prueba" });
  await page.getByLabel("Tipo de garantía").selectOption("rural");
  await page
    .getByRole("button", { name: "Crear solicitud", exact: true })
    .click();
  await page.getByRole("button", { name: "Origen", exact: true }).click();
  await expect(
    page.getByText("Origen del cliente: Referidos de prueba"),
  ).toBeVisible();
  await expect(page.getByText("Medio de carga: Manual")).toBeVisible();
  await page
    .getByRole("button", { name: "Control de datos", exact: true })
    .click();
  const row = page
    .locator(".source-row")
    .filter({ has: page.getByLabel("Nombre del origen Referidos de prueba") });
  await row.getByRole("button", { name: "Archivar", exact: true }).click();
  await page.getByRole("button", { name: "Pipeline", exact: true }).click();
  await expect(
    page.getByRole("article", {
      name: "Solicitud Cliente Rural Ficticio",
      exact: true,
    }),
  ).toContainText("Referidos de prueba");
  await page
    .getByRole("button", { name: "Nueva solicitud", exact: true })
    .click();
  await expect(
    page
      .getByLabel("Origen del cliente")
      .locator("option")
      .filter({ hasText: "Referidos de prueba" }),
  ).toHaveCount(0);
});
