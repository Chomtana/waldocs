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
    const out = await llm.structureAppDoc("# raw md", ["walrus"]);
    expect(out.steps).toEqual([{ title: "Step 1", content: "c" }]);
    expect(gen).toHaveBeenCalledOnce();
  });

  it("mergeProtocolDoc returns the desired doc", async () => {
    const llm = createLlm(fakeGen({ doc: [{ group: "GETTING STARTED", title: "Introduction", content: "i" }], summary: "s" }) as never);
    const out = await llm.mergeProtocolDoc({ protocolName: "Walrus", currentDoc: [], appName: "x", appSteps: [] });
    expect(out.doc).toHaveLength(1);
    expect(out.doc[0].title).toBe("Introduction");
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

import { withRetry } from "@/lib/llm";

describe("withRetry", () => {
  it("retries up to N times and succeeds", async () => {
    let calls = 0;
    const flaky = async () => { calls++; if (calls < 3) throw new Error("No object generated"); return { object: { ok: true } }; };
    const g = withRetry(flaky as never, 3);
    const r = await g({ schema: {} as never, prompt: "x" });
    expect((r as { object: { ok: boolean } }).object.ok).toBe(true);
    expect(calls).toBe(3);
  });
  it("throws the last error after exhausting attempts", async () => {
    let calls = 0;
    const always = async () => { calls++; throw new Error("No object generated"); };
    await expect(withRetry(always as never, 3)({ schema: {} as never, prompt: "x" })).rejects.toThrow(/No object generated/);
    expect(calls).toBe(3);
  });
});
