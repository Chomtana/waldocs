import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { listProtocols, getProtocol, getApplication } from "@/lib/queries";

beforeEach(async () => {
  await db.docUnit.deleteMany();
  await db.document.deleteMany();
  await db.showcaseEntry.deleteMany();
  await db.applicationProtocol.deleteMany();
  await db.application.deleteMany();
  await db.protocol.deleteMany();
});

describe("queries", () => {
  it("lists protocols oldest-first", async () => {
    await db.protocol.create({ data: { slug: "a", name: "A", namespace: "proto.a", createdAt: new Date("2026-01-01") } });
    await db.protocol.create({ data: { slug: "b", name: "B", namespace: "proto.b", createdAt: new Date("2026-02-01") } });
    expect((await listProtocols()).map((p) => p.slug)).toEqual(["a", "b"]);
  });

  it("groups protocol units into ordered sections + showcase", async () => {
    const p = await db.protocol.create({ data: { slug: "walrus", name: "Walrus", namespace: "proto.walrus" } });
    const d = await db.document.create({ data: { entityType: "protocol", entityId: p.id, version: 1, namespace: "proto.walrus", title: "Walrus", summary: "s" } });
    await db.docUnit.create({ data: { documentId: d.id, ord: 0, groupTitle: "GETTING STARTED", title: "Introduction", contentCache: "i", walrusBlobId: "b", namespace: "proto.walrus" } });
    await db.docUnit.create({ data: { documentId: d.id, ord: 1, groupTitle: "GETTING STARTED", title: "Getting Started", contentCache: "g", walrusBlobId: "b", namespace: "proto.walrus" } });
    await db.docUnit.create({ data: { documentId: d.id, ord: 2, groupTitle: "MEMORY", title: "Write", contentCache: "w", walrusBlobId: "b", namespace: "proto.walrus" } });
    const app = await db.application.create({ data: { slug: "x/y", author: "x", repo: "y", name: "y", namespace: "x/y/c", latestCommit: "c" } });
    await db.showcaseEntry.create({ data: { protocolId: p.id, applicationId: app.id, descriptiveTitle: "Y app", simplicityRank: 0, clusterKey: "k" } });

    const detail = await getProtocol("walrus");
    expect(detail?.sections.map((s) => s.group)).toEqual(["GETTING STARTED", "MEMORY"]);
    expect(detail?.sections[0].units.map((u) => u.title)).toEqual(["Introduction", "Getting Started"]);
    expect(detail?.showcase[0]).toMatchObject({ descriptiveTitle: "Y app", slug: "x/y" });
  });

  it("returns latest-commit steps for an application", async () => {
    const app = await db.application.create({ data: { slug: "x/y", author: "x", repo: "y", name: "y", namespace: "x/y/c2", latestCommit: "c2" } });
    const d1 = await db.document.create({ data: { entityType: "application", entityId: app.id, version: 1, namespace: "x/y/c1", title: "y", summary: "s" } });
    const d2 = await db.document.create({ data: { entityType: "application", entityId: app.id, version: 2, namespace: "x/y/c2", title: "y", summary: "s" } });
    await db.docUnit.create({ data: { documentId: d1.id, ord: 0, groupTitle: null, title: "Old", contentCache: "o", walrusBlobId: "b", namespace: "x/y/c1" } });
    await db.docUnit.create({ data: { documentId: d2.id, ord: 0, groupTitle: null, title: "Step 1", contentCache: "a", walrusBlobId: "b", namespace: "x/y/c2" } });
    const detail = await getApplication("x", "y");
    expect(detail?.steps.map((s) => s.title)).toEqual(["Step 1"]);
  });
});
