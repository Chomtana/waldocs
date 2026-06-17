import { NextResponse } from "next/server";
import { publishSchema } from "@/lib/validation";
import { publishApp } from "@/lib/publish";
import { repo } from "@/lib/repo";
import { getMemwal } from "@/lib/memwal";
import { getLlm } from "@/lib/llm";

export const maxDuration = 120; // publish runs several Gemini + Walrus calls

export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const parsed = publishSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid payload", issues: parsed.error.issues }, { status: 400 });

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? new URL(req.url).origin;
  try {
    const result = await publishApp(parsed.data, { repo, memwal: getMemwal(), llm: getLlm(), baseUrl });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
