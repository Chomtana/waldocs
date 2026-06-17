import type { LlmPort, MemwalPort, PublishInput, PublishResult, RepoPort } from "./types";
import { encodeTocHeader } from "./toc";

export function protocolNamespace(slug: string): string { return `proto.${slug}`; }
export function appNamespace(slug: string, commit: string): string { return `${slug}/${commit}`; }
export function parseSlug(slug: string): { author: string; repo: string } {
  const m = /^([^/]+)\/([^/]+)$/.exec(slug);
  if (!m) throw new Error(`Application slug must be "author/repo", got: ${slug}`);
  return { author: m[1], repo: m[2] };
}

export async function publishApp(
  input: PublishInput,
  deps: { repo: RepoPort; memwal: MemwalPort; llm: LlmPort; baseUrl: string },
): Promise<PublishResult> {
  const { repo, memwal, llm, baseUrl } = deps;
  const { entity, markdown, usesProtocols } = input;

  const { author, repo: repoName } = parseSlug(entity.slug); // throws on bad slug
  if (!markdown.trim()) throw new Error("markdown is required.");

  // 1) structure
  const structured = await llm.structureAppDoc(markdown);
  const appName = entity.name ?? structured.name;

  // 2) store app
  const ns = appNamespace(entity.slug, entity.commitHash);
  const { id: appId } = await repo.upsertApplication({
    slug: entity.slug, author, repo: repoName, name: appName,
    description: entity.description, namespace: ns, latestCommit: entity.commitHash, repoUrl: entity.repoUrl,
  });
  const version = await repo.nextVersion(appId);
  const { id: documentId } = await repo.createDocument({
    entityType: "application", entityId: appId, version, commitHash: entity.commitHash,
    namespace: ns, title: appName, summary: structured.summary, sourceMarkdown: markdown,
  });

  const blobIds: string[] = [];
  for (let i = 0; i < structured.steps.length; i++) {
    const s = structured.steps[i];
    const { blobId } = await memwal.remember(s.content, ns);
    await repo.insertUnit({ documentId, ord: i, groupTitle: null, title: s.title, contentCache: s.content, walrusBlobId: blobId, namespace: ns });
    blobIds.push(blobId);
  }

  const appTocLine = encodeTocHeader("application", entity.slug, appName, structured.summary);
  const { blobId: tocBlobId } = await memwal.remember(appTocLine, "_toc");
  await repo.setEntityToc("application", appId, tocBlobId);

  // 3) merge into each used protocol
  const mergedProtocols: { slug: string; changed: boolean }[] = [];
  for (const protoSlug of usesProtocols) {
    const { id: protocolId } = await repo.upsertProtocolBySlug({ slug: protoSlug, name: protoSlug, namespace: protocolNamespace(protoSlug) });
    await repo.linkAppProtocol(appId, protocolId);

    const currentDoc = await repo.latestProtocolUnits(protocolId);
    const merge = await llm.mergeProtocolDoc({ protocolName: protoSlug, currentDoc, appName, appSteps: structured.steps });

    if (merge.changed) {
      if (!merge.doc || merge.doc.length === 0) {
        throw new Error(`mergeProtocolDoc returned changed=true but no doc for protocol "${protoSlug}"`);
      }
      const pNs = protocolNamespace(protoSlug);
      const pVersion = await repo.nextVersion(protocolId);
      const { id: pDocId } = await repo.createDocument({
        entityType: "protocol", entityId: protocolId, version: pVersion, namespace: pNs,
        title: protoSlug, summary: merge.summary ?? "",
      });
      for (let i = 0; i < merge.doc.length; i++) {
        const u = merge.doc[i];
        const { blobId } = await memwal.remember(u.content, pNs);
        await repo.insertUnit({ documentId: pDocId, ord: i, groupTitle: u.group, title: u.title, contentCache: u.content, walrusBlobId: blobId, namespace: pNs });
      }
      if (merge.description) await repo.setProtocolDescription(protocolId, merge.description);
      const pTocLine = encodeTocHeader("protocol", protoSlug, protoSlug, merge.summary ?? "");
      const { blobId: pToc } = await memwal.remember(pTocLine, "_toc");
      await repo.setEntityToc("protocol", protocolId, pToc);
    }
    mergedProtocols.push({ slug: protoSlug, changed: Boolean(merge.changed) });

    // 4) curate showcase for this protocol
    const candidates = await repo.linkedApps(protocolId);
    const { entries } = await llm.curateShowcase({ protocolName: protoSlug, candidates: candidates.map((c) => ({ slug: c.slug, name: c.name, summary: c.summary })) });
    await repo.replaceShowcase(protocolId, entries);
  }

  await repo.insertPublishEvent({ entityType: "application", entityId: appId, documentId, meta: { repoUrl: entity.repoUrl, steps: structured.steps.length } });

  return { url: `${baseUrl}/app/${entity.slug}`, slug: entity.slug, documentId, version, namespace: ns, blobIds, tocBlobId, mergedProtocols };
}
