import { NextResponse } from "next/server";
import { z } from "zod";
import { globalChat } from "@/lib/chat";
import { getMemwal } from "@/lib/memwal";
import { getLlm } from "@/lib/llm";
import { db } from "@/lib/db";
import type { EntityType } from "@/lib/types";

export const maxDuration = 60;
const schema = z.object({ question: z.string().min(1) });

async function resolveNamespace(type: EntityType, slug: string): Promise<string> {
  if (type === "protocol") return `proto.${slug}`;
  const app = await db.application.findUnique({ where: { slug }, select: { namespace: true } });
  return app?.namespace ?? slug; // latest-commit namespace
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  const out = await globalChat(parsed.data.question, { memwal: getMemwal(), llm: getLlm(), resolveNamespace });
  return NextResponse.json(out);
}
