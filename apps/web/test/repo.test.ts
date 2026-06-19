import { describe, it, expect, beforeEach } from "vitest";
import { repo } from "@/lib/repo";
import { db } from "@/lib/db";

beforeEach(async () => {
  await db.docUnit.deleteMany();
  await db.document.deleteMany();
  await db.showcaseEntry.deleteMany();
  await db.applicationProtocol.deleteMany();
  await db.application.deleteMany();
  await db.protocol.deleteMany();
  await db.publishEvent.deleteMany();
});

describe("repo", () => {
  it("upserts a protocol by slug", async () => {
    const a = await repo.upsertProtocolBySlug({ slug: "walrus", name: "Walrus", namespace: "proto.walrus" });
    const b = await repo.upsertProtocolBySlug({ slug: "walrus", name: "Walrus", namespace: "proto.walrus" });
    expect(a.id).toBe(b.id);
  });

  it("upserts an application and increments version", async () => {
    const e = await repo.upsertApplication({
      slug: "chomtana/waldocs", author: "chomtana", repo: "waldocs", name: "waldocs",
      namespace: "chomtana/waldocs/abc", latestCommit: "abc",
    });
    expect(await repo.nextVersion(e.id)).toBe(1);
    await repo.createDocument({ entityType: "application", entityId: e.id, version: 1, namespace: "chomtana/waldocs/abc", title: "waldocs", summary: "s" });
    expect(await repo.nextVersion(e.id)).toBe(2);
  });

  it("reads latest protocol units grouped + ordered", async () => {
    const p = await repo.upsertProtocolBySlug({ slug: "walrus", name: "Walrus", namespace: "proto.walrus" });
    const d = await repo.createDocument({ entityType: "protocol", entityId: p.id, version: 1, namespace: "proto.walrus", title: "Walrus", summary: "s" });
    await repo.insertUnit({ documentId: d.id, ord: 1, groupTitle: "GETTING STARTED", title: "Getting Started", contentCache: "g", walrusBlobId: "b2", jobId: null, namespace: "proto.walrus" });
    await repo.insertUnit({ documentId: d.id, ord: 0, groupTitle: "GETTING STARTED", title: "Introduction", contentCache: "i", walrusBlobId: "b1", jobId: null, namespace: "proto.walrus" });
    const units = await repo.latestProtocolUnits(p.id);
    expect(units.map((u) => u.title)).toEqual(["Introduction", "Getting Started"]);
    expect(units[0].group).toBe("GETTING STARTED");
  });

  it("lists pending units (jobId set, no blob) and reconciles them", async () => {
    const p = await repo.upsertProtocolBySlug({ slug: "walrus", name: "Walrus", namespace: "proto.walrus" });
    const d = await repo.createDocument({ entityType: "protocol", entityId: p.id, version: 1, namespace: "proto.walrus", title: "Walrus", summary: "s" });
    await repo.insertUnit({ documentId: d.id, ord: 0, groupTitle: null, title: "U1", contentCache: "c", walrusBlobId: null, jobId: "job-1", namespace: "proto.walrus" });
    await repo.insertUnit({ documentId: d.id, ord: 1, groupTitle: null, title: "U2", contentCache: "c", walrusBlobId: "already", jobId: "job-2", namespace: "proto.walrus" });

    const pending = await repo.pendingUnits(10);
    expect(pending.map((u) => u.jobId)).toEqual(["job-1"]); // U2 already has a blob

    await repo.setUnitBlobId(pending[0].id, "resolved-blob");
    expect(await repo.pendingUnits(10)).toHaveLength(0);
  });

  it("replaces showcase entries", async () => {
    const p = await repo.upsertProtocolBySlug({ slug: "walrus", name: "Walrus", namespace: "proto.walrus" });
    const app = await repo.upsertApplication({ slug: "a/b", author: "a", repo: "b", name: "b", namespace: "a/b/c", latestCommit: "c" });
    await repo.linkAppProtocol(app.id, p.id);
    await repo.replaceShowcase(p.id, [{ slug: "a/b", descriptiveTitle: "Demo app", simplicityRank: 0, clusterKey: "k1" }]);
    await repo.replaceShowcase(p.id, [{ slug: "a/b", descriptiveTitle: "Demo app v2", simplicityRank: 0, clusterKey: "k1" }]);
    const rows = await db.showcaseEntry.findMany({ where: { protocolId: p.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].descriptiveTitle).toBe("Demo app v2");
  });
});
