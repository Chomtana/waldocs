import { describe, it, expect, vi } from "vitest";
import { createMemwal } from "@/lib/memwal";

function fakeClient() {
  return {
    rememberAndWait: vi.fn(async () => ({ blob_id: "blob-1" })),
    recall: vi.fn(async () => ({ results: [{ blob_id: "b", text: "t", distance: 0.2 }], total: 1 })),
    health: vi.fn(async () => ({ status: "ok" })),
  };
}

describe("memwal wrapper", () => {
  it("maps remember to blobId", async () => {
    const m = createMemwal(fakeClient() as never);
    expect(await m.remember("hi", "proto.walrus")).toEqual({ blobId: "blob-1" });
  });
  it("maps recall to camelCase", async () => {
    const m = createMemwal(fakeClient() as never);
    const r = await m.recall("q", "_toc", { maxDistance: 0.7 });
    expect(r.results[0]).toEqual({ blobId: "b", text: "t", distance: 0.2 });
  });
});
