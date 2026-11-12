// Genera lib/bot-faq.ts a partir de docs/WHATSAPP-FAQ.md (secciones 1 a 10).
// Uso: npm run bot:knowledge. Las pruebas fallan si el archivo generado quedó desactualizado.
import { readFileSync, writeFileSync } from "node:fs";

export function buildKnowledge(doc) {
  const start = doc.indexOf("## 1. ");
  const end = doc.indexOf("## 11. ");
  if (start < 0 || end < 0 || end < start)
    throw Error("docs/WHATSAPP-FAQ.md: faltan las secciones 1 a 11.");
  return doc.slice(start, end).trim().replace(/\r\n/g, "\n");
}

export function render(knowledge) {
  return `// Generado por scripts/bot-knowledge.mjs desde docs/WHATSAPP-FAQ.md. No editar a mano.
// Para cambiar lo que sabe el asistente, editá el documento y corré: npm run bot:knowledge
export const KNOWLEDGE = ${JSON.stringify(knowledge)};
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const doc = readFileSync("docs/WHATSAPP-FAQ.md", "utf8");
  writeFileSync("lib/bot-faq.ts", render(buildKnowledge(doc)));
  console.log("lib/bot-faq.ts actualizado.");
}
