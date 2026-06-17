import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/repo", () => ({ repo: {} }));
vi.mock("@/lib/memwal", () => ({ getMemwal: () => ({}) }));
vi.mock("@/lib/llm", () => ({ getLlm: () => ({}) }));
vi.mock("@/lib/publish", () => ({
  publishApp: vi.fn(async (input: { entity: { slug: string } }) => ({
    url: `http://h/app/${input.entity.slug}`, slug: input.entity.slug, documentId: "d", version: 1,
    namespace: "ns", blobIds: ["b1"], tocBlobId: "t", mergedProtocols: [{ slug: "walrus", changed: true }],
  })),
}));

async function call(body: unknown) {
  const { POST } = await import("@/app/api/publish/route");
  return POST(new Request("http://h/api/publish", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
}

describe("POST /api/publish", () => {
  it("400s on invalid payload", async () => {
    expect((await call({ entity: { type: "application", slug: "bare" } })).status).toBe(400);
  });
  it("publishes a valid app", async () => {
    const res = await call({
      entity: { type: "application", slug: "chomtana/waldocs", commitHash: "a7d490d" },
      markdown: "## Step 1\nhi",
      usesProtocols: ["walrus"],
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.slug).toBe("chomtana/waldocs");
    expect(json.mergedProtocols[0].changed).toBe(true);
  });
});
