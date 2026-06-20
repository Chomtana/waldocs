import { createHash } from "node:crypto";
import type { LlmPort, MemwalPort, PublishInput, PublishResult, RepoPort } from "./types";
import { encodeTocHeader } from "./toc";

export function protocolNamespace(slug: string): string { return `proto.${slug}`; }
export function appNamespace(slug: string, commit: string): string { return `${slug}/${commit}`; }
export function parseSlug(slug: string): { author: string; repo: string } {
  const m = /^([^/]+)\/([^/]+)$/.exec(slug);
  if (!m) throw new Error(`Application slug must be "author/repo", got: ${slug}`);
  return { author: m[1], repo: m[2] };
}

export const hashContent = (s: string): string => createHash("sha256").update(s).digest("hex");

interface DesiredUnit { group: string | null; title: string; content: string }

// In-place upsert of a document's units, keyed by content hash:
//  - content already present  → never re-remember to Walrus; only patch group/order/title
//  - content is new           → one memwal.remember() + one new row
// Returns how many NEW units were written (= new Walrus writes).
async function upsertUnits(
  deps: { repo: RepoPort; memwal: MemwalPort },
  documentId: string,
  namespace: string,
  desired: DesiredUnit[],
): Promise<number> {
  const { repo, memwal } = deps;
  const existing = await repo.listDocUnits(documentId);
  const byHash = new Map(existing.filter((u) => u.contentHash).map((u) => [u.contentHash as string, u.id]));
  const seen = new Set<string>(); // guard against duplicate content within one desired set
  let newWrites = 0;
  for (let i = 0; i < desired.length; i++) {
    const d = desired[i];
    const contentHash = hashContent(d.content);
    const existingId = byHash.get(contentHash);
    if (existingId) {
      // existing content: frozen text, never re-remembered — just fix placement/title
      const cur = existing.find((u) => u.id === existingId)!;
      if (cur.ord !== i || cur.groupTitle !== d.group || cur.title !== d.title) {
        await repo.updateUnitMeta(existingId, { ord: i, groupTitle: d.group, title: d.title });
      }
      continue;
    }
    if (seen.has(contentHash)) continue; // identical content appearing twice in one doc
    seen.add(contentHash);
    const { jobId } = await memwal.remember(d.content, namespace);
    await repo.insertUnit({
      documentId, ord: i, groupTitle: d.group, title: d.title,
      contentCache: d.content, walrusBlobId: null, jobId, namespace, contentHash,
    });
    newWrites++;
  }
  return newWrites;
}

