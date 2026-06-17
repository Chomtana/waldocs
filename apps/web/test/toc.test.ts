import { describe, it, expect } from "vitest";
import { encodeTocHeader, decodeTocHeader } from "@/lib/toc";

describe("toc header", () => {
  it("encodes a parseable header", () => {
    expect(encodeTocHeader("protocol", "walrus", "Walrus", "Storage.").startsWith("[protocol:walrus] Walrus — ")).toBe(true);
  });
  it("round-trips a slashed app slug", () => {
    const line = encodeTocHeader("application", "chomtana/waldocs", "waldocs", "Docs.");
    expect(decodeTocHeader(line)).toEqual({ type: "application", slug: "chomtana/waldocs" });
  });
  it("returns null on garbage", () => {
    expect(decodeTocHeader("no header")).toBeNull();
  });
});
