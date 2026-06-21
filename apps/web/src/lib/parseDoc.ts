import type { EntityType } from "./types";

export interface ParsedUnit { group: string | null; title: string; content: string }

/**
 * Deterministic markdown -> doc units for the manual-import (publish-bypass) path.
 * No LLM. Two conventions:
 *  - "application": each `##` heading is a step/unit (no sidebar group).
 *  - "protocol":    each `##` heading is a sidebar GROUP, each `###` is a unit;
 *    text directly under a `##` (before its first `###`) becomes an intro unit,
 *    and the doc preamble (the `# Title` + one-line definition) becomes an
 *    "Introduction" unit in the first group.
 * A leading `# Title` line is always dropped (the title is the entity name).
 */
export function parseDocToUnits(markdown: string, type: EntityType): ParsedUnit[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const units: ParsedUnit[] = [];
  const push = (group: string | null, title: string | null, body: string[]) => {
    const content = body.join("\n").trim();
    if (title && content) units.push({ group, title, content });
  };
  const h1 = (l: string) => l.startsWith("# ") && !l.startsWith("## ");
  const h2 = (l: string) => /^##\s+(.+?)\s*$/.exec(l);
  const h3 = (l: string) => /^###\s+(.+?)\s*$/.exec(l);

  if (type === "application") {
    let title: string | null = null;
    let body: string[] = [];
    for (const line of lines) {
      if (h1(line)) continue;
      const m = h2(line);
      if (m) { push(null, title, body); title = m[1].trim(); body = []; continue; }
      if (title) body.push(line);
    }
    push(null, title, body);
    return units;
  }

  // protocol
  let group = "Overview";
  let title: string | null = null;
  let body: string[] = [];
  const preamble: string[] = [];
  let started = false;
  for (const line of lines) {
    if (h1(line)) continue;
    const m2 = h2(line);
    const m3 = h3(line);
    if (!started && !m2) { preamble.push(line); continue; }
    if (m2) { push(group, title, body); group = m2[1].trim(); title = group; body = []; started = true; continue; }
    if (m3) { push(group, title, body); title = m3[1].trim(); body = []; continue; }
    if (title) body.push(line);
  }
  push(group, title, body);

  const intro = preamble.join("\n").trim();
  if (intro) units.unshift({ group: units[0]?.group ?? "Overview", title: "Introduction", content: intro });
  return units;
}
