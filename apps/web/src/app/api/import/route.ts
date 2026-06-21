import { NextResponse } from "next/server";
import { importSchema } from "@/lib/validation";
import { importEntity } from "@/lib/publish";
import { repo } from "@/lib/repo";
import { getMemwal } from "@/lib/memwal";

export const maxDuration = 300; // direct writes still hit the slow, rate-limited Walrus relayer

// Manual import / publish-bypass: write a protocol OR application doc DIRECTLY to
// Postgres + Walrus, skipping the LLM structure/merge/route pipeline. Guarded by a
// shared token (WALDOCS_IMPORT_TOKEN) so it can't be left open in production.
export async function POST(req: Request) {
  const expected = process.env.WALDOCS_IMPORT_TOKEN;
  if (!expected) return NextResponse.json({ error: "import disabled: set WALDOCS_IMPORT_TOKEN" }, { status: 503 });
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (token !== expected) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const parsed = importSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid payload", issues: parsed.error.issues }, { status: 400 });

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? new URL(req.url).origin;
  try {
    const result = await importEntity(parsed.data, { repo, memwal: getMemwal(), baseUrl });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
