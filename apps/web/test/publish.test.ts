import { describe, it, expect } from "vitest";
import { publishApp, protocolNamespace, appNamespace, parseSlug } from "@/lib/publish";
import type { MemwalPort, RepoPort, LlmPort, PublishInput, GroupedUnit } from "@/lib/types";

function fakes(mergeChanged: boolean) {
  const log = { remembered: [] as { text: string; ns: string }[], showcaseFor: [] as string[], protoVersions: 0, describedFor: [] as string[], descSet: [] as string[], mergedFor: [] as { slug: string; steps: number }[] };
  let job = 0;
  const memwal: MemwalPort = {
    async remember(text, ns) { log.remembered.push({ text, ns }); return { jobId: `job-${++job}` }; },
    async resolveJob() { return null; },
    async recall() { return { results: [] }; },
    async health() { return { status: "ok" }; },
  };
  const repo: RepoPort = {
    async upsertProtocolBySlug() { return { id: "proto-1" }; },
    async upsertApplication() { return { id: "app-1" }; },
    async linkAppProtocol() {},
    async nextVersion() { return 1; },
    async createDocument(a) { if (a.entityType === "protocol") log.protoVersions++; return { id: `doc-${a.entityType}` }; },
    async insertUnit() {},
    async findAppDocument() { return null; },
    async latestDocument() { return null; },
    async listDocUnits() { return []; },
    async updateUnitMeta() {},
    async updateDocumentMeta() {},
    async pendingUnits() { return []; },
    async setUnitBlobId() {},
    async setProtocolDescription(_id, description) { log.descSet.push(description); },
    async latestProtocolUnits() { return [] as GroupedUnit[]; },
    async linkedApps() { return [{ id: "app-1", slug: "chomtana/waldocs", name: "waldocs", summary: "s" }]; },
    async replaceShowcase(id) { log.showcaseFor.push(id); },
    async insertPublishEvent() {},
  };
  const llm: LlmPort = {
    async structureAppDoc() { return { name: "waldocs", summary: "Docs.", steps: [{ title: "Step 1", content: "a", protocol: "walrus" }, { title: "Step 2", content: "b", protocol: null }] }; },
    async describeProtocol({ protocolName }) { log.describedFor.push(protocolName); return { description: `${protocolName} is a protocol.` }; },
    async mergeProtocolDoc({ protocolName, appSteps }) {
      log.mergedFor.push({ slug: protocolName, steps: appSteps.length });
      return mergeChanged
        ? { doc: [{ group: "GETTING STARTED", title: "Introduction", content: "i" }], summary: "ps" }
        : { doc: [] };
    },
    async curateShowcase() { return { entries: [{ slug: "chomtana/waldocs", descriptiveTitle: "Docs app", simplicityRank: 0, clusterKey: "k" }] }; },
    async answerOverContext() { return { answer: "", usedLabels: [] }; },
  };
  return { memwal, repo, llm, log };
}

const input: PublishInput = {
  entity: { type: "application", slug: "chomtana/waldocs", commitHash: "a7d490d", repoUrl: "https://x" },
  markdown: "## Step 1\n...\n## Step 2\n...",
  usesProtocols: ["walrus"],
};

describe("namespaces + slug", () => {
  it("computes namespaces", () => {
    expect(protocolNamespace("walrus")).toBe("proto.walrus");
    expect(appNamespace("chomtana/waldocs", "a7d490d")).toBe("chomtana/waldocs/a7d490d");
  });
  it("parses slug", () => {
    expect(parseSlug("chomtana/waldocs")).toEqual({ author: "chomtana", repo: "waldocs" });
  });
});

describe("publishApp", () => {
  it("writes app steps to the app namespace then the TOC", async () => {
    const { memwal, repo, llm, log } = fakes(false);
    const res = await publishApp(input, { repo, memwal, llm, baseUrl: "http://h" });
    const appNs = "chomtana/waldocs/a7d490d";
    expect(log.remembered.slice(0, 2).map((r) => r.ns)).toEqual([appNs, appNs]);
    expect(log.remembered[2].ns).toBe("_toc");
    expect(log.remembered[2].text.startsWith("[application:chomtana/waldocs]")).toBe(true);
    expect(res.unitsQueued).toBe(3); // 2 steps + app _toc (merge unchanged → no protocol writes)
    expect(res.url).toBe("http://h/app/chomtana/waldocs");
    expect(res.mergedProtocols).toEqual([{ slug: "walrus", changed: false }]);
    expect(log.showcaseFor).toEqual(["proto-1"]);
  });

  it("when merge is unchanged, writes NO protocol document but still refreshes the description", async () => {
    const { memwal, repo, llm, log } = fakes(false);
    await publishApp(input, { repo, memwal, llm, baseUrl: "http://h" });
    expect(log.protoVersions).toBe(0);
    // describeProtocol runs independently of the merge, so the "what is this" card never goes stale
    expect(log.describedFor).toEqual(["walrus"]);
    expect(log.descSet).toEqual(["walrus is a protocol."]);
  });

  it("when merge improves, writes a protocol document + curates showcase", async () => {
    const { memwal, repo, llm, log } = fakes(true);
    const res = await publishApp(input, { repo, memwal, llm, baseUrl: "http://h" });
    expect(log.protoVersions).toBe(1);
    expect(log.showcaseFor).toEqual(["proto-1"]);
    expect(res.mergedProtocols).toEqual([{ slug: "walrus", changed: true }]);
  });

  it("merges each step only into its routed protocol, skipping unrelated ones", async () => {
    const { memwal, repo, llm, log } = fakes(true);
    // app uses walrus + sui, but the structurer routes step 1 → walrus and step 2 → null
    await publishApp({ ...input, usesProtocols: ["walrus", "sui"] }, { repo, memwal, llm, baseUrl: "http://h" });
    // sui received no routed steps → its merge is skipped entirely
    expect(log.mergedFor).toEqual([{ slug: "walrus", steps: 1 }]);
    // but describeProtocol still runs for every used protocol (cards never go stale)
    expect(log.describedFor).toEqual(["walrus", "sui"]);
  });

  it("rejects a non-author/repo slug", async () => {
    const { memwal, repo, llm } = fakes(false);
    await expect(
      publishApp({ ...input, entity: { ...input.entity, slug: "bare" } }, { repo, memwal, llm, baseUrl: "http://h" }),
    ).rejects.toThrow(/author\/repo/i);
  });
});
