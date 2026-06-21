import { describe, it, expect } from "vitest";
import { importEntity } from "@/lib/publish";
import type { MemwalPort, RepoPort, GroupedUnit } from "@/lib/types";

function fakes() {
  const log = {
    remembered: [] as { text: string; ns: string }[],
    inserted: [] as { ns: string; title: string; contentHash: string }[],
    descSet: [] as string[],
    linked: [] as string[],
  };
  let job = 0;
  const memwal: MemwalPort = {
    async remember(text, ns) { log.remembered.push({ text, ns }); return { jobId: `job-${++job}` }; },
    async resolveJob() { return null; },
    async recall() { return { results: [] }; },
    async health() { return { status: "ok" }; },
  };
  const repo: RepoPort = {
    async upsertProtocolBySlug(a) { return { id: `proto-${a.slug}` }; },
    async upsertApplication() { return { id: "app-1" }; },
    async linkAppProtocol(_app, protocolId) { log.linked.push(protocolId); },
    async nextVersion() { return 1; },
    async createDocument(a) { return { id: `doc-${a.entityType}` }; },
    async insertUnit(a) { log.inserted.push({ ns: a.namespace, title: a.title, contentHash: a.contentHash }); },
    async findAppDocument() { return null; },
    async latestDocument() { return null; },
    async listDocUnits() { return []; },
    async updateUnitMeta() {},
    async updateDocumentMeta() {},
    async pendingUnits() { return []; },
    async setUnitBlobId() {},
    async setProtocolDescription(_id, d) { log.descSet.push(d); },
    async latestProtocolUnits() { return [] as GroupedUnit[]; },
    async linkedApps() { return []; },
    async replaceShowcase() {},
    async insertPublishEvent() {},
  };
  return { memwal, repo, log };
}

describe("importEntity (publish-bypass)", () => {
  it("imports a protocol from markdown, writing units + description + _toc", async () => {
    const { memwal, repo, log } = fakes();
    const md = "# Seal\n\nSeal is threshold encryption.\n\n## Getting Started\n\n### Install\n```bash\npnpm add @mysten/seal\n```\n";
    const res = await importEntity(
      { entity: { type: "protocol", slug: "seal", name: "Seal", description: "Seal is threshold encryption." }, markdown: md },
      { repo, memwal, baseUrl: "http://h" },
    );
    expect(res.entityType).toBe("protocol");
    expect(res.url).toBe("http://h/protocol/seal");
    expect(res.unitsWritten).toBeGreaterThan(0);
    expect(log.descSet).toEqual(["Seal is threshold encryption."]);
    // every unit written to the protocol namespace
    expect(log.inserted.every((u) => u.ns === "proto.seal")).toBe(true);
    // _toc line tagged as a protocol
    const toc = log.remembered.find((r) => r.ns === "_toc");
    expect(toc?.text.startsWith("[protocol:seal]")).toBe(true);
  });

  it("imports an application from explicit units, linking protocols without merging", async () => {
    const { memwal, repo, log } = fakes();
    const res = await importEntity(
      {
        entity: { type: "application", slug: "alice/app", commitHash: "abc123", name: "App" },
        units: [{ title: "Step 1", content: "do x" }, { group: null, title: "Step 2", content: "do y" }],
        usesProtocols: ["sui", "walrus"],
      },
      { repo, memwal, baseUrl: "http://h" },
    );
    expect(res.entityType).toBe("application");
    expect(res.unitsWritten).toBe(2);
    expect(res.namespace).toBe("alice/app/abc123");
    expect(log.linked).toEqual(["proto-sui", "proto-walrus"]); // linked, not merged
    expect(log.inserted.map((u) => u.title)).toEqual(["Step 1", "Step 2"]);
    const toc = log.remembered.find((r) => r.ns === "_toc");
    expect(toc?.text.startsWith("[application:alice/app]")).toBe(true);
  });

  it("rejects an import with no units and no markdown", async () => {
    const { memwal, repo } = fakes();
    await expect(
      importEntity({ entity: { type: "protocol", slug: "x" } }, { repo, memwal, baseUrl: "http://h" }),
    ).rejects.toThrow(/no doc units/i);
  });
});
