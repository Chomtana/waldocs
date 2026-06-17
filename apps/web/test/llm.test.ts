import { describe, it, expect, vi } from "vitest";
import { createLlm } from "@/lib/llm";

// Fake generateObject: returns a canned object per call, ignoring the prompt.
function fakeGen(obj: unknown) {
  return vi.fn(async () => ({ object: obj }));
}

describe("llm wrapper", () => {
  it("structureAppDoc returns parsed steps", async () => {
    const gen = fakeGen({ name: "waldocs", summary: "s", steps: [{ title: "Step 1", content: "c" }] });
    const llm = createLlm(gen as never);
    const out = await llm.structureAppDoc("# raw md");
    expect(out.steps).toEqual([{ title: "Step 1", content: "c" }]);
    expect(gen).toHaveBeenCalledOnce();
  });

  it("mergeProtocolDoc passes through changed=false", async () => {
    const llm = createLlm(fakeGen({ changed: false }) as never);
    const out = await llm.mergeProtocolDoc({ protocolName: "Walrus", currentDoc: [], appName: "x", appSteps: [] });
    expect(out.changed).toBe(false);
    expect(out.doc).toBeUndefined();
  });

  it("curateShowcase returns entries", async () => {
    const llm = createLlm(fakeGen({ entries: [{ slug: "a/b", descriptiveTitle: "Demo", simplicityRank: 0, clusterKey: "k" }] }) as never);
    const out = await llm.curateShowcase({ protocolName: "Walrus", candidates: [] });
    expect(out.entries[0].descriptiveTitle).toBe("Demo");
  });

  it("answerOverContext passes through gen's object", async () => {
    const gen = fakeGen({ answer: "the answer", usedLabels: ["walrus"] });
    const llm = createLlm(gen as never);
    const out = await llm.answerOverContext({ question: "how?", context: [{ label: "walrus", text: "chunk" }] });
    expect(out).toEqual({ answer: "the answer", usedLabels: ["walrus"] });
  });
});
