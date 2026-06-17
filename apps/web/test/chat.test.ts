import { describe, it, expect, vi, beforeEach } from "vitest";
import { globalChat, entityAsk } from "@/lib/chat";
import type { MemwalPort, LlmPort } from "@/lib/types";

function memwalWith(tocHits: { text: string }[], perNs: Record<string, string[]>): MemwalPort {
  return {
    async remember() { return { blobId: "x" }; },
    async recall(_q, ns) {
      if (ns === "_toc") return { results: tocHits.map((t, i) => ({ blobId: `t${i}`, text: t.text, distance: 0.1 })) };
      return { results: (perNs[ns] ?? []).map((text, i) => ({ blobId: `${ns}-${i}`, text, distance: 0.2 })) };
    },
    async health() { return { status: "ok" }; },
  };
}

const llm: LlmPort = {
  async structureAppDoc() { return { name: "", summary: "", steps: [] }; },
  async mergeProtocolDoc() { return { changed: false }; },
  async curateShowcase() { return { entries: [] }; },
  answerOverContext: vi.fn(async ({ context }) => ({ answer: `from ${context.length} ctx`, usedLabels: context.map((c) => c.label) })),
};

describe("globalChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves top entities and answers over their context", async () => {
    const memwal = memwalWith(
      [{ text: "[protocol:walrus] Walrus — storage" }, { text: "[application:a/b] b — demo" }],
      { "proto.walrus": ["walrus doc chunk"], "a/b/c": ["app step chunk"] },
    );
    const resolveNamespace = async (type: string, slug: string) =>
      type === "protocol" ? `proto.${slug}` : "a/b/c";
    const out = await globalChat("how to store?", { memwal, llm, resolveNamespace, topN: 3 });
    expect(out.answer).toBe("from 2 ctx");
    expect(out.citations.map((c) => c.slug).sort()).toEqual(["a/b", "walrus"]);
  });
});

describe("entityAsk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("answers over a single namespace", async () => {
    const memwal = memwalWith([], { "proto.walrus": ["chunk1", "chunk2"] });
    const out = await entityAsk("q", "proto.walrus", "walrus", { memwal, llm });
    expect(out.answer).toBe("from 2 ctx");
  });
});
