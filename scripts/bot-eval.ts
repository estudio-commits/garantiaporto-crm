// Pasa las preguntas de prueba (docs/WHATSAPP-FAQ.md, sección 11) por el asistente real y escribe
// un informe. Lo mismo hace el botón "Probar asistente" en Integraciones.
// Uso: ANTHROPIC_API_KEY=... npx tsx scripts/bot-eval.ts [salida.md]   (tiene costo de API)
import Anthropic from "@anthropic-ai/sdk";
import { writeFileSync } from "node:fs";
import { runEvalCase } from "../lib/bot-eval";
import { TEST_CASES } from "../lib/bot-tests";

const client = new Anthropic();
const out = ["# Prueba del asistente — sección 11", ""];
for (const c of TEST_CASES) {
  const r = await runEvalCase(client, c.question);
  out.push(
    `## ${c.question}`,
    "",
    `**Esperado:** ${c.expected}`,
    "",
    "**Respuesta:**",
    "",
    ...r.replies.map((b) => `> ${b.replace(/\n/g, "\n> ")}`),
    "",
    ...(r.actions.length ? [`**Acciones:** ${r.actions.join(" · ")}`, ""] : []),
  );
  console.log(`✓ ${c.question}`);
}
const file = process.argv[2] || "bot-eval.md";
writeFileSync(file, out.join("\n"));
console.log(`Informe: ${file} (${TEST_CASES.length} casos)`);
