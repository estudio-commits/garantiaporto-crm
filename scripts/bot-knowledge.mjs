// Genera, a partir de docs/WHATSAPP-FAQ.md:
//   lib/bot-faq.ts   → secciones 1 a 10 (lo que sabe el asistente)
//   lib/bot-tests.ts → sección 11 (preguntas de prueba, para "Probar asistente" en Integraciones)
// Uso: npm run bot:knowledge. Las pruebas fallan si los archivos generados quedaron desactualizados.
import { readFileSync, writeFileSync } from "node:fs";

export function buildKnowledge(doc) {
  const start = doc.indexOf("## 1. ");
  const end = doc.indexOf("## 11. ");
  if (start < 0 || end < 0 || end < start)
    throw Error("docs/WHATSAPP-FAQ.md: faltan las secciones 1 a 11.");
  return doc.slice(start, end).trim().replace(/\r\n/g, "\n");
}

export function buildCases(doc) {
  const section = doc.slice(doc.indexOf("## 11. ")).replace(/\r\n/g, "\n");
  return [...section.matchAll(/^\| "(.+?)"(?: \+ foto)? \| (.+) \|$/gm)].map(
    (m) => ({ question: m[1], expected: m[2].trim() }),
  );
}

const HEADER = `// Generado por scripts/bot-knowledge.mjs desde docs/WHATSAPP-FAQ.md. No editar a mano.
// Para cambiarlo, editá el documento y corré: npm run bot:knowledge
`;

export function render(knowledge) {
  return `${HEADER}export const KNOWLEDGE = ${JSON.stringify(knowledge)};
`;
}

export function renderCases(cases) {
  return `${HEADER}export const TEST_CASES: { question: string; expected: string }[] = ${JSON.stringify(cases, null, 2)};
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const doc = readFileSync("docs/WHATSAPP-FAQ.md", "utf8");
  writeFileSync("lib/bot-faq.ts", render(buildKnowledge(doc)));
  writeFileSync("lib/bot-tests.ts", renderCases(buildCases(doc)));
  console.log("lib/bot-faq.ts y lib/bot-tests.ts actualizados.");
}
