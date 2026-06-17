import { NextResponse } from "next/server";
import { getMemwal } from "@/lib/memwal";
import { db } from "@/lib/db";
export async function GET() {
  const out = { ok: true, relayer: "unknown", db: "unknown" as string };
  try { out.relayer = (await getMemwal().health()).status; } catch { out.relayer = "down"; out.ok = false; }
  try { await db.$queryRaw`SELECT 1`; out.db = "up"; } catch { out.db = "down"; out.ok = false; }
  return NextResponse.json(out, { status: out.ok ? 200 : 503 });
}
