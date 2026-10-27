import { test, expect } from "@playwright/test";
test("manual case persists, notes are appended, seller demo isolates assigned cases", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Cada solicitud, un nuevo comienzo." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Nueva solicitud", exact: true })
    .click();
  await page.getByLabel("Nombre completo").fill("Caso Ficticio Navegador");
  await page.getByLabel("Celular", { exact: true }).fill("000999888");
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
  const r = await request.post("/api/integration/events", { data: {} });
  expect(r.status()).toBe(503);
});
