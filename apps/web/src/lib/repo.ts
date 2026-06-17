import { db } from "./db";
import type { EntityType, GroupedUnit, RepoPort, UpsertProtocolArgs, UpsertAppArgs, InsertUnitArgs } from "./types";

export const repo: RepoPort = {
  async upsertProtocolBySlug(args: UpsertProtocolArgs) {
    const row = await db.protocol.upsert({
      where: { slug: args.slug },
      create: { slug: args.slug, name: args.name, description: args.description ?? null, namespace: args.namespace },
      update: { name: args.name },
    });
    return { id: row.id };
  },

  async upsertApplication(args: UpsertAppArgs) {
    const data = {
      author: args.author, repo: args.repo, name: args.name,
      description: args.description ?? null, namespace: args.namespace,
      latestCommit: args.latestCommit, repoUrl: args.repoUrl ?? null,
    };
    const row = await db.application.upsert({ where: { slug: args.slug }, create: { slug: args.slug, ...data }, update: data });
    return { id: row.id };
  },

  async linkAppProtocol(applicationId, protocolId) {
    await db.applicationProtocol.upsert({
      where: { applicationId_protocolId: { applicationId, protocolId } },
      create: { applicationId, protocolId },
      update: {},
    });
  },

  async nextVersion(entityId) {
    const last = await db.document.findFirst({ where: { entityId }, orderBy: { version: "desc" }, select: { version: true } });
    return (last?.version ?? 0) + 1;
  },

  async createDocument(args) {
    const row = await db.document.create({
      data: {
        entityType: args.entityType, entityId: args.entityId, version: args.version,
        commitHash: args.commitHash ?? null, namespace: args.namespace,
        title: args.title, summary: args.summary, sourceMarkdown: args.sourceMarkdown ?? null,
      },
    });
    return { id: row.id };
  },

  async insertUnit(args: InsertUnitArgs) {
    await db.docUnit.create({ data: args });
  },

  async setEntityToc(entityType: EntityType, entityId, tocBlobId) {
    if (entityType === "protocol") await db.protocol.update({ where: { id: entityId }, data: { tocBlobId } });
    else await db.application.update({ where: { id: entityId }, data: { tocBlobId } });
  },

  async setProtocolDescription(protocolId, description) {
    await db.protocol.update({ where: { id: protocolId }, data: { description } });
  },

  async latestProtocolUnits(protocolId): Promise<GroupedUnit[]> {
    const latest = await db.document.findFirst({ where: { entityId: protocolId, entityType: "protocol" }, orderBy: { version: "desc" } });
    if (!latest) return [];
    const units = await db.docUnit.findMany({ where: { documentId: latest.id }, orderBy: { ord: "asc" } });
    return units.map((u) => ({ group: u.groupTitle, title: u.title, content: u.contentCache }));
  },

  async linkedApps(protocolId) {
    const links = await db.applicationProtocol.findMany({ where: { protocolId }, include: { application: true } });
    const out: { id: string; slug: string; name: string; summary: string }[] = [];
    for (const l of links) {
      const latest = await db.document.findFirst({ where: { entityId: l.application.id }, orderBy: { version: "desc" }, select: { summary: true } });
      out.push({ id: l.application.id, slug: l.application.slug, name: l.application.name, summary: latest?.summary ?? "" });
    }
    return out;
  },

  async replaceShowcase(protocolId, entries) {
    await db.$transaction(async (tx) => {
      await tx.showcaseEntry.deleteMany({ where: { protocolId } });
      for (const e of entries) {
        const app = await tx.application.findUnique({ where: { slug: e.slug } });
        if (!app) continue;
        await tx.showcaseEntry.create({
          data: { protocolId, applicationId: app.id, descriptiveTitle: e.descriptiveTitle, simplicityRank: e.simplicityRank, clusterKey: e.clusterKey },
        });
      }
    });
  },

  async insertPublishEvent(args) {
    await db.publishEvent.create({
      data: { entityType: args.entityType, entityId: args.entityId, documentId: args.documentId, meta: (args.meta ?? undefined) as object | undefined },
    });
  },
};
