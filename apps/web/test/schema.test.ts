import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
describe("prisma schema", () => {
  it("exposes the expected models", () => {
    const models = Prisma.dmmf.datamodel.models.map((m) => m.name).sort();
    expect(models).toEqual(
      ["Application", "ApplicationProtocol", "DocUnit", "Document", "Protocol", "PublishEvent", "ShowcaseEntry"].sort(),
    );
  });
});
