import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "@/app/_components/Markdown";

const md = [
  "| Feature | Supported |",
  "|---|---|",
  "| Tables | yes |",
  "",
  "Some ~~struck~~ text and a [link](https://walrus.xyz).",
  "",
  "- [x] done",
  "- [ ] todo",
  "",
  "```ts",
  "const x: number = 1;",
  "```",
].join("\n");

describe("Markdown", () => {
  const html = renderToStaticMarkup(createElement(Markdown, { children: md }));

  it("renders GFM tables", () => {
    expect(html).toContain("<table>");
    expect(html).toContain("<td>yes</td>");
  });
  it("renders strikethrough and links", () => {
    expect(html).toContain("<del>struck</del>");
    expect(html).toContain('href="https://walrus.xyz"');
  });
  it("renders GFM task lists with checkboxes", () => {
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("checked");
  });
  it("syntax-highlights fenced code", () => {
    expect(html).toContain("hljs");
    expect(html).toContain("language-ts");
  });
});