export async function publishApp(
  input: PublishInput,
  deps: { repo: RepoPort; memwal: MemwalPort; llm: LlmPort; baseUrl: string },
): Promise<PublishResult> {
  const { repo, memwal, llm, baseUrl } = deps;
  const { entity, markdown, usesProtocols } = input;

  const { author, repo: repoName } = parseSlug(entity.slug); // throws on bad slug
  if (!markdown.trim()) throw new Error("markdown is required.");

  // 1) structure + route each step to its single most-related protocol
  const structured = await llm.structureAppDoc(markdown, usesProtocols);
  const appName = entity.name ?? structured.name;

  // Exclusive routing: a step's knowledge is merged into ONLY its assigned
  // protocol's doc (or none), never duplicated across every used protocol.
  const stepsByProtocol = new Map<string, typeof structured.steps>();
  for (const s of structured.steps) {
    if (s.protocol && usesProtocols.includes(s.protocol)) {
      const list = stepsByProtocol.get(s.protocol) ?? [];
      list.push(s);
      stepsByProtocol.set(s.protocol, list);
    }
  }

  // 2) store app — reuse the document for THIS commit (in-place upsert), so
  // re-publishing the same commit never duplicates rows or Walrus writes.
  const ns = appNamespace(entity.slug, entity.commitHash);
  const { id: appId } = await repo.upsertApplication({
    slug: entity.slug, author, repo: repoName, name: appName,
    description: entity.description, namespace: ns, latestCommit: entity.commitHash, repoUrl: entity.repoUrl,
  });
  const existingAppDoc = await repo.findAppDocument(appId, entity.commitHash);
  let documentId: string;
  let version: number;
  if (existingAppDoc) {
    documentId = existingAppDoc.id;
    version = existingAppDoc.version;
    await repo.updateDocumentMeta(documentId, { title: appName, summary: structured.summary });
  } else {
    version = await repo.nextVersion(appId);
    ({ id: documentId } = await repo.createDocument({
      entityType: "application", entityId: appId, version, commitHash: entity.commitHash,
      namespace: ns, title: appName, summary: structured.summary, sourceMarkdown: markdown,
    }));
  }

  // Walrus writes are non-blocking (remember -> jobId, certified in the background by
  // /api/reconcile) AND deduped: only new/changed content is written.
  let unitsQueued = 0;
  const appNewWrites = await upsertUnits(
    { repo, memwal }, documentId, ns,
    structured.steps.map((s) => ({ group: null, title: s.title, content: s.content })),
  );
  unitsQueued += appNewWrites;

  // Only (re)write the app _toc when the entity is new or its content actually changed.
  if (!existingAppDoc || appNewWrites > 0) {
    const appTocLine = encodeTocHeader("application", entity.slug, appName, structured.summary);
    await memwal.remember(appTocLine, "_toc");
    unitsQueued++;
  }

  // 3) merge into each used protocol
  const mergedProtocols: { slug: string; changed: boolean }[] = [];
  for (const protoSlug of usesProtocols) {
    const pNs = protocolNamespace(protoSlug);
    const { id: protocolId } = await repo.upsertProtocolBySlug({ slug: protoSlug, name: protoSlug, namespace: pNs });
    await repo.linkAppProtocol(appId, protocolId);

    const currentDoc = await repo.latestProtocolUnits(protocolId);
    // Only merge the steps routed to THIS protocol. If none, skip the merge
    // (nothing from this app belongs here) but still refresh description/showcase.
    const appSteps = stepsByProtocol.get(protoSlug) ?? [];
    const merge = appSteps.length
      ? await llm.mergeProtocolDoc({ protocolName: protoSlug, currentDoc, appName, appSteps })
      : { doc: [] as { group: string | null; title: string; content: string }[] };

    // "What this protocol is" — a stable one-liner for the docs index, owned by a
    // dedicated call (never the merge's prose) and refreshed on every publish.
    const described = merge.doc.length ? merge.doc : currentDoc;
    const { description } = await llm.describeProtocol({ protocolName: protoSlug, doc: described });
    if (description.trim()) await repo.setProtocolDescription(protocolId, description.trim());

    let changed = false;
    if (merge.doc.length) {
      // Reuse the protocol's single persistent document; create it only on first content.
      let pDoc = await repo.latestDocument(protocolId);
      if (!pDoc) {
        const pVersion = await repo.nextVersion(protocolId);
        pDoc = await repo.createDocument({
          entityType: "protocol", entityId: protocolId, version: pVersion, namespace: pNs,
          title: protoSlug, summary: merge.summary ?? "",
        });
      }
      const protoNewWrites = await upsertUnits(
        { repo, memwal }, pDoc.id, pNs,
        merge.doc.map((u) => ({ group: u.group, title: u.title, content: u.content })),
      );
      unitsQueued += protoNewWrites;
      if (merge.summary) await repo.updateDocumentMeta(pDoc.id, { summary: merge.summary });
      changed = protoNewWrites > 0;
      if (changed) {
        const pTocLine = encodeTocHeader("protocol", protoSlug, protoSlug, merge.summary ?? "");
        await memwal.remember(pTocLine, "_toc");
        unitsQueued++;
      }
    }
    mergedProtocols.push({ slug: protoSlug, changed });

    // 4) curate showcase for this protocol
    const candidates = await repo.linkedApps(protocolId);
    const { entries } = await llm.curateShowcase({ protocolName: protoSlug, candidates: candidates.map((c) => ({ slug: c.slug, name: c.name, summary: c.summary })) });
    await repo.replaceShowcase(protocolId, entries);
  }

  await repo.insertPublishEvent({ entityType: "application", entityId: appId, documentId, meta: { repoUrl: entity.repoUrl, steps: structured.steps.length } });

  return { url: `${baseUrl}/app/${entity.slug}`, slug: entity.slug, documentId, version, namespace: ns, unitsQueued, mergedProtocols };
}
