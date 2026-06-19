import { describe, it, expect, vi } from "vitest";
import { createMemwal } from "@/lib/memwal";

function fakeClient() {
  return {
    remember: vi.fn(async () => ({ job_id: "job-1", status: "running" })),
    waitForRememberJob: vi.fn(async () => ({ blob_id: "blob-1" })),
    recall: vi.fn(async () => ({ results: [{ blob_id: "b", text: "t", distance: 0.2 }], total: 1 })),
    health: vi.fn(async () => ({ status: "ok" })),
  };
}

describe("memwal wrapper", () => {
  it("maps non-blocking remember to jobId", async () => {
    const m = createMemwal(fakeClient() as never);
    expect(await m.remember("hi", "proto.walrus")).toEqual({ jobId: "job-1" });
  });
  it("resolveJob returns the certified blobId", async () => {
    const m = createMemwal(fakeClient() as never);
    expect(await m.resolveJob("job-1")).toEqual({ blobId: "blob-1" });
  });
  it("resolveJob returns null when the job isn't ready", async () => {
    const c = fakeClient();
    c.waitForRememberJob = vi.fn(async () => {
      throw new Error("timeout");
    });
    const m = createMemwal(c as never);
    expect(await m.resolveJob("job-x")).toBeNull();
  });
  it("maps recall to camelCase", async () => {
    const m = createMemwal(fakeClient() as never);
    const r = await m.recall("q", "_toc", { maxDistance: 0.7 });
    expect(r.results[0]).toEqual({ blobId: "b", text: "t", distance: 0.2 });
  });
});
