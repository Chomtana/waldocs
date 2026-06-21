import { describe, it, expect } from "vitest";
import { parseDocToUnits } from "@/lib/parseDoc";

describe("parseDocToUnits", () => {
  it("splits an application doc by ## steps (no group)", () => {
    const md = [
      "# My App",
      "> a one-line description",
      "",
      "## Environment",
      "- sui: `@mysten/sui@2.19.0`",
      "",
      "## Step 1: Install",
      "```bash\npnpm add @mysten/sui\n```",
      "",
      "## Step 2: Use it",
      "do the thing",
    ].join("\n");
    const units = parseDocToUnits(md, "application");
    expect(units.map((u) => u.title)).toEqual(["Environment", "Step 1: Install", "Step 2: Use it"]);
    expect(units.every((u) => u.group === null)).toBe(true);
    expect(units[1].content).toContain("pnpm add @mysten/sui");
  });

  it("splits a protocol doc into ## groups + ### units, with preamble as Introduction", () => {
    const md = [
      "# Seal",
      "",
      "Seal is threshold encryption for Sui.",
      "",
      "## Getting Started",
      "Intro paragraph for getting started.",
      "",
      "### Install",
      "```bash\npnpm add @mysten/seal\n```",
      "",
      "## Encrypting Data",
      "### Encrypt bytes",
      "```ts\nseal.encrypt(...)\n```",
    ].join("\n");
    const units = parseDocToUnits(md, "protocol");
    // preamble -> Introduction in the first group
    expect(units[0]).toMatchObject({ group: "Getting Started", title: "Introduction" });
    expect(units[0].content).toContain("threshold encryption");
    // group intro + ### unit
    const titles = units.map((u) => `${u.group}/${u.title}`);
    expect(titles).toContain("Getting Started/Getting Started"); // the ## intro paragraph
    expect(titles).toContain("Getting Started/Install");
    expect(titles).toContain("Encrypting Data/Encrypt bytes");
    // a ## with no intro text (Encrypting Data) does not emit an empty group unit
    expect(titles).not.toContain("Encrypting Data/Encrypting Data");
  });

  it("drops empty content and the leading # title", () => {
    const units = parseDocToUnits("# Title only\n\n## Heading\n\nbody", "application");
    expect(units).toEqual([{ group: null, title: "Heading", content: "body" }]);
  });
});
