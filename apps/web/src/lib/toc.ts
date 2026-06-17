import type { EntityType } from "./types";

export function encodeTocHeader(type: EntityType, slug: string, name: string, summary: string): string {
  return `[${type}:${slug}] ${name} — ${summary}`;
}

// app slugs contain a slash, so allow "/" in the slug capture
const HEADER_RE = /^\[(protocol|application):([a-z0-9/_-]+)\]/i;

export function decodeTocHeader(text: string): { type: EntityType; slug: string } | null {
  const m = HEADER_RE.exec(text.trim());
  if (!m) return null;
  return { type: m[1].toLowerCase() as EntityType, slug: m[2] };
}
