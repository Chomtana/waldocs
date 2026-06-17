import { NextResponse } from "next/server";
import { z } from "zod";
import { entityAsk } from "@/lib/chat";
import { getMemwal } from "@/lib/memwal";
import { getLlm } from "@/lib/llm";
import { db } from "@/lib/db";

export const maxDuration = 60;
const schema = z.object({
  entityType: z.enum(["protocol", "application"]),
  slug: z.string().min(1),
  question: z.string().min(1),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  const { entityType, slug, question } = parsed.data;
  let namespace = `proto.${slug}`;
  if (entityType === "application") {
    const app = await db.application.findUnique({ where: { slug }, select: { namespace: true } });
    if (!app) return NextResponse.json({ error: "not found" }, { status: 404 });
    namespace = app.namespace;
  }
  const out = await entityAsk(question, namespace, slug, { memwal: getMemwal(), llm: getLlm() });
  return NextResponse.json(out);
}
