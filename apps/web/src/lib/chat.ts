import type { EntityType, LlmPort, MemwalPort } from "./types";
import { decodeTocHeader } from "./toc";

const MAX_CTX_PER_ENTITY = 4;

export interface Citation { entityType: EntityType; slug: string }

export async function globalChat(
  question: string,
  deps: {
    memwal: MemwalPort;
    llm: LlmPort;
    resolveNamespace: (type: EntityType, slug: string) => Promise<string>;
    topN?: number;
  },
): Promise<{ answer: string; citations: Citation[] }> {
  const topN = deps.topN ?? 3;
  const toc = await deps.memwal.recall(question, "_toc", { limit: 10, maxDistance: 0.8 });

  const seen = new Set<string>();
  const entities: Citation[] = [];
  for (const r of toc.results) {
    const d = decodeTocHeader(r.text);
    if (!d) continue;
    const key = `${d.type}:${d.slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entities.push({ entityType: d.type, slug: d.slug });
    if (entities.length >= topN) break;
  }

  const context: { label: string; text: string }[] = [];
  for (const e of entities) {
    const ns = await deps.resolveNamespace(e.entityType, e.slug);
    const hits = await deps.memwal.recall(question, ns, { limit: MAX_CTX_PER_ENTITY, maxDistance: 0.8 });
    for (const h of hits.results) context.push({ label: e.slug, text: h.text });
  }

  const { answer } = await deps.llm.answerOverContext({ question, context });
  return { answer, citations: entities };
}

export async function entityAsk(
  question: string,
  namespace: string,
  label: string,
  deps: { memwal: MemwalPort; llm: LlmPort },
): Promise<{ answer: string }> {
  const hits = await deps.memwal.recall(question, namespace, { limit: 6, maxDistance: 0.8 });
  const context = hits.results.map((h) => ({ label, text: h.text }));
  const { answer } = await deps.llm.answerOverContext({ question, context });
  return { answer };
}
